(function () {
  "use strict";

  const VISITED_KEY = "matchbu_visited_overrides_v1";
  const GENRE_META = [
    { name: "クッパ・スープ", icon: "🍲" },
    { name: "麺類", icon: "🍜" },
    { name: "焼肉・肉料理", icon: "🥩" },
    { name: "海鮮・刺身", icon: "🐟" },
    { name: "鍋・チゲ", icon: "🫕" },
    { name: "軽食・屋台グルメ", icon: "🍢" },
    { name: "市場・買い物・両替", icon: "🏪" },
    { name: "その他", icon: "📍" },
  ];
  const SOURCE_COLORS = ["#c81e2c", "#8a4fc8", "#1f8a5f", "#e0592a", "#2f7fd1", "#c8788a", "#5a8a2f", "#b06a1f"];

  // Published Google Sheet CSV URL (File > Share > Publish to web > CSV).
  // Leave empty to use only the bundled js/data.js. See docs/sheet-sync.md.
  const SHEET_CSV_URL = "";

  const state = {
    search: "",
    genres: new Set(),
    stationKey: null, // `${line}|${area_ja}` or null for all
    visitedOnly: false,
    source: "",
    panelMode: "results", // "results" | "filters"
  };

  let visitedOverrides = loadVisitedOverrides();
  let mapProvider = null;
  let sourceColorMap = {};
  let genreIconMap = {};
  GENRE_META.forEach((g) => { genreIconMap[g.name] = g.icon; });

  // RESTAURANTS (from js/data.js) is the geocoded/genre-tagged base dataset.
  // RESTAURANTS_DATA is what the app actually renders: the base dataset,
  // optionally overlaid with live edits from a published Google Sheet.
  let RESTAURANTS_DATA = RESTAURANTS;

  function buildSourceColorMap() {
    const counts = new Map();
    RESTAURANTS_DATA.forEach((r) => {
      if (r.source) counts.set(r.source, (counts.get(r.source) || 0) + 1);
    });
    const sources = Array.from(counts.keys()).sort((a, b) => counts.get(b) - counts.get(a));
    sources.forEach((s, i) => { sourceColorMap[s] = SOURCE_COLORS[i % SOURCE_COLORS.length]; });
    return { sources, counts };
  }

  function loadVisitedOverrides() {
    try {
      return JSON.parse(localStorage.getItem(VISITED_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }
  function saveVisitedOverrides() {
    localStorage.setItem(VISITED_KEY, JSON.stringify(visitedOverrides));
  }
  function isVisited(item) {
    if (Object.prototype.hasOwnProperty.call(visitedOverrides, item.id)) {
      return visitedOverrides[item.id];
    }
    return !!item.visited;
  }
  function toggleVisited(item) {
    visitedOverrides[item.id] = !isVisited(item);
    saveVisitedOverrides();
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function buildGoogleUrl(item) {
    if (item.google_url) return item.google_url;
    const addr = item.address_road || item.address_lot || "";
    const q = `${item.name} ${addr}`.trim();
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  }

  function searchHaystack(item) {
    return [
      item.name, item.menu, item.notes, item.source,
      item.area_ja, item.area_ko, (item.genre || []).join(" "),
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function matchesFilters(item) {
    if (state.search) {
      const needle = state.search.toLowerCase();
      if (!searchHaystack(item).includes(needle)) return false;
    }
    if (state.genres.size > 0) {
      const g = item.genre || [];
      if (!g.some((x) => state.genres.has(x))) return false;
    }
    if (state.stationKey) {
      const key = `${item.line}|${item.area_ja}`;
      if (key !== state.stationKey) return false;
    }
    if (state.visitedOnly && !isVisited(item)) return false;
    if (state.source && item.source !== state.source) return false;
    return true;
  }

  function getFiltered() {
    return RESTAURANTS_DATA.filter(matchesFilters);
  }

  function lineColorSafe(line) {
    return { "1": "#e2231a", "2": "#34a853", "3": "#a9812d" }[line] || "#777";
  }

  // ---------- Area chips ----------
  function renderAreaChips() {
    const container = document.getElementById("area-chips");
    const lineNames = { "1": "1号線", "2": "2号線", "3": "3号線" };
    let html = `<button class="chip chip-all active" data-key="">すべて</button>`;
    STATIONS.forEach((s) => {
      const key = `${s.line}|${s.area_ja}`;
      html += `<button class="chip" data-key="${escapeHtml(key)}" title="${escapeHtml(lineNames[s.line] || "")}">` +
        `<span class="card-line-dot" style="background:${lineColorSafe(s.line)}"></span>${escapeHtml(s.area_ja)}</button>`;
    });
    container.innerHTML = html;
    container.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.stationKey = btn.dataset.key || null;
        container.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
        btn.classList.add("active");
        if (state.stationKey) focusStationOnMap(state.stationKey);
        refresh();
      });
    });
  }

  // ---------- Genre chips ----------
  function allGenresPresent() {
    const set = new Set();
    RESTAURANTS_DATA.forEach((r) => (r.genre || []).forEach((g) => set.add(g)));
    return GENRE_META.filter((g) => set.has(g.name));
  }

  function renderGenreChips() {
    const container = document.getElementById("genre-chips");
    const genres = allGenresPresent();
    let html = `<button class="chip chip-all active" data-genre="">すべて</button>`;
    html += genres.map((g) => (
      `<button class="chip" data-genre="${escapeHtml(g.name)}"><span aria-hidden="true">${g.icon}</span>${escapeHtml(g.name)}</button>`
    )).join("");
    container.innerHTML = html;

    function syncAllChipState() {
      container.querySelector('.chip-all').classList.toggle("active", state.genres.size === 0);
    }

    container.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const g = btn.dataset.genre;
        if (g === "") {
          state.genres.clear();
          container.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
          btn.classList.add("active");
        } else {
          if (state.genres.has(g)) { state.genres.delete(g); btn.classList.remove("active"); }
          else { state.genres.add(g); btn.classList.add("active"); }
          syncAllChipState();
        }
        refresh();
      });
    });
  }

  // ---------- Source chips ----------
  function renderSourceChips() {
    const container = document.getElementById("source-chips");
    const { sources, counts } = buildSourceColorMap();
    let html = `<button class="chip chip-all active" data-source="">すべて</button>`;
    html += sources.map((s) => {
      const color = sourceColorMap[s];
      return `<button class="chip chip-source" style="--chip-color:${color}" data-source="${escapeHtml(s)}">${escapeHtml(s)} (${counts.get(s)})</button>`;
    }).join("");
    container.innerHTML = html;
    container.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.source = btn.dataset.source;
        container.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
        btn.classList.add("active");
        refresh();
      });
    });
  }

  function focusStationOnMap(stationKey) {
    if (!stationKey || !mapProvider) return;
    const items = RESTAURANTS_DATA.filter((r) => `${r.line}|${r.area_ja}` === stationKey && r.lat != null);
    if (items.length === 0) return;
    const avgLat = items.reduce((s, r) => s + r.lat, 0) / items.length;
    const avgLon = items.reduce((s, r) => s + r.lon, 0) / items.length;
    mapProvider.panTo(avgLat, avgLon, 15);
  }

  // ---------- List rendering ----------
  function renderList(items) {
    const el = document.getElementById("list-view");
    if (items.length === 0) {
      el.innerHTML = '<div class="empty-state">条件に合うお店が見つかりませんでした。<br>検索語やフィルターを変えてみてください。</div>';
      return;
    }
    el.innerHTML = items.map((item) => {
      const visited = isVisited(item);
      const areaBadge = `<span class="badge badge-area"><span class="card-line-dot" style="background:${lineColorSafe(item.line)}"></span>${escapeHtml(item.area_ja)}</span>`;
      const sourceColor = item.source ? sourceColorMap[item.source] : null;
      const sourceBadge = item.source ? `<span class="badge badge-source" style="--badge-color:${sourceColor}">${escapeHtml(item.source)}</span>` : "";
      const genreBadges = (item.genre || []).map((g) => `<span class="badge">${genreIconMap[g] || ""} ${escapeHtml(g)}</span>`).join("");
      const notesLine = item.notes ? `<div class="card-notes"><span class="card-line-icon" aria-hidden="true">📝</span>${escapeHtml(item.notes)}</div>` : "";
      return `
        <div class="card">
          <button class="card-main" data-id="${item.id}">
            <div class="card-top">
              <div class="card-name">${escapeHtml(item.name)}</div>
              ${visited ? '<span class="card-visited">訪問済み</span>' : ""}
            </div>
            <div class="card-badges">${areaBadge}${sourceBadge}${genreBadges}</div>
            <div class="card-menu"><span class="card-line-icon" aria-hidden="true">🍽️</span>${escapeHtml(item.menu || "")}</div>
            ${notesLine}
          </button>
          <div class="card-links">
            <button type="button" class="card-link-btn card-link-detail" data-id="${item.id}">詳細</button>
            <a class="card-link-btn card-link-naver" href="${item.naver_url || "#"}" target="_blank" rel="noopener">Naver</a>
            <a class="card-link-btn card-link-google" href="${buildGoogleUrl(item)}" target="_blank" rel="noopener">Google</a>
          </div>
        </div>
      `;
    }).join("");
    el.querySelectorAll(".card-main").forEach((card) => {
      card.addEventListener("click", () => focusOnMap(card.dataset.id));
    });
    el.querySelectorAll(".card-link-detail").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.dataset.id));
    });
  }

  // ---------- Map ----------
  function ensureMapInit() {
    if (mapProvider) return;
    mapProvider = new LeafletMapProvider("map");
    mapProvider.init([35.1595, 129.0756], 12); // Busan city center
    mapProvider.renderTransitLayer(TRANSIT_LINES, LANDMARKS);
  }

  function renderMap(items) {
    ensureMapInit();
    mapProvider.setMarkers(items.filter((i) => i.lat != null), (id) => openDetail(id));
  }

  function focusOnMap(id) {
    const item = RESTAURANTS_DATA.find((r) => r.id === id);
    if (!item || item.lat == null) {
      openDetail(id);
      return;
    }
    ensureMapInit();
    document.getElementById("map-container").scrollIntoView({ behavior: "smooth", block: "start" });
    mapProvider.focusMarker(id);
  }

  // ---------- Detail sheet ----------
  function openDetail(id) {
    const item = RESTAURANTS_DATA.find((r) => r.id === id);
    if (!item) return;
    const body = document.getElementById("detail-body");
    const visited = isVisited(item);
    const genreBadges = (item.genre || []).map((g) => `<span class="badge">${escapeHtml(g)}</span>`).join("");
    const approxNote = item.geo_precision === "dong_level"
      ? '<div class="detail-label" style="margin-top:4px;">※地図上の位置はエリアのおおよその中心です</div>' : "";

    body.innerHTML = `
      <div class="detail-name">${escapeHtml(item.name)}</div>
      <div class="detail-area"><span class="card-line-dot" style="background:${lineColorSafe(item.line)}"></span>${escapeHtml(item.area_ja)}${item.area_ko ? " ・ " + escapeHtml(item.area_ko) : ""}</div>
      <div class="card-badges">${genreBadges}</div>

      <div class="detail-section">
        <div class="detail-label">代表メニュー</div>
        <div class="detail-value">${escapeHtml(item.menu || "-")}</div>
      </div>

      ${item.source ? `<div class="detail-section"><div class="detail-label">出典・番組</div><div class="detail-value">${escapeHtml(item.source)}</div></div>` : ""}
      ${item.notes ? `<div class="detail-section"><div class="detail-label">特記</div><div class="detail-value">${escapeHtml(item.notes)}</div></div>` : ""}

      <div class="detail-section">
        <div class="detail-label">住所（道路表記）</div>
        <button class="detail-address-btn" data-copy="${escapeHtml(item.address_road || "")}">${escapeHtml(item.address_road || "-")}</button>
      </div>
      <div class="detail-section">
        <div class="detail-label">住所（番地表記）</div>
        <button class="detail-address-btn" data-copy="${escapeHtml(item.address_lot || "")}">${escapeHtml(item.address_lot || "-")}</button>
      </div>
      ${approxNote}

      <div class="detail-actions">
        <a class="map-link-btn map-link-naver" target="_blank" rel="noopener" href="${item.naver_url || "#"}">Naverで開く</a>
        <a class="map-link-btn map-link-google" target="_blank" rel="noopener" href="${buildGoogleUrl(item)}">Googleで開く</a>
      </div>

      <div class="visited-row">
        <label>
          <input type="checkbox" id="detail-visited-checkbox" ${visited ? "checked" : ""}>
          <span>訪問済みにする</span>
        </label>
      </div>
    `;

    body.querySelectorAll(".detail-address-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.dataset.copy;
        if (text && navigator.clipboard) {
          navigator.clipboard.writeText(text).then(() => {
            const original = btn.textContent;
            btn.textContent = "コピーしました";
            setTimeout(() => { btn.textContent = original; }, 1200);
          }).catch(() => {});
        }
      });
    });
    const checkbox = document.getElementById("detail-visited-checkbox");
    checkbox.addEventListener("change", () => {
      toggleVisited(item);
      refresh();
    });

    document.getElementById("detail-sheet").classList.remove("hidden");
    document.getElementById("backdrop").classList.remove("hidden");
  }
  function closeDetail() {
    document.getElementById("detail-sheet").classList.add("hidden");
    document.getElementById("backdrop").classList.add("hidden");
  }

  // ---------- Panel mode (filters <-> results) ----------
  function setPanelMode(mode) {
    state.panelMode = mode;
    const filtersSection = document.getElementById("filters-section");
    const listView = document.getElementById("list-view");
    const activeFiltersBar = document.getElementById("active-filters-bar");
    const btn = document.getElementById("panel-mode-btn");
    const icon = document.getElementById("panel-mode-icon");
    const label = document.getElementById("panel-mode-label");
    if (mode === "filters") {
      filtersSection.hidden = false;
      listView.hidden = true;
      activeFiltersBar.hidden = true;
      btn.classList.remove("active");
      icon.textContent = "🔍";
      label.textContent = "検索";
    } else {
      filtersSection.hidden = true;
      listView.hidden = false;
      activeFiltersBar.hidden = false;
      btn.classList.add("active");
      icon.textContent = "✕";
      label.textContent = "閉じる";
    }
  }

  // ---------- Active filters summary ----------
  function removeSearchFilter() {
    state.search = "";
    document.getElementById("search-input").value = "";
    refresh();
  }
  function removeGenreFilter(g) {
    state.genres.delete(g);
    document.querySelectorAll("#genre-chips .chip").forEach((c) => {
      if (c.dataset.genre === g) c.classList.remove("active");
    });
    document.querySelector("#genre-chips .chip-all").classList.toggle("active", state.genres.size === 0);
    refresh();
  }
  function removeAreaFilter() {
    state.stationKey = null;
    document.querySelectorAll("#area-chips .chip").forEach((c) => c.classList.remove("active"));
    document.querySelector("#area-chips .chip-all").classList.add("active");
    refresh();
  }
  function removeSourceFilter() {
    state.source = "";
    document.querySelectorAll("#source-chips .chip").forEach((c) => c.classList.remove("active"));
    document.querySelector("#source-chips .chip-all").classList.add("active");
    refresh();
  }
  function removeVisitedFilter() {
    state.visitedOnly = false;
    document.getElementById("visited-filter").checked = false;
    refresh();
  }

  function renderActiveFiltersBar() {
    const bar = document.getElementById("active-filters-bar");
    const pills = [];
    if (state.search) pills.push({ label: `🔍 "${state.search}"`, onRemove: removeSearchFilter });
    state.genres.forEach((g) => pills.push({ label: `${genreIconMap[g] || ""} ${g}`, onRemove: () => removeGenreFilter(g) }));
    if (state.stationKey) {
      const areaJa = state.stationKey.split("|")[1];
      pills.push({ label: `📍 ${areaJa}`, onRemove: removeAreaFilter });
    }
    if (state.source) pills.push({ label: state.source, onRemove: removeSourceFilter });
    if (state.visitedOnly) pills.push({ label: "訪問済みのみ", onRemove: removeVisitedFilter });

    if (pills.length === 0) { bar.innerHTML = ""; return; }
    bar.innerHTML = pills.map((p, i) => (
      `<span class="active-filter-pill" data-i="${i}">${escapeHtml(p.label)}<button type="button" aria-label="この条件を削除">✕</button></span>`
    )).join("");
    bar.querySelectorAll(".active-filter-pill").forEach((el, i) => {
      el.querySelector("button").addEventListener("click", pills[i].onRemove);
    });
  }

  // ---------- Google Sheet sync ----------
  // Parses standard CSV (as exported by Google Sheets' "Publish to web"),
  // handling quoted fields with embedded commas/newlines/escaped quotes.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\r") {
        // skip
      } else if (c === "\n") {
        row.push(field); rows.push(row); row = []; field = "";
      } else {
        field += c;
      }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    if (rows.length === 0) return [];
    const header = rows[0].map((h) => h.trim());
    return rows.slice(1)
      .filter((r) => r.some((c) => c.trim() !== ""))
      .map((r) => {
        const obj = {};
        header.forEach((h, idx) => { obj[h] = (r[idx] || "").trim(); });
        return obj;
      });
  }

  function parseSheetBool(v) {
    if (!v) return false;
    const s = String(v).trim().toUpperCase();
    return s === "TRUE" || s === "1" || s === "YES" || s === "○" || s === "✓";
  }

  // Merge live sheet rows onto the static (geocoded + genre-tagged) base
  // dataset, matched by store name. Editable fields come from the sheet;
  // genre/coordinates always come from the base dataset since those need
  // the offline pipeline (see docs/sheet-sync.md). Rows with a name not
  // found in the base dataset are new additions - they're shown in search
  // results but have no map position or genre until a re-sync happens.
  function mergeSheetRows(sheetRows) {
    const byName = {};
    RESTAURANTS.forEach((r) => { byName[r.name] = r; });
    const merged = [];
    sheetRows.forEach((row, idx) => {
      const name = row.name_ko && row.name_ko.trim();
      if (!name) return;
      const base = byName[name];
      if (base) {
        merged.push({
          ...base,
          line: row.line ? row.line.replace(/号線/, "").trim() || base.line : base.line,
          area_ja: row.area_ja || base.area_ja,
          area_ko: row.area_ko || base.area_ko,
          naver_url: row.naver_url || base.naver_url,
          google_url: row.google_url || base.google_url,
          address_road: row.address_road || base.address_road,
          address_lot: row.address_lot || base.address_lot,
          menu: row.menu || base.menu,
          source: row.source || base.source,
          notes: row.notes || base.notes,
          visited: row.visited ? parseSheetBool(row.visited) : base.visited,
        });
      } else {
        merged.push({
          id: "sheet_" + idx,
          seq: 9000 + idx,
          type: "food",
          visited: parseSheetBool(row.visited),
          line: row.line ? row.line.replace(/号線/, "").trim() : "",
          area_ja: row.area_ja || "",
          area_ko: row.area_ko || "",
          name: name,
          genre: ["その他"],
          menu: row.menu || "",
          source: row.source || null,
          notes: (row.notes ? row.notes + " " : "") + "⚠️新規追加分・地図未反映(Claudeに再同期を依頼してください)",
          address_road: row.address_road || null,
          address_lot: row.address_lot || null,
          naver_url: row.naver_url || null,
          google_url: row.google_url || null,
          lat: null,
          lon: null,
          geo_precision: "unmapped",
        });
      }
    });
    return merged;
  }

  async function trySyncFromSheet() {
    if (!SHEET_CSV_URL) return;
    try {
      const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      const rows = parseCsv(text);
      if (rows.length === 0) throw new Error("empty sheet");
      RESTAURANTS_DATA = mergeSheetRows(rows);
    } catch (e) {
      console.warn("Sheet sync failed, using bundled data.js instead.", e);
      RESTAURANTS_DATA = RESTAURANTS;
    }
  }

  // ---------- Refresh ----------
  function refresh() {
    const filtered = getFiltered();
    document.getElementById("result-count").textContent = `${filtered.length} / ${RESTAURANTS_DATA.length} 店舗`;
    renderActiveFiltersBar();
    renderList(filtered);
    renderMap(filtered);
  }

  // ---------- Init ----------
  async function init() {
    ensureMapInit();
    renderAreaChips();
    await trySyncFromSheet();
    renderGenreChips();
    renderSourceChips();
    setPanelMode("filters");

    document.getElementById("search-input").addEventListener("input", (e) => {
      state.search = e.target.value.trim();
      refresh();
    });

    document.getElementById("visited-filter").addEventListener("change", (e) => {
      state.visitedOnly = e.target.checked;
      refresh();
    });

    document.getElementById("clear-filters-btn").addEventListener("click", () => {
      state.search = "";
      state.genres.clear();
      state.stationKey = null;
      state.visitedOnly = false;
      state.source = "";
      document.getElementById("search-input").value = "";
      document.getElementById("visited-filter").checked = false;
      document.querySelectorAll("#area-chips .chip").forEach((c) => c.classList.remove("active"));
      document.querySelector("#area-chips .chip-all").classList.add("active");
      document.querySelectorAll("#genre-chips .chip").forEach((c) => c.classList.remove("active"));
      document.querySelector("#genre-chips .chip-all").classList.add("active");
      document.querySelectorAll("#source-chips .chip").forEach((c) => c.classList.remove("active"));
      document.querySelector("#source-chips .chip-all").classList.add("active");
      refresh();
    });

    document.getElementById("panel-mode-btn").addEventListener("click", () => {
      setPanelMode(state.panelMode === "filters" ? "results" : "filters");
    });

    document.getElementById("detail-close").addEventListener("click", closeDetail);
    document.getElementById("backdrop").addEventListener("click", closeDetail);

    document.getElementById("map-expand-btn").addEventListener("click", () => {
      const container = document.getElementById("map-container");
      const icon = document.getElementById("map-expand-icon");
      const expanded = container.classList.toggle("expanded");
      icon.textContent = expanded ? "⤡" : "⤢";
      document.getElementById("map-expand-btn").setAttribute("aria-label", expanded ? "地図を縮小" : "地図を拡大");
      setTimeout(() => { if (mapProvider) mapProvider.invalidateSize(); }, 260);
    });

    refresh();

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
