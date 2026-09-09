"use strict";

/* =========================================================
   CONFIGURATION API
========================================================= */

const API_BASE_URL =
  window.SIG_API_BASE_URL || "http://localhost:4000";

const SCHOOLS_API_URL =
  API_BASE_URL + "/api/ecoles";

const API_TEST_DB =
  API_BASE_URL + "/api/test-db";


/* =========================================================
   ETAT GLOBAL
========================================================= */

const STATE = {

  raw: [],
  filtered: [],

  selectedSchool: null,

  filters: {
    search: "",
    commune: [],
    quartier: [],
    type_ecole: [],
    niveau: [],
    statut_fonctionnement: []
  },

  charts: {},

  mapInitialized: false,
  apiConnected: false,

  currentModule: "accueil",

  userLocation: null

};


/* =========================================================
   OUTILS
========================================================= */

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(value) {
  return numberValue(value).toLocaleString("fr-FR");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/* =========================================================
   STATUT DE FONCTIONNEMENT (matching tolérant)
   Les données réelles peuvent contenir des variantes
   ("fonctionnel" / "fonctionnelle", "non fonctionnel" /
   "non-fonctionnelle" / "Non Fonctionnel", etc.).
   L'ancien code comparait avec une égalité stricte sur
   "fonctionnel" / "non fonctionnel", ce qui faisait passer
   à travers les mailles du filet toute variante avec un
   accord au féminin ou un tiret : d'où des écoles non
   fonctionnelles absentes des compteurs. On normalise plus
   largement (accents, tiret/espace, espaces multiples) et on
   teste des motifs plutôt qu'une égalité exacte.
========================================================= */

function normalizeStatus(value) {
  return normalizeText(value)
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNonFunctional(school) {
  const status = normalizeStatus(school && school.statut_fonctionnement);
  return status.includes("non") && status.includes("fonctionnel");
}

function isFunctional(school) {
  const status = normalizeStatus(school && school.statut_fonctionnement);
  return status.includes("fonctionnel") && !status.includes("non");
}


/* =========================================================
   MACHINE À ÉCRIRE — titre d'accueil
========================================================= */

function typewriter(el, cursorEl, text, speed = 45) {

  if (!el) return;

  let i = 0;

  el.innerHTML = "";

  if (cursorEl) {
    cursorEl.style.display = "";
  }

  function step() {

    if (i <= text.length) {

      const slice = text.slice(0, i);
      el.innerHTML = escapeHtml(slice).replace(/\n/g, "<br>");

      i++;
      setTimeout(step, speed);

    }

  }

  step();

}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) { el.textContent = value; }
}

function toast(message, type = "info") {
  const stack = document.getElementById("toastStack");
  if (!stack) return;
  const item = document.createElement("div");
  item.className = "toast " + type;
  item.textContent = message;
  stack.appendChild(item);
  setTimeout(() => {
    item.style.opacity = "0";
    setTimeout(() => item.remove(), 300);
  }, 3500);
}


/* =========================================================
   NORMALISATION DES ECOLES
========================================================= */

function normalizeSchool(row, index) {
  row = row || {};

  let latitude = row.latitude ?? row.lat ?? null;
  let longitude = row.longitude ?? row.lon ?? row.lng ?? null;

  if ((latitude === null || longitude === null) && row.localisation) {
    const parts = String(row.localisation).trim().split(/\s+/);
    if (parts.length >= 2) {
      const a = Number(parts[0]);
      const b = Number(parts[1]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
          latitude = a;
          longitude = b;
        }
      }
    }
  }

  return {
    id_ecole: row.id_ecole ?? row._id ?? row.id ?? ("ECOLE-" + (index + 1)),
    nom_ecole: row.nom_ecole ?? row.nom ?? row.name ?? "École sans nom",
    type_ecole: row.type_ecole ?? row.type ?? "",
    niveau: row.niveau ?? "",
    commune: row.commune ?? "",
    quartier: row.quartier ?? "",
    adresse: row.adresse ?? "",
    latitude: latitude,
    longitude: longitude,
    effectif_total: numberValue(row.effectif_total ?? row.effectif ?? 0),
    nombre_classes: numberValue(row.nombre_classes ?? row.classes ?? 0),
    statut_fonctionnement: row.statut_fonctionnement ?? row.statut ?? "",
    annee_creation: row.annee_creation ?? "",
    source_donnee: row.source_donnee ?? "",
    date_collecte: row.date_collecte ?? ""
  };
}


/* =========================================================
   API — CHARGEMENT DES ECOLES
========================================================= */

async function fetchSchoolsFromAPI() {

  setText("statusText", "Connexion à l'API...");

  try {

    const response = await fetch(SCHOOLS_API_URL, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      throw new Error("Erreur HTTP " + response.status);
    }

    const json = await response.json();

    let rows = [];

    if (Array.isArray(json)) { rows = json; }
    else if (Array.isArray(json.data)) { rows = json.data; }
    else if (Array.isArray(json.ecoles)) { rows = json.ecoles; }
    else if (Array.isArray(json.rows)) { rows = json.rows; }
    else if (Array.isArray(json.results)) { rows = json.results; }
    else { throw new Error("Format de données API inconnu"); }

    STATE.raw = rows.map(normalizeSchool);
    STATE.filtered = STATE.raw.slice();
    STATE.apiConnected = true;

    setText("statusText", "Données connectées");

    const pill = document.getElementById("statusPill");
    if (pill) { pill.classList.add("connected"); }

    refreshFilterOptions();
    applyFilters();
    updateKPIs();
    updateTicker();
    renderTable();
    updateMap();
    renderStats();

    return STATE.raw;

  }
  catch (error) {

    console.error("Erreur chargement écoles :", error);
    STATE.apiConnected = false;
    setText("statusText", "API indisponible");
    toast("Impossible de charger les données depuis Node.js.", "error");
    return [];

  }

}


/* =========================================================
   TEST POSTGRESQL
========================================================= */

async function testPostgresConnection() {

  const response = await fetch(API_TEST_DB, {
    method: "GET",
    headers: { "Accept": "application/json" }
  });

  if (!response.ok) {
    throw new Error("HTTP " + response.status);
  }

  return await response.json();

}

async function handleDatabaseTest() {

  const status = document.getElementById("postgresStatus");
  const count = document.getElementById("postgresCount");

  if (status) { status.textContent = "Test en cours..."; }

  try {

    const result = await testPostgresConnection();

    if (result && result.success === false) {
      throw new Error(result.message || "Connexion PostgreSQL refusée");
    }

    if (status) { status.textContent = "✓ PostgreSQL connecté"; }

    if (count) {
      count.textContent = formatNumber(STATE.raw.length) + " école(s) disponible(s)";
    }

    toast("Connexion PostgreSQL réussie.", "success");

  }
  catch (error) {

    console.error(error);
    if (status) { status.textContent = "✕ Connexion impossible"; }
    toast("Impossible de tester PostgreSQL.", "error");

  }

}


/* =========================================================
   KPI
========================================================= */

function updateKPIs() {

  const rows = STATE.filtered;
  const total = rows.length;

  const students = rows.reduce((sum, e) => sum + numberValue(e.effectif_total), 0);

  const functional = rows.filter(isFunctional).length;

  const communes = new Set(rows.map(e => e.commune).filter(Boolean)).size;

  const rate = total > 0 ? Math.round(functional * 100 / total) : 0;

  setText("kpiTotal", formatNumber(total));
  setText("kpiEffectif", formatNumber(students));
  setText("kpiFonctionnel", rate + "%");
  setText("kpiCommunes", formatNumber(communes));
  setText("filterCount", formatNumber(rows.length) + " / " + formatNumber(STATE.raw.length));

  updateFlagStrip();

}


/* =========================================================
   BANDE DRAPEAU DU MALI — DEVENUE UNE VRAIE BARRE DE DONNEES
   Auparavant purement décorative (3 tiers fixes et égaux),
   elle ne reflétait donc jamais le nombre réel d'écoles non
   fonctionnelles. On calcule maintenant la largeur de chaque
   bande à partir des effectifs réels : vert = fonctionnelles,
   rouge = non fonctionnelles, jaune = statut inconnu/autre.
========================================================= */

function updateFlagStrip() {

  const rows = STATE.filtered;
  const total = rows.length;

  const greenBand = document.querySelector("#flagStrip .flag-green");
  const yellowBand = document.querySelector("#flagStrip .flag-yellow");
  const redBand = document.querySelector("#flagStrip .flag-red");

  if (!total) {
    if (greenBand) { greenBand.style.flex = "1 1 0"; }
    if (yellowBand) { yellowBand.style.flex = "1 1 0"; }
    if (redBand) { redBand.style.flex = "1 1 0"; }
    return;
  }

  const functional = rows.filter(isFunctional).length;
  const nonFunctional = rows.filter(isNonFunctional).length;
  const other = Math.max(0, total - functional - nonFunctional);

  const greenPct = (functional / total) * 100;
  const yellowPct = (other / total) * 100;
  const redPct = (nonFunctional / total) * 100;

  const MIN_VISIBLE = redPct > 0 ? Math.max(redPct, 1.5) : 0;

  if (greenBand) { greenBand.style.flex = "0 0 " + greenPct + "%"; }
  if (yellowBand) { yellowBand.style.flex = "0 0 " + yellowPct + "%"; }
  if (redBand) { redBand.style.flex = "0 0 " + MIN_VISIBLE + "%"; }

}


/* =========================================================
   TICKER
========================================================= */

function updateTicker() {

  const rows = STATE.filtered;
  const total = rows.length;

  const functional = rows.filter(isFunctional).length;

  const nonFunctional = rows.filter(isNonFunctional).length;

  const students = rows.reduce((sum, e) => sum + numberValue(e.effectif_total), 0);
  const classes = rows.reduce((sum, e) => sum + numberValue(e.nombre_classes), 0);

  setText("tkEcoles", formatNumber(total));
  setText("tkFonct", formatNumber(functional));
  setText("tkNonFonct", formatNumber(nonFunctional));
  setText("tkEleves", formatNumber(students));
  setText("tkClasses", formatNumber(classes));

}


/* =========================================================
   FILTRES
========================================================= */

function uniqueSorted(rows, field) {
  return [...new Set(
    rows.map(row => row[field]).filter(value => String(value ?? "").trim() !== "")
  )].sort((a, b) => String(a).localeCompare(String(b), "fr"));
}

function renderChecklist(containerId, values, selected, filterKey, displayFormatter) {

  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";

  values.forEach(value => {

    const label = document.createElement("label");
    label.className = "filter-check";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    input.checked = selected.includes(value);

    input.addEventListener("change", () => {
      readFilters();
      applyFilters();
    });

    const span = document.createElement("span");
    span.textContent = displayFormatter ? displayFormatter(value) : value;

    label.appendChild(input);
    label.appendChild(span);
    container.appendChild(label);

  });

}

function renderChips(containerId, values, selected, filterKey) {

  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";

  values.forEach(value => {

    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";

    if (selected.includes(value)) {
      button.classList.add("active");
    }

    button.textContent = value;

    button.addEventListener("click", () => {

      const list = STATE.filters[filterKey];
      const index = list.indexOf(value);

      if (index >= 0) { list.splice(index, 1); }
      else { list.push(value); }

      renderChips(containerId, values, STATE.filters[filterKey], filterKey);
      applyFilters();

    });

    container.appendChild(button);

  });

}

function refreshFilterOptions() {

  const rows = STATE.raw;

  renderChecklist("listCommune", uniqueSorted(rows, "commune"), STATE.filters.commune, "commune", formatCommuneLabel);
  renderChecklist("listQuartier", uniqueSorted(rows, "quartier"), STATE.filters.quartier, "quartier");
  renderChips("chipsType", uniqueSorted(rows, "type_ecole"), STATE.filters.type_ecole, "type_ecole");
  renderChips("chipsNiveau", uniqueSorted(rows, "niveau"), STATE.filters.niveau, "niveau");
  renderChips("chipsStatut", uniqueSorted(rows, "statut_fonctionnement"), STATE.filters.statut_fonctionnement, "statut_fonctionnement");

}

function readFilters() {

  const search = document.getElementById("searchInput");
  STATE.filters.search = search ? search.value.trim() : "";

  const getChecked = id => {
    const container = document.getElementById(id);
    if (!container) { return []; }
    return [...container.querySelectorAll("input:checked")].map(input => input.value);
  };

  STATE.filters.commune = getChecked("listCommune");
  STATE.filters.quartier = getChecked("listQuartier");

}

function applyFilters() {

  const f = STATE.filters;
  const query = normalizeText(f.search);

  STATE.filtered = STATE.raw.filter(school => {

    if (query) {
      const text = normalizeText([
        school.id_ecole, school.nom_ecole, school.commune, school.quartier,
        school.adresse, school.type_ecole, school.niveau
      ].join(" "));
      if (!text.includes(query)) { return false; }
    }

    if (f.commune.length && !f.commune.includes(school.commune)) { return false; }
    if (f.quartier.length && !f.quartier.includes(school.quartier)) { return false; }
    if (f.type_ecole.length && !f.type_ecole.includes(school.type_ecole)) { return false; }
    if (f.niveau.length && !f.niveau.includes(school.niveau)) { return false; }
    if (f.statut_fonctionnement.length && !f.statut_fonctionnement.includes(school.statut_fonctionnement)) { return false; }

    return true;

  });

  updateKPIs();
  updateTicker();
  renderTable();
  updateMap();
  renderStats();

}

function resetFilters() {

  STATE.filters = {
    search: "", commune: [], quartier: [], type_ecole: [], niveau: [], statut_fonctionnement: []
  };

  const search = document.getElementById("searchInput");
  if (search) { search.value = ""; }

  refreshFilterOptions();
  applyFilters();

  toast("Filtres réinitialisés.", "success");

}


/* =========================================================
   CARTE LEAFLET
========================================================= */

let map = null;
let markerLayer = null;
let markersById = {};

/* Fonds de carte (ajout : bascule OSM / Satellite) */
let baseLayerOSM = null;
let baseLayerSatellite = null;
let currentBaseLayer = "osm";

/* Localisation utilisateur sur la carte (bouton "Ma position") */
let userLocationMarker = null;


function initMap() {

  if (typeof L === "undefined") {
    console.error("Leaflet n'est pas chargé.");
    return;
  }

  if (map) { return; }

  map = L.map("map", {
    center: [12.6392, -8.0029],
    zoom: 12
  });

  baseLayerOSM = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19, attribution: "&copy; OpenStreetMap" }
  ).addTo(map);

  baseLayerSatellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Tiles &copy; Esri" }
  );

  if (L.markerClusterGroup) {
    markerLayer = L.markerClusterGroup();
  }
  else {
    markerLayer = L.layerGroup();
  }

  map.addLayer(markerLayer);

  map.on("mousemove", event => {
    setText(
      "coordReadout",
      "lat " + event.latlng.lat.toFixed(5) + " / lon " + event.latlng.lng.toFixed(5)
    );
  });

  STATE.mapInitialized = true;
  window.map = map;

  addMapOptionsControl();

}


/* ---------------------------------------------------------
   CONTROLE CARTE : changer de fond / ma position / plein écran
   (les 3 paramètres qui manquaient sur la carte)
--------------------------------------------------------- */

function toggleBaseLayer() {

  if (!map) { return; }

  if (currentBaseLayer === "osm") {

    if (baseLayerOSM) { map.removeLayer(baseLayerOSM); }
    if (baseLayerSatellite) { baseLayerSatellite.addTo(map); }

    currentBaseLayer = "satellite";
    toast("Fond satellite activé.", "success");

  }
  else {

    if (baseLayerSatellite) { map.removeLayer(baseLayerSatellite); }
    if (baseLayerOSM) { baseLayerOSM.addTo(map); }

    currentBaseLayer = "osm";
    toast("Fond OpenStreetMap activé.", "success");

  }

}

function locateUserOnMap() {

  if (!map) { return; }

  if (!navigator.geolocation) {
    toast("La géolocalisation n'est pas disponible.", "error");
    return;
  }

  toast("Recherche de votre position…", "info");

  navigator.geolocation.getCurrentPosition(

    position => {

      const latlng = [position.coords.latitude, position.coords.longitude];

      STATE.userLocation = latlng;

      if (userLocationMarker) {

        userLocationMarker.setLatLng(latlng);

      }
      else {

        const userIcon = L.divIcon({
          className: "user-location-marker",
          html:
            '<div style="' +
            'width:16px;height:16px;border-radius:50%;' +
            'background:#1d8f5a;border:3px solid #ffffff;' +
            'box-shadow:0 2px 8px rgba(0,0,0,.3);"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });

        userLocationMarker = L.marker(latlng, {
          icon: userIcon,
          zIndexOffset: 1000
        }).addTo(map);

        userLocationMarker.bindPopup("Votre position");

      }

      map.flyTo(latlng, Math.max(map.getZoom(), 15), { duration: 0.6 });
      userLocationMarker.openPopup();

    },

    () => {
      toast("Localisation refusée ou indisponible.", "error");
    },

    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }

  );

}

function toggleMapFullscreen() {

  const el = document.getElementById("map");
  if (!el) { return; }

  if (!document.fullscreenElement) {
    if (el.requestFullscreen) { el.requestFullscreen(); }
  }
  else {
    if (document.exitFullscreen) { document.exitFullscreen(); }
  }

}

document.addEventListener("fullscreenchange", () => {
  setTimeout(() => { if (map) { map.invalidateSize(); } }, 150);
});


const MapOptionsControl =
  (typeof L !== "undefined" && L.Control)
    ? L.Control.extend({

        options: { position: "topright" },

        onAdd: function () {

          const container = L.DomUtil.create("div", "leaflet-bar map-options-control");

          L.DomEvent.disableClickPropagation(container);
          L.DomEvent.disableScrollPropagation(container);

          const btnLayers = L.DomUtil.create("a", "map-opt-btn", container);
          btnLayers.href = "#";
          btnLayers.title = "Changer de fond de carte";
          btnLayers.innerHTML = "<i class=\"fa-solid fa-layer-group\"></i>";

          const btnLocate = L.DomUtil.create("a", "map-opt-btn", container);
          btnLocate.href = "#";
          btnLocate.title = "Ma position";
          btnLocate.innerHTML = "<i class=\"fa-solid fa-location-crosshairs\"></i>";

          const btnFullscreen = L.DomUtil.create("a", "map-opt-btn", container);
          btnFullscreen.href = "#";
          btnFullscreen.title = "Plein écran";
          btnFullscreen.innerHTML = "<i class=\"fa-solid fa-expand\"></i>";

          L.DomEvent.on(btnLayers, "click", e => { L.DomEvent.preventDefault(e); toggleBaseLayer(); });
          L.DomEvent.on(btnLocate, "click", e => { L.DomEvent.preventDefault(e); locateUserOnMap(); });
          L.DomEvent.on(btnFullscreen, "click", e => { L.DomEvent.preventDefault(e); toggleMapFullscreen(); });

          return container;

        }

      })
    : null;

(function injectMapOptionsStyle() {

  const style = document.createElement("style");

  style.textContent =
    ".map-options-control{display:flex;flex-direction:column;overflow:hidden;}" +
    ".map-opt-btn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;" +
    "background:#ffffff;color:#241f12;font-size:16px;text-decoration:none;" +
    "border-bottom:1px solid #e6dcb8;cursor:pointer;}" +
    ".map-opt-btn:last-child{border-bottom:none;}" +
    ".map-opt-btn:hover{background:#f7f3e8;}";

  document.head.appendChild(style);

})();

/* ---------------------------------------------------------
   Taille des marqueurs de la carte (agrandis) et style du
   "chapeau" (graduation-cap) : rouge pour une école non
   fonctionnelle, noir sinon. Injecté en JS pour ne dépendre
   d'aucune règle CSS externe.
--------------------------------------------------------- */

(function injectSchoolMarkerStyle() {

  const style = document.createElement("style");

  style.textContent =
    ".school-pin-wrap{position:relative;display:block;}" +
    ".school-pin-base{position:absolute;top:0;left:0;line-height:1;}" +
    ".school-pin-icon{position:absolute;left:50%;transform:translateX(-50%);}" +

    /* ---- Popup "fiche école" : type devant le nom, statut,
       effectif, mise en page plus soignée. ---- */
    ".school-popup{min-width:222px;font-family:'Inter',sans-serif;}" +
    ".school-popup-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px;}" +
    ".school-popup-name{font-size:14.5px;font-weight:700;color:#241f12;line-height:1.3;}" +
    ".school-popup-loc{display:flex;align-items:center;gap:6px;font-size:12px;color:#5c5335;margin-bottom:9px;}" +
    ".school-popup-loc i{color:#b8912e;font-size:11px;}" +
    ".school-popup-meta{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11.5px;" +
      "color:#5c5335;margin-bottom:11px;padding-bottom:11px;border-bottom:1px dashed #e6dcb8;}" +
    ".school-popup-stat{display:inline-flex;align-items:center;gap:6px;font-weight:700;}" +
    ".school-popup-stat i{font-size:7px;}" +
    ".school-popup-stat.ok{color:#00853f;}" +
    ".school-popup-stat.bad{color:#ce1126;}" +
    ".school-popup-eff{display:inline-flex;align-items:center;gap:6px;}" +
    ".school-popup-eff i{color:#9a8c5c;font-size:11px;}" +
    ".popup-detail-btn{display:flex;align-items:center;justify-content:center;gap:7px;" +
      "border-radius:8px !important;transition:transform .15s ease, box-shadow .15s ease;}" +
    ".popup-detail-btn:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(212,175,55,.35);}" +
    ".leaflet-popup-content{margin:14px 16px !important;}" +
    ".leaflet-popup-content-wrapper{border-radius:12px !important;" +
      "box-shadow:0 14px 34px rgba(15,23,32,.18) !important;}";

  document.head.appendChild(style);

})();

function addMapOptionsControl() {

  if (map && MapOptionsControl) {
    map.addControl(new MapOptionsControl());
  }

}


function toRoman(num) {

  const table = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];

  let n = num;
  let result = "";

  table.forEach(([value, symbol]) => {
    while (n >= value) {
      result += symbol;
      n -= value;
    }
  });

  return result || String(num);

}

/* Les données brutes contiennent "commune1", "commune2"... ;
   on les affiche au format officiel de Bamako : "Commune I", "Commune II"... */
function formatCommuneLabel(value) {

  const str = String(value ?? "").trim();

  const match = str.match(/^commune\s*([0-9]+)$/i);

  if (match) {
    return "Commune " + toRoman(Number(match[1]));
  }

  return str;

}

function badgeClass(type) {
  const value = normalizeText(type);
  if (value === "public") return "public";
  if (value === "prive" || value === "privé") return "prive";
  return "comm";
}

function markerColor(type) {

  const value = normalizeText(type);

  if (value.includes("public")) { return "#00853f"; }
  if (value.includes("prive")) { return "#fcd116"; }

  return "#ce1126";

}

function createSchoolMarker(school) {

  if (
    !Number.isFinite(Number(school.latitude)) ||
    !Number.isFinite(Number(school.longitude))
  ) {
    return null;
  }

  const color = markerColor(school.type_ecole);

  /* Chapeau rouge pour une école non fonctionnelle, noir sinon
     (au lieu d'un chapeau toujours noir quel que soit le statut). */
  const capColor = isNonFunctional(school) ? "#ce1126" : "#241f12";

  /* Marqueurs légèrement agrandis, chapeau AU-DESSUS du marqueur.
     Gabarit resserré (moins de hauteur au-dessus du point GPS)
     pour limiter les cas où le chapeau se retrouve rogné en
     haut de la carte, juste sous le bandeau KPI. */
  const PIN_SIZE = 33;
  const CAP_SIZE = 15;
  const GAP = 2;
  const PIN_HEIGHT = Math.round(PIN_SIZE * 1.28);
  const ICON_W = 33;
  const ICON_H = CAP_SIZE + GAP + PIN_HEIGHT;
  const PIN_TOP = CAP_SIZE + GAP;

  const icon = L.divIcon({
    className: "school-marker-pin",
    html:
      '<div class="school-pin-wrap" style="width:' + ICON_W + 'px;height:' + ICON_H + 'px;">' +
        '<i class="fa-solid fa-graduation-cap school-pin-icon" style="color:' + capColor + ';font-size:' + CAP_SIZE + 'px;top:0;"></i>' +
        '<i class="fa-solid fa-location-dot school-pin-base" style="color:' + color + ';font-size:' + PIN_SIZE + 'px;top:' + PIN_TOP + 'px;left:0;"></i>' +
      '</div>',
    iconSize: [ICON_W, ICON_H],
    iconAnchor: [ICON_W / 2, ICON_H - 4],
    popupAnchor: [0, -(ICON_H - 8)]
  });

  const marker = L.marker(
    [Number(school.latitude), Number(school.longitude)],
    { icon }
  );

  const statusOk = isFunctional(school);
  const statusLabel = escapeHtml(school.statut_fonctionnement) || (statusOk ? "Fonctionnelle" : "Non fonctionnelle");

  /* Le type précède toujours le nom, et l'ensemble est repensé
     avec une hiérarchie plus claire : type + nom en tête, statut
     de fonctionnement et effectif juste en dessous, séparateur
     discret, puis le bouton d'action. */
  marker.bindPopup(`
    <div class="school-popup">
      <div class="school-popup-head">
        <span class="badge ${badgeClass(school.type_ecole)}">${escapeHtml(school.type_ecole)}</span>
        <strong class="school-popup-name">${escapeHtml(school.nom_ecole)}</strong>
      </div>
      <div class="school-popup-loc">
        <i class="fa-solid fa-location-dot"></i>
        ${escapeHtml(formatCommuneLabel(school.commune))} · ${escapeHtml(school.quartier)}
      </div>
      <div class="school-popup-meta">
        <span class="school-popup-stat ${statusOk ? "ok" : "bad"}">
          <i class="fa-solid fa-circle"></i> ${statusLabel}
        </span>
        <span class="school-popup-eff">
          <i class="fa-solid fa-user-group"></i> ${formatNumber(school.effectif_total)} élèves
        </span>
      </div>
      <button type="button" class="btn primary full popup-detail-btn" data-school-id="${escapeHtml(school.id_ecole)}">
        Voir le détail <i class="fa-solid fa-arrow-right"></i>
      </button>
    </div>
  `);

  marker.on("popupopen", () => {
    const popup = document.querySelector(".popup-detail-btn");
    if (popup) {
      popup.addEventListener("click", () => { openSchoolDetail(school); });
    }
  });

  return marker;

}

function updateMap() {

  if (!map) { return; }
  if (!markerLayer) { return; }

  markerLayer.clearLayers();
  markersById = {};

  STATE.filtered.forEach(school => {

    const marker = createSchoolMarker(school);
    if (!marker) { return; }

    markerLayer.addLayer(marker);
    markersById[String(school.id_ecole)] = marker;

  });

  const validSchools = STATE.filtered.filter(
    school =>
      Number.isFinite(Number(school.latitude)) &&
      Number.isFinite(Number(school.longitude))
  );

  const empty = document.getElementById("mapEmptyState");
  if (empty) {
    empty.style.display = validSchools.length ? "none" : "block";
  }

}

function locateSchoolOnMap(school) {

  if (!map) return;

  if (
    !Number.isFinite(Number(school.latitude)) ||
    !Number.isFinite(Number(school.longitude))
  ) {
    toast("Cette école ne possède pas de coordonnées GPS.", "error");
    return;
  }

  map.setView([Number(school.latitude), Number(school.longitude)], 16);

  const marker = markersById[String(school.id_ecole)];
  if (marker) { marker.openPopup(); }

}


/* =========================================================
   DETAIL ECOLE
========================================================= */

function buildSchoolDetailGrid(school) {

  return `
    <div class="detail-grid">
      <div class="detail-item"><strong>ID</strong><span>${escapeHtml(school.id_ecole)}</span></div>
      <div class="detail-item"><strong>Type</strong><span><span class="badge ${badgeClass(school.type_ecole)}">${escapeHtml(school.type_ecole)}</span></span></div>
      <div class="detail-item"><strong>Niveau</strong><span>${escapeHtml(school.niveau)}</span></div>
      <div class="detail-item"><strong>Statut</strong><span class="${isFunctional(school) ? "stat-ok" : "stat-bad"}">${escapeHtml(school.statut_fonctionnement)}</span></div>
      <div class="detail-item"><strong>Commune</strong><span>${escapeHtml(formatCommuneLabel(school.commune))}</span></div>
      <div class="detail-item"><strong>Quartier</strong><span>${escapeHtml(school.quartier)}</span></div>
      <div class="detail-item wide"><strong>Adresse</strong><span>${escapeHtml(school.adresse)}</span></div>
      <div class="detail-item"><strong>Élèves</strong><span>${formatNumber(school.effectif_total)}</span></div>
      <div class="detail-item"><strong>Classes</strong><span>${formatNumber(school.nombre_classes)}</span></div>
      <div class="detail-item"><strong>Année de création</strong><span>${escapeHtml(school.annee_creation)}</span></div>
      <div class="detail-item wide"><strong>Coordonnées GPS</strong><span>${escapeHtml(school.latitude)}, ${escapeHtml(school.longitude)}</span></div>
    </div>
  `;

}

/* Le détail école s'ouvre maintenant dans la page plein écran
   dédiée (#schoolPage), déjà présente dans le HTML avec son
   bouton retour et son bouton itinéraire — elle n'était juste
   jamais alimentée ni affichée jusqu'ici. */
function openSchoolDetail(school) {

  STATE.selectedSchool = school;

  const typeLabel = school.type_ecole ? String(school.type_ecole).toUpperCase() : "";
  const locationLabel = formatCommuneLabel(school.commune) + " · " + (school.quartier || "—");

  setText("schoolPageType", typeLabel ? (typeLabel + " · " + locationLabel) : locationLabel);
  setText("schoolPageName", school.nom_ecole);

  const body = document.getElementById("schoolPageBody");

  if (body) {
    body.innerHTML = buildSchoolDetailGrid(school);
  }

  hidePanel("panel-detail");

  const page = document.getElementById("schoolPage");
  if (page) { page.classList.add("show"); }

}


/* =========================================================
   AFFICHAGE DES PANNEAUX
========================================================= */

function showPanel(id) {
  const panel = document.getElementById(id);
  if (!panel) return;
  panel.classList.add("active");
}

function hidePanel(id) {
  const panel = document.getElementById(id);
  if (!panel) return;
  panel.classList.remove("active");
}


/* =========================================================
   PLEIN ECRAN TABLEAU / STATS
   (ajout : bascule des classes sur <body>, qui pilotent déjà
   le CSS existant body.table-mode / body.stats-mode ; et
   fonction unique pour tout nettoyer proprement à la sortie,
   utilisée par la croix de fermeture du tiroir.)
========================================================= */

function exitFullscreenDrawer() {

  document.body.classList.remove("table-mode", "stats-mode");

  const drawer = document.getElementById("drawer");
  if (drawer) { drawer.classList.remove("open"); }

  if (map) {
    setTimeout(() => { map.invalidateSize(); }, 120);
  }

}


/* =========================================================
   NAVIGATION PRINCIPALE
========================================================= */

function showModule(module) {

  console.log("Ouverture du module :", module);

  STATE.currentModule = module;

  hidePanel("panel-detail");
  hidePanel("panel-route");

  if (module === "accueil") {
    exitFullscreenDrawer();
    showHomeScreen();
    return;
  }

  hideHomeScreen();

  if (module === "carte") {
    exitFullscreenDrawer();
    showCarteModule();
    return;
  }

  if (module === "stats") {
    showStatsModule();
    return;
  }

  if (module === "tableau") {
    showTableModule();
    return;
  }

}


/* =========================================================
   ACCUEIL
========================================================= */

function showHomeScreen() {

  const home = document.getElementById("homeScreen");
  if (home) { home.style.display = "flex"; }

  document.body.classList.remove("portal-active");

}

function hideHomeScreen() {

  const home = document.getElementById("homeScreen");
  if (home) { home.style.display = "none"; }

  document.body.classList.add("portal-active");

}


/* =========================================================
   MODULE CARTE
========================================================= */

function showCarteModule() {

  hideHomeScreen();

  const drawer = document.getElementById("drawer");
  if (drawer) { drawer.classList.remove("open"); }

  const table = document.getElementById("drawerBodyTable");
  const stats = document.getElementById("drawerBodyStats");

  if (table) { table.style.display = "block"; }
  if (stats) { stats.style.display = "none"; }

  const title = document.getElementById("drawerTitle");
  if (title) { title.textContent = "Tableau des établissements"; }

  if (map) {
    setTimeout(() => { map.invalidateSize(); }, 100);
  }

}


/* =========================================================
   MODULE TABLEAU (plein écran)
========================================================= */

function showTableModule() {

  hideHomeScreen();

  document.body.classList.remove("stats-mode");
  document.body.classList.add("table-mode");

  const drawer = document.getElementById("drawer");
  const table = document.getElementById("drawerBodyTable");
  const stats = document.getElementById("drawerBodyStats");

  if (drawer) { drawer.classList.add("open"); }
  if (table) { table.style.display = "block"; }
  if (stats) { stats.style.display = "none"; }

  const title = document.getElementById("drawerTitle");
  if (title) { title.textContent = "Tableau des établissements"; }

  renderTable();

}


/* =========================================================
   MODULE STATISTIQUES (plein écran)
========================================================= */

function showStatsModule() {

  hideHomeScreen();

  document.body.classList.remove("table-mode");
  document.body.classList.add("stats-mode");

  const drawer = document.getElementById("drawer");
  const table = document.getElementById("drawerBodyTable");
  const stats = document.getElementById("drawerBodyStats");

  if (drawer) { drawer.classList.add("open"); }
  if (table) { table.style.display = "none"; }
  if (stats) { stats.style.display = "block"; }

  const title = document.getElementById("drawerTitle");
  if (title) { title.textContent = "Analyse statistique"; }

  renderStats();

}


/* =========================================================
   NAVIGATION DES BOUTONS DATA-NAV
========================================================= */

function initNavigation() {

  const buttons = document.querySelectorAll("[data-nav]");

  buttons.forEach(button => {

    button.addEventListener("click", function () {

      const module = this.dataset.nav;
      showModule(module);

      document.querySelectorAll("[data-nav]").forEach(b => b.classList.remove("active"));
      document.querySelectorAll('[data-nav="' + module + '"]').forEach(b => b.classList.add("active"));

      const mobile = document.getElementById("homeMobileMenu");
      if (mobile) { mobile.classList.remove("open"); }

    });

  });

}


/* =========================================================
   BOUTONS ACCUEIL
========================================================= */

function initHomeButtons() {

  const enterPortal = document.getElementById("btnEnterPortal");
  if (enterPortal) {
    enterPortal.addEventListener("click", () => { showModule("carte"); });
  }

  const enterStats = document.getElementById("btnEnterStats");
  if (enterStats) {
    enterStats.addEventListener("click", () => { showModule("stats"); });
  }

  const backHome = document.getElementById("btnBackHome");
  if (backHome) {
    backHome.addEventListener("click", () => { showModule("accueil"); });
  }

}


/* =========================================================
   TABLEAU
========================================================= */

function renderTable() {

  const tbody = document.getElementById("tableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!STATE.filtered.length) {
    tbody.innerHTML = `
      <tr><td colspan="10" style="text-align:center;padding:25px;">Aucune école trouvée.</td></tr>
    `;
    return;
  }

  STATE.filtered.forEach(school => {

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${escapeHtml(school.id_ecole)}</td>
      <td>${escapeHtml(school.type_ecole)}</td>
      <td><strong>${escapeHtml(school.nom_ecole)}</strong></td>
      <td>${escapeHtml(school.niveau)}</td>
      <td>${escapeHtml(formatCommuneLabel(school.commune))}</td>
      <td>${escapeHtml(school.quartier)}</td>
      <td>${formatNumber(school.effectif_total)}</td>
      <td>${formatNumber(school.nombre_classes)}</td>
      <td>${escapeHtml(school.statut_fonctionnement)}</td>
      <td>${escapeHtml(school.annee_creation)}</td>
    `;

    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => { openSchoolDetail(school); });

    tbody.appendChild(tr);

  });

}


/* =========================================================
   STATISTIQUES
========================================================= */

function calculateStats() {

  const rows = STATE.filtered;
  const schools = rows.length;

  const students = rows.reduce((sum, school) => sum + numberValue(school.effectif_total), 0);
  const classes = rows.reduce((sum, school) => sum + numberValue(school.nombre_classes), 0);

  const functional = rows.filter(isFunctional).length;

  return {
    schools, students, classes, functional,
    functionalRate: schools ? Math.round(functional * 100 / schools) : 0,
    avgSchool: schools ? Math.round(students / schools) : 0,
    avgClass: classes ? Math.round(students / classes) : 0
  };

}

function renderStats() {

  const stats = calculateStats();

  setText("statSchools", formatNumber(stats.schools));
  setText("statStudents", formatNumber(stats.students));
  setText("statClasses", formatNumber(stats.classes));
  setText("statFunctional", stats.functionalRate + "%");
  setText("statAvgSchool", formatNumber(stats.avgSchool));
  setText("statAvgClass", formatNumber(stats.avgClass));

  drawAllCharts();
  renderRanking();
  renderInsights();

}


/* =========================================================
   GRAPHIQUES CHART.JS
========================================================= */

function destroyChart(name) {
  if (STATE.charts[name]) {
    STATE.charts[name].destroy();
    STATE.charts[name] = null;
  }
}

function getVar(name) {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  catch (e) {
    return "";
  }
}

function niveauColor(niveau) {
  const value = normalizeText(niveau);
  if (value.includes("fondamental")) return "#3d7ea6";
  if (value.includes("secondaire")) return "#b8912e";
  if (value.includes("technique")) return "#7b6aa8";
  return "#8b8b8b";
}

function drawChart(id, type, labels, data, colors) {

  const canvas = document.getElementById(id);
  if (!canvas) return;

  if (typeof Chart === "undefined") {
    console.warn("Chart.js non chargé.");
    return;
  }

  destroyChart(id);

  const isBar = type === "bar";

  const backgroundColor =
    colors || getVar("--amber") || "#d4af37";

  const axisColor = getVar("--muted") || "#9a8c5c";
  const legendColor = getVar("--ink-soft") || "#5c5335";
  const surfaceColor = getVar("--surface") || "#ffffff";

  STATE.charts[id] = new Chart(canvas, {

    type,

    data: {
      labels,
      datasets: [{
        data,
        backgroundColor,
        borderWidth: isBar ? 0 : 1,
        borderColor: surfaceColor,
        borderRadius: isBar ? 6 : 0,
        maxBarThickness: 34,
        hoverOffset: isBar ? 0 : 6
      }]
    },

    options: {

      responsive: true,
      maintainAspectRatio: false,

      animation: { duration: 400 },

      plugins: {

        legend: {
          display: type === "doughnut",
          position: "bottom",
          labels: { boxWidth: 10, padding: 12, font: { size: 10 }, color: legendColor }
        },

        tooltip: { displayColors: false }

      },

      /* Grille retirée : uniquement les axes/étiquettes, plus de
         lignes de fond derrière les barres. */
      scales: isBar
        ? {
            x: {
              grid: { display: false, drawTicks: false },
              border: { display: false },
              ticks: { font: { size: 9 }, color: axisColor }
            },
            y: {
              beginAtZero: true,
              grid: { display: false, drawTicks: false },
              border: { display: false },
              ticks: { font: { size: 9 }, color: axisColor }
            }
          }
        : {}

    }

  });

}

function groupCount(field) {

  const mapData = {};

  STATE.filtered.forEach(school => {
    const key = school[field] || "Non renseigné";
    mapData[key] = (mapData[key] || 0) + 1;
  });

  return mapData;

}

function groupSum(field, valueField) {

  const mapData = {};

  STATE.filtered.forEach(school => {
    const key = school[field] || "Non renseigné";
    mapData[key] = (mapData[key] || 0) + numberValue(school[valueField]);
  });

  return mapData;

}

function drawAllCharts() {

  const communes = groupCount("commune");
  drawChart(
    "chartCommune", "bar", Object.keys(communes).map(formatCommuneLabel), Object.values(communes),
    getVar("--teal-dim") || "#b8912e"
  );

  const types = groupCount("type_ecole");
  drawChart(
    "chartType", "doughnut", Object.keys(types), Object.values(types),
    Object.keys(types).map(markerColor)
  );

  const studentsCommune = groupSum("commune", "effectif_total");
  drawChart(
    "chartStudentsCommune", "bar", Object.keys(studentsCommune).map(formatCommuneLabel), Object.values(studentsCommune),
    getVar("--amber") || "#d4af37"
  );

  const classesCommune = groupSum("commune", "nombre_classes");
  drawChart(
    "chartClassesCommune", "bar", Object.keys(classesCommune).map(formatCommuneLabel), Object.values(classesCommune),
    getVar("--red-dim") || "#8a6a1a"
  );

  const niveaux = groupCount("niveau");
  drawChart(
    "chartNiveau", "doughnut", Object.keys(niveaux), Object.values(niveaux),
    Object.keys(niveaux).map(niveauColor)
  );

  const niveauStudents = groupSum("niveau", "effectif_total");
  drawChart(
    "chartNiveauEff", "bar", Object.keys(niveauStudents), Object.values(niveauStudents),
    Object.keys(niveauStudents).map(niveauColor)
  );

}


/* =========================================================
   CLASSEMENT COMMUNES
========================================================= */

function renderRanking() {

  const container = document.getElementById("rankCommunes");
  if (!container) return;

  const counts = groupCount("commune");

  const ranking = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  container.innerHTML = "";

  if (!ranking.length) {
    container.innerHTML = "<p>Aucune donnée.</p>";
    return;
  }

  const maxCount = ranking[0][1] || 1;

  ranking.forEach(([commune, count]) => {

    const isActive = STATE.filters.commune.includes(commune);
    const percent = Math.max(6, Math.round((count / maxCount) * 100));

    const item = document.createElement("div");
    item.className = "rank-row rank-interactive" + (isActive ? " active" : "");
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.title = "Cliquer pour filtrer sur " + formatCommuneLabel(commune);

    item.innerHTML = `
      <span class="rank-name">${escapeHtml(formatCommuneLabel(commune))}</span>
      <span class="rank-bar"><span class="rank-bar-fill" style="width:${percent}%"></span></span>
      <span class="rank-val">${formatNumber(count)}</span>
    `;

    const toggle = () => {

      const idx = STATE.filters.commune.indexOf(commune);

      if (idx >= 0) { STATE.filters.commune.splice(idx, 1); }
      else { STATE.filters.commune.push(commune); }

      refreshFilterOptions();
      applyFilters();

    };

    item.addEventListener("click", toggle);

    item.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });

    container.appendChild(item);

  });

}


/* =========================================================
   ANALYSE AUTOMATIQUE
========================================================= */

function renderInsights() {

  const container = document.getElementById("insightsList");
  if (!container) return;

  const rows = STATE.filtered;

  if (!rows.length) {
    container.innerHTML = "<p>Aucune donnée à analyser.</p>";
    return;
  }

  const stats = calculateStats();
  const communes = groupCount("commune");
  const topCommune = Object.entries(communes).sort((a, b) => b[1] - a[1])[0];

  const types = groupCount("type_ecole");
  const topType = Object.entries(types).sort((a, b) => b[1] - a[1])[0];

  const messages = [];

  if (topCommune) {
    messages.push("La commune la plus représentée est " + formatCommuneLabel(topCommune[0]) + " avec " + formatNumber(topCommune[1]) + " établissement(s).");
  }

  if (topType) {
    messages.push("Le type d'établissement le plus représenté est " + topType[0] + " avec " + formatNumber(topType[1]) + " école(s).");
  }

  messages.push("Le réseau filtré compte " + formatNumber(stats.students) + " élèves répartis dans " + formatNumber(stats.classes) + " classes.");
  messages.push("Le taux d'établissements fonctionnels est de " + stats.functionalRate + "%.");

  container.innerHTML = messages.map(message => `
    <div class="insight-item">${escapeHtml(message)}</div>
  `).join("");

}


/* =========================================================
   ITINERAIRE
========================================================= */

let routeLayer = null;

function startRoute(school) {

  STATE.selectedSchool = school;

  setText("routeSchoolName", school.nom_ecole);

  const body = document.getElementById("routeBody");

  if (body) {

    body.innerHTML = `
      <p><strong>École :</strong> ${escapeHtml(school.nom_ecole)}</p>
      <p><strong>Coordonnées :</strong> ${escapeHtml(school.latitude)} / ${escapeHtml(school.longitude)}</p>
      <button type="button" class="btn primary" id="btnUseMyLocation">📍 Utiliser ma position</button>
    `;

    const locationBtn = document.getElementById("btnUseMyLocation");

    if (locationBtn) {

      locationBtn.onclick = () => {

        if (!navigator.geolocation) {
          toast("La géolocalisation n'est pas disponible.", "error");
          return;
        }

        navigator.geolocation.getCurrentPosition(

          position => {
            drawRouteLine(
              position.coords.latitude,
              position.coords.longitude,
              school.latitude,
              school.longitude
            );
          },

          () => { toast("Impossible d'obtenir votre position.", "error"); }

        );

      };

    }

  }

  showPanel("panel-route");

  if (
    map &&
    Number.isFinite(Number(school.latitude)) &&
    Number.isFinite(Number(school.longitude))
  ) {
    map.setView([Number(school.latitude), Number(school.longitude)], 15);
  }

}

function drawRouteLine(lat1, lon1, lat2, lon2) {

  if (!map) return;

  if (routeLayer) { map.removeLayer(routeLayer); }

  routeLayer = L.polyline(
    [[lat1, lon1], [Number(lat2), Number(lon2)]],
    { weight: 4 }
  ).addTo(map);

  map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });

  toast("Itinéraire indicatif affiché.", "success");

}


/* =========================================================
   FERMETURE DES PANNEAUX
========================================================= */

function initPanelClosers() {

  const detailClose = document.getElementById("detailClose");
  if (detailClose) {
    detailClose.addEventListener("click", () => { hidePanel("panel-detail"); });
  }

  const routeClose = document.getElementById("routeClose");
  if (routeClose) {
    routeClose.addEventListener("click", () => { hidePanel("panel-route"); });
  }

  const filtersClose = document.getElementById("filtersClose");
  if (filtersClose) {
    filtersClose.addEventListener("click", () => { hidePanel("panel-filters"); });
  }

  const openFilters = document.getElementById("btnOpenFilters");
  if (openFilters) {
    openFilters.addEventListener("click", () => { showPanel("panel-filters"); });
  }

  const drawerToggle = document.getElementById("drawer-toggle");
  if (drawerToggle) {
    drawerToggle.addEventListener("click", () => {
      const drawer = document.getElementById("drawer");
      if (drawer) { drawer.classList.toggle("open"); }
    });
  }

  /* La croix de fermeture du tiroir doit défaire TOUT ce que
     showTableModule()/showStatsModule() ont mis en place
     (classes table-mode/stats-mode sur <body> comprises),
     sinon le plein écran reste bloqué même une fois le
     tiroir "fermé". */
  const drawerClose = document.getElementById("drawerClose");
  if (drawerClose) {
    drawerClose.addEventListener("click", () => {
      showModule("carte");
    });
  }

}


/* =========================================================
   FILTRES
========================================================= */

function initFilters() {

  const search = document.getElementById("searchInput");
  if (search) {
    search.addEventListener("input", () => { readFilters(); applyFilters(); });
  }

  const reset = document.getElementById("btnResetFilters");
  if (reset) {
    reset.addEventListener("click", resetFilters);
  }

}


/* =========================================================
   EXPORT CSV
========================================================= */

function csvEscape(value) {
  return '"' + String(value ?? "").replace(/"/g, '""') + '"';
}

function exportSchoolsCSV() {

  const rows = STATE.filtered;

  if (!rows.length) {
    toast("Aucune donnée à exporter.", "error");
    return;
  }

  const headers = [
    "id_ecole", "nom_ecole", "type_ecole", "niveau", "commune", "quartier",
    "adresse", "latitude", "longitude", "effectif_total", "nombre_classes",
    "statut_fonctionnement", "annee_creation", "source_donnee", "date_collecte"
  ];

  const lines = [
    headers.map(csvEscape).join(";"),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(";"))
  ];

  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "ecoles_bamako_filtrees.csv";

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);

  toast("Export CSV terminé.", "success");

}

function initExport() {
  const button = document.getElementById("btnExport");
  if (button) { button.addEventListener("click", exportSchoolsCSV); }
}


/* =========================================================
   MODAL POSTGRESQL (gestion des données)
========================================================= */

function openDatabaseModal() {

  const overlay = document.getElementById("overlay");
  if (overlay) { overlay.classList.add("active"); }

  handleDatabaseTest();

}

function closeDatabaseModal() {
  const overlay = document.getElementById("overlay");
  if (overlay) { overlay.classList.remove("active"); }
}


/* =========================================================
   AUTHENTIFICATION ADMIN
   (le mot de passe et la bascule Vue publique / Vue admin
   n'étaient reliés à rien : on les câble ici)
========================================================= */

const ADMIN_PASSWORD = "admin123";
/* À changer, ou mieux : à vérifier côté serveur via une
   vraie route d'API plutôt qu'en clair dans le JS du client. */

function setAdminMode(isAdmin) {

  document.body.classList.toggle("admin-mode", isAdmin);

  document.querySelectorAll('[data-role="public"]').forEach(
    btn => btn.classList.toggle("active", !isAdmin)
  );

  document.querySelectorAll('[data-role="admin"]').forEach(
    btn => btn.classList.toggle("active", isAdmin)
  );

  const indicatorText = document.getElementById("homeModeIndicatorText");
  if (indicatorText) { indicatorText.textContent = isAdmin ? "Mode admin" : "Mode public"; }

  const indicator = document.getElementById("homeModeIndicator");
  if (indicator) { indicator.classList.toggle("is-admin", isAdmin); }

}

function openAdminAuthModal() {
  const overlay = document.getElementById("adminAuthOverlay");
  if (overlay) { overlay.classList.add("active"); }

  const msg = document.getElementById("adminAuthMsg");
  if (msg) { msg.textContent = ""; msg.className = "msg"; }

  const input = document.getElementById("adminPasswordInput");
  if (input) { input.value = ""; input.focus(); }
}

function closeAdminAuthModal() {
  const overlay = document.getElementById("adminAuthOverlay");
  if (overlay) { overlay.classList.remove("active"); }
}

function submitAdminAuth() {

  const input = document.getElementById("adminPasswordInput");
  const msg = document.getElementById("adminAuthMsg");
  const value = input ? input.value : "";

  if (value === ADMIN_PASSWORD) {

    setAdminMode(true);
    closeAdminAuthModal();
    toast("Mode administrateur activé.", "success");

  }
  else {

    if (msg) {
      msg.textContent = "Mot de passe incorrect.";
      msg.className = "msg err";
    }

    toast("Mot de passe incorrect.", "error");

  }

}

function initAdminAuth() {

  const overlay = document.getElementById("adminAuthOverlay");

  const close = document.getElementById("adminAuthClose");
  if (close) { close.addEventListener("click", closeAdminAuthModal); }

  const cancel = document.getElementById("btnAdminAuthCancel");
  if (cancel) { cancel.addEventListener("click", closeAdminAuthModal); }

  const submit = document.getElementById("btnAdminAuthSubmit");
  if (submit) { submit.addEventListener("click", submitAdminAuth); }

  const input = document.getElementById("adminPasswordInput");
  if (input) {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { submitAdminAuth(); }
    });
  }

  /* Fermer en cliquant sur le fond sombre */
  if (overlay) {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) { closeAdminAuthModal(); }
    });
  }

  const modeSwitch = document.getElementById("topbarModeSwitch");
  if (modeSwitch) {

    modeSwitch.querySelectorAll("button").forEach(button => {

      button.addEventListener("click", () => {

        const role = button.dataset.role;

        if (role === "admin") {
          if (document.body.classList.contains("admin-mode")) { return; }
          openAdminAuthModal();
        }
        else {
          setAdminMode(false);
        }

      });

    });

  }

}


/* =========================================================
   ADMIN — actions (gestion des données)
   (Connexion depuis l'accueil demande désormais le mot de
   passe avant d'ouvrir la fenêtre de gestion des données.)
========================================================= */

function initAdmin() {

  const connect = document.getElementById("btnConnect");
  const homeAdmin = document.getElementById("homeAdminLink");
  const homeAdminMobile = document.getElementById("homeAdminLinkMobile");
  const close = document.getElementById("modalClose");
  const test = document.getElementById("btnTestPostgres");
  const refresh = document.getElementById("btnRefreshPostgres");
  const download = document.getElementById("btnDownloadPostgres");

  const requireAdminThen = action => {
    if (document.body.classList.contains("admin-mode")) {
      action();
    }
    else {
      openAdminAuthModal();
    }
  };

  if (connect) {
    connect.addEventListener("click", () => requireAdminThen(openDatabaseModal));
  }

  if (homeAdmin) {
    homeAdmin.addEventListener("click", () => requireAdminThen(openDatabaseModal));
  }

  if (homeAdminMobile) {
    homeAdminMobile.addEventListener("click", () => requireAdminThen(openDatabaseModal));
  }

  if (close) { close.addEventListener("click", closeDatabaseModal); }
  if (test) { test.addEventListener("click", handleDatabaseTest); }

  if (refresh) {
    refresh.addEventListener("click", async () => { await fetchSchoolsFromAPI(); });
  }

  if (download) { download.addEventListener("click", exportSchoolsCSV); }

  const overlay = document.getElementById("overlay");
  if (overlay) {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) { closeDatabaseModal(); }
    });
  }

}


/* =========================================================
   MENU MOBILE
========================================================= */

function initMobileMenu() {

  const burger = document.getElementById("homeBurger");
  const menu = document.getElementById("homeMobileMenu");

  if (!burger || !menu) { return; }

  burger.addEventListener("click", () => {
    const opened = menu.classList.toggle("open");
    burger.setAttribute("aria-expanded", opened ? "true" : "false");
  });

}


/* =========================================================
   TABS DU PANNEAU FILTRES
========================================================= */

function initTabs() {

  const tabs = document.querySelectorAll(".tabs .tab");

  tabs.forEach(tab => {

    tab.addEventListener("click", () => {

      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      const module = tab.dataset.tab;

      if (module === "carte") { showModule("carte"); }
      if (module === "tableau") { showModule("tableau"); }
      if (module === "stats") { showModule("stats"); }

    });

  });

}


/* =========================================================
   GEOLOCALISATION (page détail école plein écran)
========================================================= */

function initGeolocation() {

  const button = document.getElementById("btnSchoolPageLocate");

  if (button) {
    button.addEventListener("click", () => {
      if (STATE.selectedSchool) {
        closeSchoolPage();
        showModule("carte");
        locateSchoolOnMap(STATE.selectedSchool);
      }
    });
  }

}


/* =========================================================
   PAGE DETAIL ECOLE
========================================================= */

function closeSchoolPage() {
  const page = document.getElementById("schoolPage");
  if (page) { page.classList.remove("show"); }
}

function initSchoolPage() {

  const back = document.getElementById("btnSchoolPageBack");
  const close = document.getElementById("btnSchoolPageClose2");

  if (back) { back.addEventListener("click", closeSchoolPage); }
  if (close) { close.addEventListener("click", closeSchoolPage); }

  const route = document.getElementById("btnSchoolPageRoute");

  if (route) {
    route.addEventListener("click", () => {
      if (STATE.selectedSchool) {
        closeSchoolPage();
        startRoute(STATE.selectedSchool);
      }
    });
  }

}


/* =========================================================
   ACTUALISATION
========================================================= */

async function refreshSchools() {
  toast("Actualisation des données...", "info");
  await fetchSchoolsFromAPI();
  toast("Données actualisées.", "success");
}


/* =========================================================
   INITIALISATION
========================================================= */

async function initApplication() {

  console.log("=================================");
  console.log("SIG ÉCOLES BAMAKO");
  console.log("Initialisation...");
  console.log("API :", API_BASE_URL);

  initMap();

  initNavigation();
  initHomeButtons();
  initMobileMenu();

  initFilters();
  initPanelClosers();
  initTabs();
  initExport();

  initAdmin();
  initAdminAuth();
  initSchoolPage();
  initGeolocation();

  showHomeScreen();

  typewriter(
    document.getElementById("homeHeadlineText"),
    document.getElementById("homeHeadlineCursor"),
    "Géolocalisez. Analysez.\nPlanifiez l’avenir."
  );

  await fetchSchoolsFromAPI();

  if (map) {
    setTimeout(() => { map.invalidateSize(); updateMap(); }, 300);
  }

  console.log("Initialisation terminée.");
  console.log("Écoles chargées :", STATE.raw.length);

}


/* =========================================================
   DEMARRAGE
========================================================= */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApplication);
}
else {
  initApplication();
}


/* =========================================================
   FONCTIONS DISPONIBLES DEPUIS LE HTML
========================================================= */

window.STATE = STATE;
window.showModule = showModule;
window.resetFilters = resetFilters;
window.refreshSchools = refreshSchools;
window.exportSchoolsCSV = exportSchoolsCSV;
window.testPostgresConnection = testPostgresConnection;
window.openSchoolDetail = openSchoolDetail;
window.startRoute = startRoute;
window.locateSchoolOnMap = locateSchoolOnMap;
window.renderTable = renderTable;
window.renderStats = renderStats;
window.updateMap = updateMap;
window.toggleBaseLayer = toggleBaseLayer;
window.locateUserOnMap = locateUserOnMap;
window.toggleMapFullscreen = toggleMapFullscreen;

/* =========================================================
   FIN DU SCRIPT
========================================================= */
