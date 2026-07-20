(function () {
  "use strict";

  const VISITED_KEY = "matchbu_visited_overrides_v1";
  const GENRE_ORDER = [
    "クッパ・スープ", "麺類", "焼肉・肉料理", "海鮮・刺身",
    "鍋・チゲ", "軽食・屋台グルメ", "市場・買い物・両替", "その他",
  ];

  const state = {
    search: "",
    genres: new Set(),
    stationKey: null, // `${line}|${area_ja}` or null for all
    visitedOnly: false,
    source: "",
    view: "list",
  };

  let visitedOverrides = loadVisitedOverrides();
  let mapProvider = null;
  let mapInitialized = false;

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
    return RESTAURANTS.filter(matchesFilters);
  }

  // ---------- Genre chips ----------
  function allGenresPresent() {
    const set = new Set();
    RESTAURANTS.forEach((r) => (r.genre || []).forEach((g) => set.add(g)));
    const ordered = GENRE_ORDER.filter((g) => set.has(g));
    set.forEach((g) => { if (!ordered.includes(g)) ordered.push(g); });
    return ordered;
  }

  function renderGenreChips() {
    const container = document.getElementById("genre-chips");
    const genres = allGenresPresent();
    container.innerHTML = genres.map((g) => (
      `<button class="chip" data-genre="${escapeHtml(g)}">${escapeHtml(g)}</button>`
    )).join("");
    container.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const g = btn.dataset.genre;
        if (state.genres.has(g)) { state.genres.delete(g); btn.classList.remove("active"); }
        else { state.genres.add(g); btn.classList.add("active"); }
        refresh();
      });
    });
  }

  // ---------- Source filter ----------
  function renderSourceOptions() {
    const select = document.getElementById("source-filter");
    const counts = new Map();
    RESTAURANTS.forEach((r) => {
      if (r.source) counts.set(r.source, (counts.get(r.source) || 0) + 1);
    });
    const sources = Array.from(counts.keys()).sort((a, b) => counts.get(b) - counts.get(a));
    select.innerHTML = '<option value="">出典・番組: すべて</option>' +
      sources.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)} (${counts.get(s)})</option>`).join("");
    select.addEventListener("change", () => {
      state.source = select.value;
      refresh();
    });
  }

  // ---------- Station picker ----------
  function renderStationSheet() {
    const listEl = document.getElementById("station-list");
    const byLine = {};
    STATIONS.forEach((s) => {
      if (!byLine[s.line]) byLine[s.line] = [];
      byLine[s.line].push(s);
    });
    const lineNames = { "1": "1号線", "2": "2号線", "3": "3号線" };
    let html = "";
    Object.keys(byLine).sort().forEach((line) => {
      html += `<div class="station-group-title"><span class="card-line-dot" style="background:${lineColorSafe(line)}"></span>${escapeHtml(lineNames[line] || line)}</div>`;
      byLine[line].forEach((s) => {
        const key = `${s.line}|${s.area_ja}`;
        const koLabel = s.area_ko ? `<span class="station-item-sub">${escapeHtml(s.area_ko)}</span>` : "";
        html += `<button class="station-item" data-key="${escapeHtml(key)}" data-lat-lon="1">${escapeHtml(s.area_ja)}${koLabel}</button>`;
      });
    });
    listEl.innerHTML = html;
    listEl.querySelectorAll(".station-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.stationKey = btn.dataset.key;
        closeStationSheet();
        refresh();
        focusStationOnMap(state.stationKey);
      });
    });
  }

  function lineColorSafe(line) {
    return { "1": "#f0631e", "2": "#3fa74a", "3": "#a9812d" }[line] || "#777";
  }

  function focusStationOnMap(stationKey) {
    if (!stationKey) return;
    const items = RESTAURANTS.filter((r) => `${r.line}|${r.area_ja}` === stationKey && r.lat != null);
    if (items.length === 0) return;
    if (state.view !== "map") switchView("map");
    ensureMapInit();
    const avgLat = items.reduce((s, r) => s + r.lat, 0) / items.length;
    const avgLon = items.reduce((s, r) => s + r.lon, 0) / items.length;
    mapProvider.panTo(avgLat, avgLon, 15);
  }

  function openStationSheet() {
    document.getElementById("station-sheet").classList.remove("hidden");
    document.getElementById("backdrop").classList.remove("hidden");
  }
  function closeStationSheet() {
    document.getElementById("station-sheet").classList.add("hidden");
    document.getElementById("backdrop").classList.add("hidden");
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
      const genreBadges = (item.genre || []).map((g) => `<span class="badge">${escapeHtml(g)}</span>`).join("");
      const sourceBadge = item.source ? `<span class="badge badge-source">${escapeHtml(item.source)}</span>` : "";
      return `
        <button class="card" data-id="${item.id}">
          <div class="card-top">
            <div>
              <div class="card-name">${escapeHtml(item.name)}</div>
              <div class="card-area"><span class="card-line-dot" style="background:${lineColorSafe(item.line)}"></span>${escapeHtml(item.area_ja)}</div>
            </div>
            ${visited ? '<span class="card-visited">訪問済み</span>' : ""}
          </div>
          <div class="card-menu">${escapeHtml(item.menu || "")}</div>
          <div class="card-badges">${genreBadges}${sourceBadge}</div>
        </button>
      `;
    }).join("");
    el.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("click", () => openDetail(card.dataset.id));
    });
  }

  // ---------- Map rendering ----------
  function ensureMapInit() {
    if (mapInitialized) return;
    mapProvider = new LeafletMapProvider("map");
    mapProvider.init([35.1595, 129.0756], 12); // Busan city center
    mapInitialized = true;
  }

  function renderMap(items) {
    ensureMapInit();
    mapProvider.setMarkers(items.filter((i) => i.lat != null), (id) => openDetail(id));
    setTimeout(() => mapProvider.invalidateSize(), 50);
  }

  // ---------- Detail sheet ----------
  function openDetail(id) {
    const item = RESTAURANTS.find((r) => r.id === id);
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

  // ---------- View switching ----------
  function switchView(view) {
    state.view = view;
    document.querySelectorAll(".view-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === view);
    });
    document.getElementById("list-view").hidden = view !== "list";
    document.getElementById("map-view").hidden = view !== "map";
    if (view === "map") {
      renderMap(getFiltered());
    }
  }

  // ---------- Refresh ----------
  function refresh() {
    const filtered = getFiltered();
    document.getElementById("result-count").textContent = `${filtered.length}件のお店`;
    renderList(filtered);
    if (state.view === "map") renderMap(filtered);
  }

  // ---------- Wire up static controls ----------
  function init() {
    renderGenreChips();
    renderSourceOptions();
    renderStationSheet();

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
      document.getElementById("source-filter").value = "";
      document.querySelectorAll("#genre-chips .chip").forEach((c) => c.classList.remove("active"));
      refresh();
    });

    document.querySelectorAll(".view-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });

    document.getElementById("station-picker-btn").addEventListener("click", openStationSheet);
    document.getElementById("station-close").addEventListener("click", closeStationSheet);
    document.getElementById("station-all-btn").addEventListener("click", () => {
      state.stationKey = null;
      closeStationSheet();
      refresh();
    });

    document.getElementById("detail-close").addEventListener("click", closeDetail);
    document.getElementById("backdrop").addEventListener("click", () => {
      closeDetail();
      closeStationSheet();
    });

    refresh();

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
