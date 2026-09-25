"use strict";

/* ===== SUPABASE ===== */

const SUPABASE_URL = "https://pbcnouwpiownvkbcucrm.supabase.co";
const SUPABASE_KEY = "sb_publishable_Uu_LTgMA9Y6CGPk4wR3wEQ_VCTdTU1b";
const SUPABASE_TABLE = "ecoles";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ===== EN-TÊTES CSV ATTENDUS ===== */

const CSV_EXPECTED_HEADERS = [
  "id_ecole", "Nom officiel de l'établissement",
  "Type d'établissement", "Niveau", "Commune",
  "Quartier", "Adresse / repère",
  "Position GPS de l'école", "Effectif total (élèves)",
  "Nombre de salles de classe",
  "Statut de fonctionnement", "Année de création", "Source de la donnée"
];

const CSV_HEADER_MAP = {
  "id_ecole": "id_ecole",
  "Nom officiel de l'établissement": "nom_ecole",
  "Type d'établissement": "type_ecole",
  "Niveau": "niveau",
  "Commune": "commune",
  "Quartier": "quartier",
  "Adresse / repère": "adresse",
  "Position GPS de l'école": "localisation",
  "Effectif total (élèves)": "effectif_total",
  "Nombre de salles de classe": "nombre_classes",
  "Statut de fonctionnement": "statut_fonctionnement",
  "Année de création": "annee_creation",
  "Source de la donnée": "source_donnee"
};

function mapCsvRowToInternalKeys(row) {

  const mapped = {};

  Object.entries(CSV_HEADER_MAP).forEach(([csvHeader, internalKey]) => {
    if (row[csvHeader] !== undefined) { mapped[internalKey] = row[csvHeader]; }
  });

  // Colonnes lat/lon précises (ex: exports KoboToolbox), prioritaires sur
  // le parsing de la chaîne "Position GPS de l'école".
  if (row["_Position GPS de l'école_latitude"]) {
    mapped.latitude = row["_Position GPS de l'école_latitude"];
  }
  if (row["_Position GPS de l'école_longitude"]) {
    mapped.longitude = row["_Position GPS de l'école_longitude"];
  }

  return mapped;

}

/* ===== ETAT GLOBAL ===== */

const STATE = {
  raw: [],
  filtered: [],
  selectedSchool: null,
  filters: {
    search: "", commune: [], quartier: [], type_ecole: [], niveau: [], statut_fonctionnement: []
  },
  charts: {},
  mapInitialized: false,
  fileLoaded: false,
  fileName: null,
  currentModule: "accueil",
  userLocation: null,
  tablePage: 1,
  tablePageSize: 50
};

/* ===== OUTILS ===== */

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
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
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function normalizeStatus(value) {
  return normalizeText(value).replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

function isNonFunctional(school) {
  const status = normalizeStatus(school && school.statut_fonctionnement);
  return status.includes("non") && status.includes("fonctionnel");
}

function isFunctional(school) {
  const status = normalizeStatus(school && school.statut_fonctionnement);
  return status.includes("fonctionnel") && !status.includes("non");
}

function typewriter(el, cursorEl, text, speed = 45) {

  if (!el) return;

  let i = 0;
  el.innerHTML = "";
  if (cursorEl) { cursorEl.style.display = ""; }

  function step() {
    if (i <= text.length) {
      el.innerHTML = escapeHtml(text.slice(0, i)).replace(/\n/g, "<br>");
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

/* ===== NORMALISATION D'UNE ÉCOLE ===== */

function normalizeSchool(row, index) {

  row = row || {};

  let latitude = row.latitude ?? row.lat ?? null;
  let longitude = row.longitude ?? row.lon ?? row.lng ?? null;

  if ((latitude === null || longitude === null || latitude === "" || longitude === "") && row.localisation) {
    const parts = String(row.localisation).trim().split(/\s+/);
    if (parts.length >= 2) {
      const a = Number(parts[0]);
      const b = Number(parts[1]);
      if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) {
        latitude = a;
        longitude = b;
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
    latitude: (latitude === "" ? null : latitude),
    longitude: (longitude === "" ? null : longitude),
    effectif_total: numberValue(row.effectif_total ?? row.effectif ?? 0),
    nombre_classes: numberValue(row.nombre_classes ?? row.classes ?? 0),
    statut_fonctionnement: row.statut_fonctionnement ?? row.statut ?? "",
    annee_creation: row.annee_creation ?? "",
    source_donnee: row.source_donnee ?? "",
    date_collecte: row.date_collecte ?? ""
  };

}

/* =========================================================
   STOCKAGE PARTAGÉ — SUPABASE
   Table "ecoles" : mêmes colonnes que normalizeSchool() ci-dessus.
   saveSchoolsToStorage() remplace tout le contenu de la table par
   STATE.raw (import = remplacement complet du jeu de données).
========================================================= */

async function saveSchoolsToStorage() {
  try {

    const { error: delError } = await supabaseClient
      .from(SUPABASE_TABLE)
      .delete()
      .neq("id_ecole", "__jamais__");

    if (delError) throw delError;

    if (STATE.raw.length) {
      const { error: insError } = await supabaseClient
        .from(SUPABASE_TABLE)
        .insert(STATE.raw);
      if (insError) throw insError;
    }

  } catch (e) {
    console.warn("Erreur Supabase (sauvegarde) :", e);
    toast("Erreur : les données n'ont pas pu être enregistrées en ligne.", "error");
  }
}

async function loadSchoolsFromStorage() {
  try {

    const { data, error } = await supabaseClient
      .from(SUPABASE_TABLE)
      .select("*");

    if (error) throw error;
    if (!Array.isArray(data) || !data.length) return false;

    STATE.raw = data.map((row, i) => normalizeSchool(row, i));
    STATE.filtered = STATE.raw.slice();
    STATE.fileLoaded = true;
    STATE.fileName = "Supabase (" + SUPABASE_TABLE + ")";

    return true;

  } catch (e) {
    console.warn("Erreur Supabase (chargement) :", e);
    return false;
  }
}

/* =========================================================
   IMPORT CSV — parseur maison : délimiteur , ou ; auto-détecté,
   champs cités avec guillemets échappés, BOM UTF-8.
========================================================= */

function stripBOM(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function detectCsvDelimiter(text) {
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] || "";
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semicolons >= commas ? ";" : ",";
}

function parseCSV(text) {

  const clean = stripBOM(String(text ?? ""));
  const delimiter = detectCsvDelimiter(clean);

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {

    const char = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
    }
    else {
      if (char === '"') { inQuotes = true; }
      else if (char === delimiter) { row.push(field); field = ""; }
      else if (char === "\r") { /* ignoré */ }
      else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else { field += char; }
    }

  }

  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  const nonEmptyRows = rows.filter(r => r.some(cell => String(cell).trim() !== ""));
  if (!nonEmptyRows.length) return [];

  const headers = nonEmptyRows[0].map(h => String(h ?? "").trim());

  return nonEmptyRows.slice(1).map(cells => {
    const obj = {};
    headers.forEach((header, idx) => { if (header) { obj[header] = cells[idx] ?? ""; } });
    return obj;
  });

}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error || new Error("Lecture du fichier impossible"));
    reader.readAsText(file, "UTF-8");
  });
}

async function loadSchoolsFromFile(file) {

  if (!file) return;

  const status = document.getElementById("postgresStatus");
  const count = document.getElementById("postgresCount");

  if (status) { status.textContent = "Lecture du fichier..."; }
  setText("statusText", "Lecture du fichier...");

  try {

    const text = await readFileAsText(file);
    const rows = parseCSV(text);

    if (!rows.length) {
      throw new Error("Le fichier CSV ne contient aucune ligne de données exploitable.");
    }

    STATE.raw = rows.map(mapCsvRowToInternalKeys).map(normalizeSchool);
    STATE.filtered = STATE.raw.slice();
    STATE.fileLoaded = true;
    STATE.fileName = file.name;

    await saveSchoolsToStorage();

    setText("statusText", "Fichier chargé");
    const pill = document.getElementById("statusPill");
    if (pill) { pill.classList.add("connected"); }

    if (status) { status.textContent = "✓ Fichier importé : " + file.name; }
    if (count) { count.textContent = formatNumber(STATE.raw.length) + " école(s) chargée(s)"; }

    refreshFilterOptions();
    applyFilters();
    updateKPIs();
    updateTicker();
    renderTable();
    updateMap();
    renderStats();

    toast("Fichier importé : " + formatNumber(STATE.raw.length) + " école(s).", "success");

    return STATE.raw;

  }
  catch (error) {

    console.error("Erreur de lecture du fichier CSV :", error);
    STATE.fileLoaded = false;
    setText("statusText", "Erreur de lecture du fichier");
    if (status) { status.textContent = "✕ Impossible de lire ce fichier"; }
    if (count) { count.textContent = ""; }
    toast("Impossible de lire le fichier CSV importé.", "error");
    return [];

  }

}

let csvFileInput = null;

function ensureCsvFileInput() {

  if (csvFileInput) return csvFileInput;

  csvFileInput = document.createElement("input");
  csvFileInput.type = "file";
  csvFileInput.accept = ".csv,text/csv";
  csvFileInput.style.display = "none";

  csvFileInput.addEventListener("change", async event => {
    const file = event.target.files && event.target.files[0];
    if (file) { await loadSchoolsFromFile(file); }
    csvFileInput.value = "";
  });

  document.body.appendChild(csvFileInput);
  return csvFileInput;

}

function triggerCsvImport() {
  ensureCsvFileInput().click();
}

/* ===== KPI ===== */

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

function updateFlagStrip() {
  const green = document.querySelector("#flagStrip .flag-green");
  const yellow = document.querySelector("#flagStrip .flag-yellow");
  const red = document.querySelector("#flagStrip .flag-red");
  if (green) green.style.flex = "1 1 0";
  if (yellow) yellow.style.flex = "1 1 0";
  if (red) red.style.flex = "1 1 0";
}

function updateTicker() {

  const rows = STATE.filtered;
  const functional = rows.filter(isFunctional).length;
  const nonFunctional = rows.filter(isNonFunctional).length;
  const students = rows.reduce((sum, e) => sum + numberValue(e.effectif_total), 0);
  const classes = rows.reduce((sum, e) => sum + numberValue(e.nombre_classes), 0);

  setText("tkEcoles", formatNumber(rows.length));
  setText("tkFonct", formatNumber(functional));
  setText("tkNonFonct", formatNumber(nonFunctional));
  setText("tkEleves", formatNumber(students));
  setText("tkClasses", formatNumber(classes));

}

/* ===== FILTRES ===== */

function uniqueSorted(rows, field) {
  return [...new Set(rows.map(row => row[field]).filter(v => String(v ?? "").trim() !== ""))]
    .sort((a, b) => String(a).localeCompare(String(b), "fr"));
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
    input.addEventListener("change", () => { readFilters(); applyFilters(); });

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
    if (selected.includes(value)) { button.classList.add("active"); }
    button.textContent = value;

    button.addEventListener("click", () => {
      const list = STATE.filters[filterKey];
      const index = list.indexOf(value);
      if (index >= 0) { list.splice(index, 1); } else { list.push(value); }
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
    if (!container) return [];
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
      if (!text.includes(query)) return false;
    }

    if (f.commune.length && !f.commune.includes(school.commune)) return false;
    if (f.quartier.length && !f.quartier.includes(school.quartier)) return false;
    if (f.type_ecole.length && !f.type_ecole.includes(school.type_ecole)) return false;
    if (f.niveau.length && !f.niveau.includes(school.niveau)) return false;
    if (f.statut_fonctionnement.length && !f.statut_fonctionnement.includes(school.statut_fonctionnement)) return false;

    return true;

  });

  updateKPIs();
  updateTicker();
  STATE.tablePage = 1;
  renderTable();
  updateMap();
  renderStats();

}

function resetFilters() {

  STATE.filters = { search: "", commune: [], quartier: [], type_ecole: [], niveau: [], statut_fonctionnement: [] };

  const search = document.getElementById("searchInput");
  if (search) { search.value = ""; }

  refreshFilterOptions();
  applyFilters();

  toast("Filtres réinitialisés.", "success");

}

/* ===== CARTE LEAFLET ===== */

let map = null;
let markerLayer = null;
let markersById = {};
let baseLayerOSM = null;
let baseLayerSatellite = null;
let currentBaseLayer = "osm";
let userLocationMarker = null;

function initMap() {

  if (typeof L === "undefined") { console.error("Leaflet n'est pas chargé."); return; }
  if (map) return;

  map = L.map("map", { center: [12.6392, -8.0029], zoom: 12 });

  baseLayerOSM = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19, attribution: "&copy; OpenStreetMap" }
  ).addTo(map);

  baseLayerSatellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Tiles &copy; Esri" }
  );

  markerLayer = L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
  map.addLayer(markerLayer);

  map.on("mousemove", event => {
    setText("coordReadout", "lat " + event.latlng.lat.toFixed(5) + " / lon " + event.latlng.lng.toFixed(5));
  });

  STATE.mapInitialized = true;
  window.map = map;

  addMapOptionsControl();

}

function toggleBaseLayer() {

  if (!map) return;

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

  if (!map) return;

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
          html: '<div style="width:16px;height:16px;border-radius:50%;background:#1d8f5a;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);"></div>',
          iconSize: [16, 16], iconAnchor: [8, 8]
        });
        userLocationMarker = L.marker(latlng, { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
        userLocationMarker.bindPopup("Votre position");
      }

      map.flyTo(latlng, Math.max(map.getZoom(), 15), { duration: 0.6 });
      userLocationMarker.openPopup();

    },

    () => { toast("Localisation refusée ou indisponible.", "error"); },

    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }

  );

}

function toggleMapFullscreen() {
  const el = document.getElementById("map");
  if (!el) return;
  if (!document.fullscreenElement) { if (el.requestFullscreen) el.requestFullscreen(); }
  else { if (document.exitFullscreen) document.exitFullscreen(); }
}

document.addEventListener("fullscreenchange", () => {
  setTimeout(() => { if (map) map.invalidateSize(); }, 150);
});

const MapOptionsControl = (typeof L !== "undefined" && L.Control) ? L.Control.extend({

  options: { position: "topright" },

  onAdd: function () {

    const container = L.DomUtil.create("div", "leaflet-bar map-options-control");
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const btnLayers = L.DomUtil.create("a", "map-opt-btn", container);
    btnLayers.href = "#"; btnLayers.title = "Changer de fond de carte";
    btnLayers.innerHTML = "<i class=\"fa-solid fa-layer-group\"></i>";

    const btnLocate = L.DomUtil.create("a", "map-opt-btn", container);
    btnLocate.href = "#"; btnLocate.title = "Ma position";
    btnLocate.innerHTML = "<i class=\"fa-solid fa-location-crosshairs\"></i>";

    const btnFullscreen = L.DomUtil.create("a", "map-opt-btn", container);
    btnFullscreen.href = "#"; btnFullscreen.title = "Plein écran";
    btnFullscreen.innerHTML = "<i class=\"fa-solid fa-expand\"></i>";

    L.DomEvent.on(btnLayers, "click", e => { L.DomEvent.preventDefault(e); toggleBaseLayer(); });
    L.DomEvent.on(btnLocate, "click", e => { L.DomEvent.preventDefault(e); locateUserOnMap(); });
    L.DomEvent.on(btnFullscreen, "click", e => { L.DomEvent.preventDefault(e); toggleMapFullscreen(); });

    return container;

  }

}) : null;

(function injectMapOptionsStyle() {
  const style = document.createElement("style");
  style.textContent =
    ".map-options-control{display:flex;flex-direction:column;overflow:hidden;}" +
    ".map-opt-btn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:#fff;color:#241f12;font-size:16px;text-decoration:none;border-bottom:1px solid #e6dcb8;cursor:pointer;}" +
    ".map-opt-btn:last-child{border-bottom:none;}" +
    ".map-opt-btn:hover{background:#f7f3e8;}";
  document.head.appendChild(style);
})();

(function injectSchoolMarkerStyle() {
  const style = document.createElement("style");
  style.textContent =
    ".school-pin-wrap{position:relative;display:block;}" +
    ".school-pin-base{position:absolute;top:0;left:0;line-height:1;}" +
    ".school-pin-icon{position:absolute;left:50%;transform:translateX(-50%);}" +
    ".school-popup{min-width:222px;font-family:'Inter',sans-serif;}" +
    ".school-popup-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px;}" +
    ".school-popup-name{font-size:14.5px;font-weight:700;color:#241f12;line-height:1.3;}" +
    ".school-popup-loc{display:flex;align-items:center;gap:6px;font-size:12px;color:#5c5335;margin-bottom:9px;}" +
    ".school-popup-loc i{color:#b8912e;font-size:11px;}" +
    ".school-popup-meta{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11.5px;color:#5c5335;margin-bottom:11px;padding-bottom:11px;border-bottom:1px dashed #e6dcb8;}" +
    ".school-popup-stat{display:inline-flex;align-items:center;gap:6px;font-weight:700;}" +
    ".school-popup-stat i{font-size:7px;}" +
    ".school-popup-stat.ok{color:#00853f;}" +
    ".school-popup-stat.bad{color:#ce1126;}" +
    ".school-popup-eff{display:inline-flex;align-items:center;gap:6px;}" +
    ".school-popup-eff i{color:#9a8c5c;font-size:11px;}" +
    ".popup-detail-btn{display:flex;align-items:center;justify-content:center;gap:7px;border-radius:8px !important;transition:transform .15s ease, box-shadow .15s ease;}" +
    ".popup-detail-btn:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(212,175,55,.35);}" +
    ".leaflet-popup-content{margin:14px 16px !important;}" +
    ".leaflet-popup-content-wrapper{border-radius:12px !important;box-shadow:0 14px 34px rgba(15,23,32,.18) !important;}";
  document.head.appendChild(style);
})();

function addMapOptionsControl() {
  if (map && MapOptionsControl) { map.addControl(new MapOptionsControl()); }
}

function toRoman(num) {
  const table = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let n = num, result = "";
  table.forEach(([value, symbol]) => { while (n >= value) { result += symbol; n -= value; } });
  return result || String(num);
}

function formatCommuneLabel(value) {
  const str = String(value ?? "").trim();
  const match = str.match(/^commune\s*([0-9]+)$/i);
  return match ? "Commune " + toRoman(Number(match[1])) : str;
}

function badgeClass(type) {
  const value = normalizeText(type);
  if (value === "public") return "public";
  if (value === "prive" || value === "privé") return "prive";
  return "comm";
}

function markerColor(type) {
  const value = normalizeText(type);
  if (value.includes("public")) return "#00853f";
  if (value.includes("prive")) return "#fcd116";
  return "#ce1126";
}

function createSchoolMarker(school) {

  if (!Number.isFinite(Number(school.latitude)) || !Number.isFinite(Number(school.longitude))) return null;

  const color = markerColor(school.type_ecole);
  const capColor = isNonFunctional(school) ? "#ce1126" : "#241f12";

  const PIN_SIZE = 33, CAP_SIZE = 15, GAP = 2;
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

  const marker = L.marker([Number(school.latitude), Number(school.longitude)], { icon });

  const statusOk = isFunctional(school);
  const statusLabel = escapeHtml(school.statut_fonctionnement) || (statusOk ? "Fonctionnelle" : "Non fonctionnelle");

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
    if (popup) { popup.addEventListener("click", () => { openSchoolDetail(school); }); }
  });

  return marker;

}

function updateMap() {

  if (!map || !markerLayer) return;

  markerLayer.clearLayers();
  markersById = {};

  STATE.filtered.forEach(school => {
    const marker = createSchoolMarker(school);
    if (!marker) return;
    markerLayer.addLayer(marker);
    markersById[String(school.id_ecole)] = marker;
  });

  const validSchools = STATE.filtered.filter(
    s => Number.isFinite(Number(s.latitude)) && Number.isFinite(Number(s.longitude))
  );

  const empty = document.getElementById("mapEmptyState");
  if (empty) { empty.style.display = validSchools.length ? "none" : "block"; }

}

function locateSchoolOnMap(school) {

  if (!map) return;

  if (!Number.isFinite(Number(school.latitude)) || !Number.isFinite(Number(school.longitude))) {
    toast("Cette école ne possède pas de coordonnées GPS.", "error");
    return;
  }

  map.setView([Number(school.latitude), Number(school.longitude)], 16);
  const marker = markersById[String(school.id_ecole)];
  if (marker) { marker.openPopup(); }

}

/* ===== DETAIL ECOLE ===== */

function buildSchoolDetailGrid(school) {
  return `
    <div class="detail-grid">
      <div class="detail-item"><strong>ID</strong><span>${escapeHtml(school.id_ecole)}</span></div>
      <div class="detail-item"><strong>Type</strong><span><span class="badge ${badgeClass(school.type_ecole)}">${escapeHtml(school.type_ecole)}</span></span></div>
      <div class="detail-item"><strong>Niveau</strong><span>${escapeHtml(afficherNiveau(school.niveau))}</span></div>
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

function openSchoolDetail(school) {

  STATE.selectedSchool = school;

  const typeLabel = school.type_ecole ? String(school.type_ecole).toUpperCase() : "";
  const locationLabel = formatCommuneLabel(school.commune) + " · " + (school.quartier || "—");

  setText("schoolPageType", typeLabel ? (typeLabel + " · " + locationLabel) : locationLabel);
  setText("schoolPageName", school.nom_ecole);

  const body = document.getElementById("schoolPageBody");
  if (body) { body.innerHTML = buildSchoolDetailGrid(school); }

  hidePanel("panel-detail");
  if (map) { map.closePopup(); }

  const page = document.getElementById("schoolPage");
  if (page) { page.classList.add("show"); }

}

/* ===== PANNEAUX ===== */

function showPanel(id) {
  const panel = document.getElementById(id);
  if (panel) { panel.classList.add("active"); }
}

function hidePanel(id) {
  const panel = document.getElementById(id);
  if (panel) { panel.classList.remove("active"); }
}

function exitFullscreenDrawer() {
  document.body.classList.remove("table-mode", "stats-mode");
  const drawer = document.getElementById("drawer");
  if (drawer) { drawer.classList.remove("open"); }
  if (map) { setTimeout(() => { map.invalidateSize(); }, 120); }
}

/* ===== NAVIGATION ===== */

function showModule(module) {

  STATE.currentModule = module;

  hidePanel("panel-detail");
  hidePanel("panel-route");

  if (module === "accueil") { exitFullscreenDrawer(); showHomeScreen(); return; }

  hideHomeScreen();

  if (module === "carte") { exitFullscreenDrawer(); showCarteModule(); return; }
  if (module === "stats") { showStatsModule(); return; }
  if (module === "tableau") { showTableModule(); return; }

}

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

function showCarteModule() {

  hideHomeScreen();

  const drawer = document.getElementById("drawer");
  if (drawer) { drawer.classList.remove("open"); }

  const table = document.getElementById("drawerBodyTable");
  const stats = document.getElementById("drawerBodyStats");
  if (table) { table.style.display = "block"; }
  if (stats) { stats.style.display = "none"; }

  setText("drawerTitle", "Tableau des établissements");

  if (map) { setTimeout(() => { map.invalidateSize(); }, 100); }

}

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

  setText("drawerTitle", "Tableau des établissements");
  renderTable();

}

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

  setText("drawerTitle", "Analyse statistique");
  renderStats();

}

function initNavigation() {

  document.querySelectorAll("[data-nav]").forEach(button => {

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

function initHomeButtons() {

  const enterPortal = document.getElementById("btnEnterPortal");
  if (enterPortal) { enterPortal.addEventListener("click", () => { showModule("carte"); }); }

  const enterStats = document.getElementById("btnEnterStats");
  if (enterStats) { enterStats.addEventListener("click", () => { showModule("stats"); }); }

  const backHome = document.getElementById("btnBackHome");
  if (backHome) { backHome.addEventListener("click", () => { showModule("accueil"); }); }

}

/* ===== TABLEAU (avec pagination) ===== */

function renderTable() {

  const tbody = document.getElementById("tableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const rows = STATE.filtered;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:25px;">Aucune école trouvée.</td></tr>`;
    renderTablePagination(0, 0, 0);
    return;
  }

  const pageSize = STATE.tablePageSize;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  if (STATE.tablePage > totalPages) { STATE.tablePage = totalPages; }
  if (STATE.tablePage < 1) { STATE.tablePage = 1; }

  const start = (STATE.tablePage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  pageRows.forEach(school => {

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

  renderTablePagination(rows.length, start, start + pageRows.length);

}

function ensureTablePaginationContainer() {

  let container = document.getElementById("tablePagination");
  if (container) return container;

  const host = document.getElementById("drawerBodyTable");
  if (!host) return null;

  container = document.createElement("div");
  container.id = "tablePagination";
  host.appendChild(container);

  return container;

}

function renderTablePagination(total, startIndex, endIndex) {

  const container = ensureTablePaginationContainer();
  if (!container) return;

  if (!total) { container.innerHTML = ""; return; }

  const totalPages = Math.max(1, Math.ceil(total / STATE.tablePageSize));
  const page = STATE.tablePage;

  container.innerHTML = `
    <div class="pagination-info">
      ${formatNumber(startIndex + 1)}–${formatNumber(endIndex)} sur ${formatNumber(total)} écoles
    </div>
    <div class="pagination-controls">
      <button type="button" class="btn small" id="btnTablePrev" ${page <= 1 ? "disabled" : ""}>← Précédent</button>
      <span class="pagination-page">Page ${page} / ${totalPages}</span>
      <button type="button" class="btn small" id="btnTableNext" ${page >= totalPages ? "disabled" : ""}>Suivant →</button>
      <select class="pagination-size" id="selectTablePageSize">
        ${[25, 50, 100, 250, 500].map(n =>
          `<option value="${n}" ${n === STATE.tablePageSize ? "selected" : ""}>${n} / page</option>`
        ).join("")}
      </select>
    </div>
  `;

  const prev = document.getElementById("btnTablePrev");
  const next = document.getElementById("btnTableNext");
  const sizeSelect = document.getElementById("selectTablePageSize");

  if (prev) { prev.addEventListener("click", () => { STATE.tablePage = Math.max(1, STATE.tablePage - 1); renderTable(); }); }
  if (next) { next.addEventListener("click", () => { STATE.tablePage = Math.min(totalPages, STATE.tablePage + 1); renderTable(); }); }
  if (sizeSelect) {
    sizeSelect.addEventListener("change", () => {
      STATE.tablePageSize = Number(sizeSelect.value) || 50;
      STATE.tablePage = 1;
      renderTable();
    });
  }

}

/* ===== STATISTIQUES ===== */

function calculateStats() {

  const rows = STATE.filtered;
  const schools = rows.length;
  const students = rows.reduce((sum, s) => sum + numberValue(s.effectif_total), 0);
  const classes = rows.reduce((sum, s) => sum + numberValue(s.nombre_classes), 0);
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

function destroyChart(name) {
  if (STATE.charts[name]) { STATE.charts[name].destroy(); STATE.charts[name] = null; }
}

function getVar(name) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  catch (e) { return ""; }
}

function niveauColor(niveau) {
  const value = normalizeText(niveau);
  if (value.includes("fondamental")) return "#3d7ea6";
  if (value.includes("secondaire")) return "#b8912e";
  if (value.includes("technique")) return "#7b6aa8";
  if (value.includes("pr_scolaire") || value.includes("prescolaire")) return "#6ba86a";
  if (value.includes("universite")) return "#6ba86a";
  return "#8b8b8b";
}

function drawChart(id, type, labels, data, colors) {

  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (typeof Chart === "undefined") { console.warn("Chart.js non chargé."); return; }

  destroyChart(id);

  const isBar = type === "bar";
  const backgroundColor = colors || getVar("--amber") || "#d4af37";
  const axisColor = getVar("--muted") || "#9a8c5c";
  const legendColor = getVar("--ink-soft") || "#5c5335";
  const surfaceColor = getVar("--surface") || "#ffffff";

  STATE.charts[id] = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [{
        data, backgroundColor,
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
      scales: isBar ? {
        x: { grid: { display: false, drawTicks: false }, border: { display: false }, ticks: { font: { size: 9 }, color: axisColor } },
        y: { beginAtZero: true, grid: { display: false, drawTicks: false }, border: { display: false }, ticks: { font: { size: 9 }, color: axisColor } }
      } : {}
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
  drawChart("chartCommune", "bar", Object.keys(communes).map(formatCommuneLabel), Object.values(communes), getVar("--teal-dim") || "#b8912e");

  const types = groupCount("type_ecole");
  drawChart("chartType", "doughnut", Object.keys(types), Object.values(types), Object.keys(types).map(markerColor));

  const studentsCommune = groupSum("commune", "effectif_total");
  drawChart("chartStudentsCommune", "bar", Object.keys(studentsCommune).map(formatCommuneLabel), Object.values(studentsCommune), getVar("--amber") || "#d4af37");

  const classesCommune = groupSum("commune", "nombre_classes");
  drawChart("chartClassesCommune", "bar", Object.keys(classesCommune).map(formatCommuneLabel), Object.values(classesCommune), getVar("--red-dim") || "#8a6a1a");

  const niveaux = groupCount("niveau");
  drawChart("chartNiveau", "doughnut", Object.keys(niveaux).map(afficherNiveau), Object.values(niveaux), Object.keys(niveaux).map(niveauColor));

  const niveauStudents = groupSum("niveau", "effectif_total");
  drawChart("chartNiveauEff", "bar", Object.keys(niveauStudents).map(afficherNiveau), Object.values(niveauStudents), Object.keys(niveauStudents).map(niveauColor));

}
/* ===== Affichage niveau ===== */
function afficherNiveau(niveau) {
    if (niveau === "pr_scolaire") {
        return "Préscolaire";
    }
    return niveau;
}
function renderRanking() {

  const container = document.getElementById("rankCommunes");
  if (!container) return;

  const counts = groupCount("commune");
  const ranking = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  container.innerHTML = "";

  if (!ranking.length) { container.innerHTML = "<p>Aucune donnée.</p>"; return; }

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
      if (idx >= 0) { STATE.filters.commune.splice(idx, 1); } else { STATE.filters.commune.push(commune); }
      refreshFilterOptions();
      applyFilters();
    };

    item.addEventListener("click", toggle);
    item.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
    });

    container.appendChild(item);

  });

}

function renderInsights() {

  const container = document.getElementById("insightsList");
  if (!container) return;

  const rows = STATE.filtered;
  if (!rows.length) { container.innerHTML = "<p>Aucune donnée à analyser.</p>"; return; }

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

  container.innerHTML = messages.map(message => `<div class="insight-item">${escapeHtml(message)}</div>`).join("");

}

/* ===== ITINERAIRE ===== */

function buildGoogleMapsDirectionsUrl(destination, origin) {
  let url = "https://www.google.com/maps/dir/?api=1&destination=" + destination + "&travelmode=driving&dir_action=navigate";
  if (origin) { url += "&origin=" + origin; }
  return url;
}

function openInGoogleMaps(school) {

  if (!Number.isFinite(Number(school.latitude)) || !Number.isFinite(Number(school.longitude))) {
    toast("Cette école ne possède pas de coordonnées GPS.", "error");
    return;
  }

  const destination = Number(school.latitude) + "," + Number(school.longitude);

  if (!navigator.geolocation) {
    window.open(buildGoogleMapsDirectionsUrl(destination), "_blank");
    return;
  }

  toast("Récupération de votre position…", "info");

  navigator.geolocation.getCurrentPosition(
    position => {
      const origin = position.coords.latitude + "," + position.coords.longitude;
      window.open(buildGoogleMapsDirectionsUrl(destination, origin), "_blank");
    },
    () => {
      toast("Position indisponible : précisez votre point de départ dans Google Maps.", "error");
      window.open(buildGoogleMapsDirectionsUrl(destination), "_blank");
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );

}

function startRoute(school) {

  STATE.selectedSchool = school;

  hidePanel("panel-detail");
  closeSchoolPage();
  hidePanel("panel-filters");
  if (map) { map.closePopup(); }

  setText("routeSchoolName", school.nom_ecole);

  const body = document.getElementById("routeBody");

  if (body) {

    const hasCoords = Number.isFinite(Number(school.latitude)) && Number.isFinite(Number(school.longitude));

    body.innerHTML = `
      <div class="detail-grid">
        <div class="detail-item wide"><strong>École</strong><span>${escapeHtml(school.nom_ecole)}</span></div>
        <div class="detail-item"><strong>Commune</strong><span>${escapeHtml(formatCommuneLabel(school.commune))}</span></div>
        <div class="detail-item"><strong>Quartier</strong><span>${escapeHtml(school.quartier) || "—"}</span></div>
        <div class="detail-item wide"><strong>Coordonnées GPS</strong><span>${hasCoords ? Number(school.latitude).toFixed(6) + ", " + Number(school.longitude).toFixed(6) : "—"}</span></div>
      </div>

      <button type="button" class="btn primary full" id="btnOpenGoogleMaps" style="margin-top:16px;display:flex;align-items:center;justify-content:center;gap:8px;">
        <i class="fa-brands fa-google"></i>
        Ouvrir l'itinéraire dans Google Maps
      </button>

      <p class="note" style="text-align:center;">
        Votre position sera utilisée automatiquement comme point de départ.
      </p>
    `;

    const gmapsBtn = document.getElementById("btnOpenGoogleMaps");
    if (gmapsBtn) { gmapsBtn.onclick = () => openInGoogleMaps(school); }

  }

  showPanel("panel-route");

  if (map && Number.isFinite(Number(school.latitude)) && Number.isFinite(Number(school.longitude))) {
    map.setView([Number(school.latitude), Number(school.longitude)], 15);
  }

}

/* ===== PANNEAU ITINÉRAIRE DÉPLAÇABLE À LA SOURIS ===== */

function initDraggableRoutePanel() {

  const panel = document.getElementById("panel-route");
  if (!panel) return;

  const handle = panel.querySelector(".panel-head");
  if (!handle) return;

  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;
  let hasCustomPosition = false;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  function getPointer(event) {
    if (event.touches && event.touches.length) return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    return { x: event.clientX, y: event.clientY };
  }

  function switchToAbsolutePosition() {
    if (hasCustomPosition) return;
    const rect = panel.getBoundingClientRect();
    panel.style.transform = "none";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.left = rect.left + "px";
    panel.style.top = rect.top + "px";
    hasCustomPosition = true;
  }

  function onPointerDown(event) {

    if (event.target.closest("#routeClose")) return;

    switchToAbsolutePosition();

    const pointer = getPointer(event);
    const rect = panel.getBoundingClientRect();

    dragging = true;
    startX = pointer.x;
    startY = pointer.y;
    startLeft = rect.left;
    startTop = rect.top;

    panel.classList.add("dragging");
    document.body.classList.add("route-dragging");

    event.preventDefault();

  }

  function onPointerMove(event) {

    if (!dragging) return;

    const pointer = getPointer(event);
    const deltaX = pointer.x - startX;
    const deltaY = pointer.y - startY;
    const rect = panel.getBoundingClientRect();

    const maxLeft = window.innerWidth - rect.width - 8;
    const maxTop = window.innerHeight - rect.height - 8;

    panel.style.left = clamp(startLeft + deltaX, 8, Math.max(8, maxLeft)) + "px";
    panel.style.top = clamp(startTop + deltaY, 8, Math.max(8, maxTop)) + "px";

  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("dragging");
    document.body.classList.remove("route-dragging");
  }

  handle.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);

  handle.addEventListener("touchstart", onPointerDown, { passive: false });
  window.addEventListener("touchmove", onPointerMove, { passive: false });
  window.addEventListener("touchend", onPointerUp);

  window.addEventListener("resize", () => {
    hasCustomPosition = false;
    panel.style.left = "";
    panel.style.top = "";
    panel.style.right = "";
    panel.style.bottom = "";
    panel.style.transform = "";
  });

}

/* ===== FERMETURE DES PANNEAUX ===== */

function initPanelClosers() {

  const detailClose = document.getElementById("detailClose");
  if (detailClose) { detailClose.addEventListener("click", () => { hidePanel("panel-detail"); }); }

  const routeClose = document.getElementById("routeClose");
  if (routeClose) { routeClose.addEventListener("click", () => { hidePanel("panel-route"); }); }

  const filtersClose = document.getElementById("filtersClose");
  if (filtersClose) { filtersClose.addEventListener("click", () => { hidePanel("panel-filters"); }); }

  const openFilters = document.getElementById("btnOpenFilters");
  if (openFilters) { openFilters.addEventListener("click", () => { showPanel("panel-filters"); }); }

  const drawerToggle = document.getElementById("drawer-toggle");
  if (drawerToggle) {
    drawerToggle.addEventListener("click", () => {
      const drawer = document.getElementById("drawer");
      if (drawer) { drawer.classList.toggle("open"); }
    });
  }

  const drawerClose = document.getElementById("drawerClose");
  if (drawerClose) { drawerClose.addEventListener("click", () => { showModule("carte"); }); }

}

function initFilters() {

  const search = document.getElementById("searchInput");
  if (search) { search.addEventListener("input", () => { readFilters(); applyFilters(); }); }

  const reset = document.getElementById("btnResetFilters");
  if (reset) { reset.addEventListener("click", resetFilters); }

}

/* ===== EXPORT CSV ===== */

function csvEscape(value) {
  return '"' + String(value ?? "").replace(/"/g, '""') + '"';
}

function exportSchoolsCSV() {

  const rows = STATE.filtered;
  if (!rows.length) { toast("Aucune donnée à exporter.", "error"); return; }

  const headers = CSV_EXPECTED_HEADERS;
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

/* ===== MODALE IMPORT DE FICHIER ===== */

function openDataImportModal() {

  const overlay = document.getElementById("overlay");
  if (overlay) { overlay.classList.add("active"); }

  const status = document.getElementById("postgresStatus");
  const count = document.getElementById("postgresCount");

  if (STATE.fileLoaded) {
    if (status) { status.textContent = "✓ Fichier importé : " + STATE.fileName; }
    if (count) { count.textContent = formatNumber(STATE.raw.length) + " école(s) chargée(s)"; }
  }
  else {
    if (status) { status.textContent = "Aucun fichier importé pour l'instant."; }
    if (count) { count.textContent = ""; }
  }

}

function closeDataImportModal() {
  const overlay = document.getElementById("overlay");
  if (overlay) { overlay.classList.remove("active"); }
}

/* ===== AUTHENTIFICATION ADMIN ===== */

const ADMIN_PASSWORD_HASH = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";
const ADMIN_AUTH_MAX_ATTEMPTS = 3;
const ADMIN_AUTH_LOCK_MS = 30000;

let adminAuthAttempts = 0;
let adminAuthLockedUntil = 0;
let adminAuthLockTimer = null;

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

window.__hashAdminPassword = sha256Hex;

function setAdminAuthControlsEnabled(enabled) {
  const input = document.getElementById("adminPasswordInput");
  const submit = document.getElementById("btnAdminAuthSubmit");
  const toggle = document.getElementById("btnToggleAdminPassword");
  if (input) { input.disabled = !enabled; }
  if (submit) { submit.disabled = !enabled; }
  if (toggle) { toggle.disabled = !enabled; }
}

function startAdminAuthLockCountdown(durationMs) {

  adminAuthLockedUntil = Date.now() + durationMs;
  const msg = document.getElementById("adminAuthMsg");

  setAdminAuthControlsEnabled(false);
  if (adminAuthLockTimer) { clearInterval(adminAuthLockTimer); }

  const tick = () => {

    const remaining = Math.ceil((adminAuthLockedUntil - Date.now()) / 1000);

    if (remaining <= 0) {
      clearInterval(adminAuthLockTimer);
      adminAuthLockTimer = null;
      adminAuthLockedUntil = 0;
      adminAuthAttempts = 0;
      setAdminAuthControlsEnabled(true);
      if (msg) { msg.textContent = ""; msg.className = "msg"; }
      return;
    }

    if (msg) {
      msg.textContent = "Trop de tentatives. Réessayez dans " + remaining + "s.";
      msg.className = "msg err";
    }

  };

  tick();
  adminAuthLockTimer = setInterval(tick, 1000);

}

function setAdminMode(isAdmin) {

  document.body.classList.toggle("admin-mode", isAdmin);
  document.querySelectorAll('[data-role="public"]').forEach(btn => btn.classList.toggle("active", !isAdmin));
  document.querySelectorAll('[data-role="admin"]').forEach(btn => btn.classList.toggle("active", isAdmin));

  setText("homeModeIndicatorText", isAdmin ? "Mode admin" : "Mode public");

  const indicator = document.getElementById("homeModeIndicator");
  if (indicator) { indicator.classList.toggle("is-admin", isAdmin); }

}

function openAdminAuthModal() {

  const overlay = document.getElementById("adminAuthOverlay");
  if (overlay) { overlay.classList.add("active"); }

  const msg = document.getElementById("adminAuthMsg");
  const input = document.getElementById("adminPasswordInput");
  if (input) { input.value = ""; }

  if (Date.now() < adminAuthLockedUntil) {
    startAdminAuthLockCountdown(adminAuthLockedUntil - Date.now());
  }
  else {
    if (msg) { msg.textContent = ""; msg.className = "msg"; }
    setAdminAuthControlsEnabled(true);
    if (input) { input.focus(); }
  }

}

function closeAdminAuthModal() {
  const overlay = document.getElementById("adminAuthOverlay");
  if (overlay) { overlay.classList.remove("active"); }
}

async function submitAdminAuth() {

  const now = Date.now();
  if (now < adminAuthLockedUntil) return;

  const input = document.getElementById("adminPasswordInput");
  const msg = document.getElementById("adminAuthMsg");
  const submit = document.getElementById("btnAdminAuthSubmit");
  const value = input ? input.value : "";

  if (!value) {
    if (msg) { msg.textContent = "Veuillez saisir un mot de passe."; msg.className = "msg err"; }
    return;
  }

  if (submit) { submit.disabled = true; }

  let hash;
  try {
    hash = await sha256Hex(value);
  }
  catch (error) {
    console.error("Erreur de hachage du mot de passe :", error);
    if (msg) { msg.textContent = "Erreur de vérification. Réessayez."; msg.className = "msg err"; }
    if (submit) { submit.disabled = false; }
    return;
  }

  if (hash === ADMIN_PASSWORD_HASH) {

    adminAuthAttempts = 0;
    setAdminMode(true);
    closeAdminAuthModal();
    toast("Mode administrateur activé.", "success");

  }
  else {

    adminAuthAttempts++;
    if (input) { input.value = ""; }

    if (adminAuthAttempts >= ADMIN_AUTH_MAX_ATTEMPTS) {
      adminAuthAttempts = 0;
      startAdminAuthLockCountdown(ADMIN_AUTH_LOCK_MS);
      toast("Trop de tentatives incorrectes. Accès verrouillé 30 secondes.", "error");
    }
    else {
      const remaining = ADMIN_AUTH_MAX_ATTEMPTS - adminAuthAttempts;
      if (msg) {
        msg.textContent = "Mot de passe incorrect (" + remaining + " tentative" + (remaining > 1 ? "s" : "") + " restante" + (remaining > 1 ? "s" : "") + ").";
        msg.className = "msg err";
      }
      toast("Mot de passe incorrect.", "error");
    }

    const modal = document.querySelector("#adminAuthOverlay .admin-auth-modal");
    if (modal) {
      modal.classList.remove("shake");
      void modal.offsetWidth;
      modal.classList.add("shake");
    }

    if (input && !input.disabled) { input.focus(); }

  }

  if (submit && Date.now() >= adminAuthLockedUntil) { submit.disabled = false; }

}

function initAdminPasswordToggle() {

  const button = document.getElementById("btnToggleAdminPassword");
  const input = document.getElementById("adminPasswordInput");
  if (!button || !input) return;

  button.addEventListener("click", () => {

    const showing = input.type === "text";
    input.type = showing ? "password" : "text";

    const icon = button.querySelector("i");
    if (icon) {
      icon.classList.toggle("fa-eye", showing);
      icon.classList.toggle("fa-eye-slash", !showing);
    }

    button.setAttribute("aria-label", showing ? "Afficher le mot de passe" : "Masquer le mot de passe");
    input.focus();

  });

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
  if (input) { input.addEventListener("keydown", e => { if (e.key === "Enter") { submitAdminAuth(); } }); }

  initAdminPasswordToggle();

  if (overlay) {
    overlay.addEventListener("click", e => { if (e.target === overlay) { closeAdminAuthModal(); } });
  }

  const modeSwitch = document.getElementById("topbarModeSwitch");
  if (modeSwitch) {
    modeSwitch.querySelectorAll("button").forEach(button => {
      button.addEventListener("click", () => {
        const role = button.dataset.role;
        if (role === "admin") {
          if (document.body.classList.contains("admin-mode")) return;
          openAdminAuthModal();
        }
        else {
          setAdminMode(false);
        }
      });
    });
  }

}

/* ===== ADMIN — gestion des données ===== */

function initAdmin() {

  const connect = document.getElementById("btnConnect");
  const homeAdmin = document.getElementById("homeAdminLink");
  const homeAdminMobile = document.getElementById("homeAdminLinkMobile");
  const close = document.getElementById("modalClose");
  const chooseFile = document.getElementById("btnTestPostgres");
  const reimport = document.getElementById("btnRefreshPostgres");
  const download = document.getElementById("btnDownloadPostgres");

  ensureCsvFileInput();

  const requireAdminThen = action => {
    if (document.body.classList.contains("admin-mode")) { action(); }
    else { openAdminAuthModal(); }
  };

  if (connect) { connect.addEventListener("click", () => requireAdminThen(openDataImportModal)); }
  if (homeAdmin) { homeAdmin.addEventListener("click", () => requireAdminThen(openDataImportModal)); }
  if (homeAdminMobile) { homeAdminMobile.addEventListener("click", () => requireAdminThen(openDataImportModal)); }
  if (close) { close.addEventListener("click", closeDataImportModal); }

  if (chooseFile) { chooseFile.addEventListener("click", triggerCsvImport); }
  if (reimport) { reimport.addEventListener("click", triggerCsvImport); }
  if (download) { download.addEventListener("click", exportSchoolsCSV); }

  const overlay = document.getElementById("overlay");
  if (overlay) {
    overlay.addEventListener("click", e => { if (e.target === overlay) { closeDataImportModal(); } });
  }

}

/* ===== MENU MOBILE ===== */

function initMobileMenu() {

  const burger = document.getElementById("homeBurger");
  const menu = document.getElementById("homeMobileMenu");
  if (!burger || !menu) return;

  burger.addEventListener("click", () => {
    const opened = menu.classList.toggle("open");
    burger.setAttribute("aria-expanded", opened ? "true" : "false");
  });

}

/* ===== TABS DU PANNEAU FILTRES ===== */

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

/* ===== GEOLOCALISATION ===== */

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

/* ===== PAGE DETAIL ECOLE ===== */

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

/* ===== INITIALISATION ===== */

async function initApplication() {

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
  initDraggableRoutePanel();

  showHomeScreen();

  typewriter(
    document.getElementById("homeHeadlineText"),
    document.getElementById("homeHeadlineCursor"),
    "Géolocalisez. Analysez.\nPlanifiez l’avenir."
  );

  const loadedFromStorage = await loadSchoolsFromStorage();

  if (loadedFromStorage) {

    setText("statusText", "Fichier chargé (en ligne)");
    const pill = document.getElementById("statusPill");
    if (pill) pill.classList.add("connected");

    const status = document.getElementById("postgresStatus");
    const count = document.getElementById("postgresCount");
    if (status) status.textContent = "✓ Données restaurées : " + STATE.fileName;
    if (count) count.textContent = formatNumber(STATE.raw.length) + " école(s) chargée(s)";

    refreshFilterOptions();
    applyFilters();
    updateKPIs();
    updateTicker();
    renderTable();
    updateMap();
    renderStats();

    toast("Données restaurées automatiquement (" + formatNumber(STATE.raw.length) + " écoles).", "success");

  }
  else {

    setText("statusText", "Aucun fichier importé");
    refreshFilterOptions();
    applyFilters();
    updateKPIs();
    updateTicker();
    renderTable();
    renderStats();

  }

  if (map) { setTimeout(() => { map.invalidateSize(); updateMap(); }, 300); }

}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApplication);
}
else {
  initApplication();
}

/* ===== FONCTIONS EXPOSÉES AU HTML ===== */

window.STATE = STATE;
window.showModule = showModule;
window.resetFilters = resetFilters;
window.exportSchoolsCSV = exportSchoolsCSV;
window.loadSchoolsFromFile = loadSchoolsFromFile;
window.triggerCsvImport = triggerCsvImport;
window.openSchoolDetail = openSchoolDetail;
window.startRoute = startRoute;
window.locateSchoolOnMap = locateSchoolOnMap;
window.renderTable = renderTable;
window.renderStats = renderStats;
window.updateMap = updateMap;
window.toggleBaseLayer = toggleBaseLayer;
window.locateUserOnMap = locateUserOnMap;
window.toggleMapFullscreen = toggleMapFullscreen;
