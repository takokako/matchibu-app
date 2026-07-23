// Map provider abstraction.
//
// Beta uses Leaflet + CartoDB Positron tiles (no API key required, light/low-clutter
// basemap). To switch to Naver Maps once a Naver Cloud Platform Maps API key is
// available (see docs/naver-maps-setup.md), implement a NaverMapProvider with the
// same method signatures and swap the instantiation in app.js.

const LINE_COLORS = { "1": "#e2231a", "2": "#34a853", "3": "#a9812d", "BGL": "#8e44ad" };
const LINE_DISPLAY_NAMES = { "1": "1号線", "2": "2号線", "3": "3号線", "BGL": "釜山金海軽電鉄" };
const DEFAULT_PIN_COLOR = "#555555";

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function makeRestaurantIcon(item) {
  const isSpot = item.type === "spot";
  const bg = isSpot ? "#555555" : "#c81e2c";
  return L.divIcon({
    className: "matchbu-pin",
    html: `<div style="
        width:22px;height:22px;
        background:${bg};
        border:2px solid #fff;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        box-shadow:0 1px 4px rgba(0,0,0,0.45);
      "></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -20],
  });
}

// Every station gets a readable name label; major (has-a-saved-restaurant,
// or a real line interchange) stations render bigger/bolder, everything
// else uses the same visual style just a size step down. Always visible -
// no zoom-gating or hover-to-reveal - since legibility comes first.
function makeStationLabelIcon(line, label, isMajor) {
  const color = LINE_COLORS[line] || DEFAULT_PIN_COLOR;
  const cls = isMajor ? "station-badge station-badge-major" : "station-badge station-badge-minor";
  return L.divIcon({
    className: "matchbu-station-badge",
    html: `<span class="${cls}" style="border-color:${color};color:${color};">${escapeHtml(label)}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function makeLandmarkIcon(landmark) {
  return L.divIcon({
    className: "matchbu-landmark",
    html: `<span class="landmark-badge"><span aria-hidden="true">${landmark.icon}</span>${escapeHtml(landmark.name_ja)}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

class LeafletMapProvider {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.markers = [];
    this.markerById = {};
  }

  init(center, zoom) {
    if (this.map) return;
    this.map = L.map(this.containerId, { zoomControl: true }).setView(center, zoom);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(this.map);
  }

  renderTransitLayer(transitLines, landmarks) {
    if (!this.map) return;

    // Line polylines + station dots (bottom layer, static context).
    Object.keys(transitLines).forEach((lineRef) => {
      const stations = transitLines[lineRef];
      const color = LINE_COLORS[lineRef] || DEFAULT_PIN_COLOR;
      const latlngs = stations.map((s) => [s.lat, s.lon]);
      L.polyline(latlngs, { color, weight: 3, opacity: 0.75 }).addTo(this.map);

      stations.forEach((s) => {
        const label = s.name_ja || s.area_ja || s.name_en;
        if (!label) return;
        L.marker([s.lat, s.lon], { icon: makeStationLabelIcon(lineRef, label, !!s.highlighted), interactive: false }).addTo(this.map);
        L.circleMarker([s.lat, s.lon], {
          radius: s.highlighted ? 4 : 3,
          color: "#fff",
          weight: 1.5,
          fillColor: color,
          fillOpacity: 1,
        }).addTo(this.map);
      });
    });

    // Landmarks (above lines, below restaurant pins).
    landmarks.forEach((lm) => {
      L.marker([lm.lat, lm.lon], { icon: makeLandmarkIcon(lm), interactive: false }).addTo(this.map);
    });

    this.addLegend();
  }

  addLegend() {
    const legend = L.control({ position: "bottomleft" });
    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "map-legend");
      div.innerHTML = `
        <div class="map-legend-row"><span class="map-legend-swatch" style="background:${LINE_COLORS['1']}"></span>${LINE_DISPLAY_NAMES['1']}</div>
        <div class="map-legend-row"><span class="map-legend-swatch" style="background:${LINE_COLORS['2']}"></span>${LINE_DISPLAY_NAMES['2']}</div>
        <div class="map-legend-row"><span class="map-legend-swatch" style="background:${LINE_COLORS['3']}"></span>${LINE_DISPLAY_NAMES['3']}</div>
        <div class="map-legend-row"><span class="map-legend-swatch" style="background:${LINE_COLORS['BGL']}"></span>${LINE_DISPLAY_NAMES['BGL']}</div>
        <div class="map-legend-row"><span class="map-legend-dot" style="background:#c81e2c"></span>お店</div>
      `;
      L.DomEvent.disableClickPropagation(div);
      return div;
    };
    legend.addTo(this.map);
  }

  clearMarkers() {
    this.markers.forEach((m) => this.map.removeLayer(m));
    this.markers = [];
    this.markerById = {};
  }

  setMarkers(items, onClick) {
    this.clearMarkers();
    items.forEach((item) => {
      if (item.lat == null || item.lon == null) return;
      const marker = L.marker([item.lat, item.lon], { icon: makeRestaurantIcon(item), zIndexOffset: 1000 });
      const approx = item.geo_precision === "dong_level" ? "（位置はおおよそ）" : "";
      marker.bindPopup(
        `<div class="map-popup-name">${escapeHtml(item.name)}${approx}</div>` +
        `<div>${escapeHtml(item.menu || "")}</div>` +
        `<a href="#" class="map-popup-link" data-id="${item.id}">詳細を見る</a>`
      );
      marker.on("popupopen", () => {
        const el = document.querySelector(`.map-popup-link[data-id="${item.id}"]`);
        if (el) {
          el.addEventListener("click", (e) => {
            e.preventDefault();
            onClick(item.id);
          });
        }
      });
      marker.addTo(this.map);
      this.markers.push(marker);
      this.markerById[item.id] = marker;
    });
  }

  focusMarker(itemId) {
    const marker = this.markerById[itemId];
    if (!marker || !this.map) return;
    const targetZoom = Math.max(this.map.getZoom(), 16);
    this.map.setView(marker.getLatLng(), targetZoom, { animate: true });
    marker.openPopup();
  }

  panTo(lat, lon, zoom) {
    if (!this.map) return;
    this.map.setView([lat, lon], zoom || 15);
  }

  invalidateSize() {
    if (this.map) this.map.invalidateSize();
  }
}
