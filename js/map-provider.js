// Map provider abstraction.
//
// Beta uses Leaflet + CartoDB Positron tiles (no API key required, light/low-clutter
// basemap). To switch to Naver Maps once a Naver Cloud Platform Maps API key is
// available (see docs/naver-maps-setup.md), implement a NaverMapProvider with the
// same method signatures and swap the instantiation in app.js.

const LINE_COLORS = {
  "1": "#f0631e",
  "2": "#3fa74a",
  "3": "#a9812d",
};
const DEFAULT_PIN_COLOR = "#555555";

function lineColor(line) {
  return LINE_COLORS[line] || DEFAULT_PIN_COLOR;
}

function makeDivIcon(item) {
  const color = lineColor(item.line);
  const shape = item.type === "spot" ? "50% 50% 50% 0" : "50%";
  const rotate = item.type === "spot" ? "rotate(-45deg)" : "none";
  return L.divIcon({
    className: "matchbu-pin",
    html: `<span style="
        display:block;
        width:16px;height:16px;
        background:${color};
        border:2px solid #fff;
        border-radius:${shape};
        transform:${rotate};
        box-shadow:0 1px 4px rgba(0,0,0,0.4);
      "></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });
}

class LeafletMapProvider {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.markers = [];
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

  clearMarkers() {
    this.markers.forEach((m) => this.map.removeLayer(m));
    this.markers = [];
  }

  setMarkers(items, onClick) {
    this.clearMarkers();
    items.forEach((item) => {
      if (item.lat == null || item.lon == null) return;
      const marker = L.marker([item.lat, item.lon], { icon: makeDivIcon(item) });
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
    });
  }

  fitToMarkers() {
    if (this.markers.length === 0) return;
    const group = L.featureGroup(this.markers);
    this.map.fitBounds(group.getBounds().pad(0.2));
  }

  panTo(lat, lon, zoom) {
    if (!this.map) return;
    this.map.setView([lat, lon], zoom || 15);
  }

  invalidateSize() {
    if (this.map) this.map.invalidateSize();
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
