/* ==========================================
   VARIABLES GLOBALES & ÉLÉMENTS DOM
   ========================================== */
let catalogData = null;
let currentMD = null;
let currentAlbum = null;
let currentGenreFilters = new Set(); // Gestion multi-genres pour le catalogue principal
let isGenreDropdownOpen = false;     // État d'ouverture du menu filtre du catalogue
let currentTypeFilter = null;
let currentSearchQuery = '';
let adminAlbumCount = 0;
let editingMDIndex = null;
let toastTimeout = null;
let hasUnsavedChanges = false;
let selectedIdeaIndices = new Set();
let currentRecordFilter = 'all'; // 'all', 'toRecord', 'recorded'

// Filtre multi-genres et état du menu déroulant du planificateur
let currentPlannerGenreFilters = new Set();
let isPlannerGenreDropdownOpen = false;

const STORAGE_KEY = 'minidisc_catalog_backup';

const app = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const featuredContainer = document.getElementById('featured-container');

/* ==========================================
   PROTECTION ANTI-FERMETURE ET STOCKAGE LOCAL
   ========================================== */
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function saveLocalBackup() {
  const payload = {
    minidiscs: catalogData || [],
    ideaAlbums: window.ideaAlbums || []
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    hasUnsavedChanges = true;
  } catch (err) {
    console.error("Erreur de sauvegarde locale:", err);
  }
}

function clearLocalBackup() {
  localStorage.removeItem(STORAGE_KEY);
  hasUnsavedChanges = false;
}

/* ==========================================
   GESTION DU BOUTON ET DE LA BARRE DE RECHERCHE
   ========================================== */
function toggleSearch() {
  const topSearch = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  const fabBtn = document.getElementById('btn-search');

  if (!topSearch) return;

  const isClosed = topSearch.classList.contains('closed');

  if (!isClosed) {
    topSearch.classList.add('closed');
    if (fabBtn) fabBtn.textContent = '| Search';
    if (currentSearchQuery !== '') {
      currentSearchQuery = '';
      if (searchInput) searchInput.value = '';
      renderMDList({ genre: currentGenreFilter, type: currentTypeFilter }, false);
    }
  } else {
    topSearch.classList.remove('closed');
    if (fabBtn) fabBtn.textContent = '✕';
    if (searchInput) searchInput.focus();
  }
}

// Ouvre et ferme le menu déroulant des genres pour le filtre de la liste
function toggleGenreDropdown() {
  const dropdown = document.getElementById('genre-filter-dropdown');
  if (!dropdown) return;

  const isHidden = dropdown.classList.contains('hidden');

  if (isHidden) {
    renderGenreDropdownContent();
    dropdown.classList.remove('hidden');
  } else {
    dropdown.classList.add('hidden');
  }
}

// Génère le contenu dynamique des filtres par genre à partir de catalogData
function renderGenreDropdownContent() {
  const dropdown = document.getElementById('genre-filter-dropdown');
  if (!dropdown || !catalogData) return;

  const allGenres = new Set();

  catalogData.forEach(md => {
    let genres = [];
    if (typeof getMDAllGenres === 'function') {
      genres = getMDAllGenres(md);
    } else if (md.genre) {
      genres = typeof md.genre === 'string' ? md.genre.split(',') : md.genre;
    }

    genres.forEach(g => {
      if (g && typeof g === 'string' && g.trim()) {
        allGenres.add(g.trim().toUpperCase());
      }
    });
  });

  if (allGenres.size === 0) {
    dropdown.innerHTML = `<span style="font-size: 0.75rem; color: #666; font-weight: bold; padding: 4px;">Aucun genre</span>`;
    return;
  }

  // Bouton "TOUS" verrouillé en haut
  const isAllActive = !currentGenreFilter || currentGenreFilter === 'ALL' ? 'active' : '';
  let html = `
    <div class="genre-filter-sticky">
      <button class="genre-chip ${isAllActive}" onclick="selectGenreFilter('ALL')">TOUS</button>
    </div>
    <div class="genre-filter-scroll">
  `;

  // Puces de genres défilantes
  Array.from(allGenres).sort().forEach(genre => {
    const isActive = currentGenreFilter === genre ? 'active' : '';
    html += `<button class="genre-chip ${isActive}" onclick="selectGenreFilter('${genre.replace(/'/g, "\\'")}')">${genre}</button>`;
  });

  html += `</div>`;

  dropdown.innerHTML = html;
}

// Application du filtre sélectionné et rafraîchissement de la liste
function selectGenreFilter(genre) {
  currentGenreFilter = genre === 'ALL' ? '' : genre;

  const dropdown = document.getElementById('genre-filter-dropdown');
  if (dropdown) dropdown.classList.add('hidden');

  renderMDList({ 
    genre: currentGenreFilter, 
    type: currentTypeFilter, 
    record: currentRecordFilter 
  }, false);
}

// Change le filtre à chaque clic (Tous -> À enregistrer -> Enregistrés)
function cycleRecordFilter() {
  if (currentRecordFilter === 'all') {
    currentRecordFilter = 'toRecord';
  } else if (currentRecordFilter === 'toRecord') {
    currentRecordFilter = 'recorded';
  } else {
    currentRecordFilter = 'all';
  }

  updateFilterIcon();
  renderMDList({ 
    genre: currentGenreFilter, 
    type: currentTypeFilter, 
    record: currentRecordFilter 
  }, false);
}

// Met à jour l'icône du bouton selon le filtre actif
function updateFilterIcon() {
  const filterBtn = document.getElementById('filter-fab-btn');
  if (!filterBtn) return;

  if (currentRecordFilter === 'toRecord') {
    filterBtn.textContent = 'Rec';
    filterBtn.classList.add('active');
  } else if (currentRecordFilter === 'recorded') {
    filterBtn.textContent = 'Ok';
    filterBtn.classList.add('active');
  } else {
    filterBtn.textContent = 'All';
    filterBtn.classList.remove('active');
  }
}

function mdMatchesSearch(md, query) {
  if (!query) return true;
  const q = query.toLowerCase().trim();

  if (md.title && md.title.toLowerCase().includes(q)) return true;
  if (md.artist && md.artist.toLowerCase().includes(q)) return true;

  const genres = getMDAllGenres(md);
  if (genres.some(g => g.toLowerCase().includes(q))) return true;

  const types = getMDAllTypes(md);
  if (types.some(t => t.toLowerCase().includes(q))) return true;

  if (md.tracks && md.tracks.some(t => t.toLowerCase().includes(q))) return true;

  if (md.albums && md.albums.length > 0) {
    for (const album of md.albums) {
      if (album.title && album.title.toLowerCase().includes(q)) return true;
      if (album.artist && album.artist.toLowerCase().includes(q)) return true;
      if (album.year && String(album.year).includes(q)) return true;
      if (album.tracks && album.tracks.some(t => t.toLowerCase().includes(q))) return true;
    }
  }

  return false;
}

function onSearchInput(value) {
  currentSearchQuery = value;
  renderMDList({ genre: currentGenreFilter, type: currentTypeFilter }, false);
}

function updateSearchVisibility(show) {
  const floatingActions = document.getElementById('floating-actions');
  const topSearch = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  const fabBtn = document.getElementById('btn-search');

  if (show) {
    if (floatingActions) floatingActions.classList.remove('hidden');
    if (typeof updateFilterIcon === 'function') {
      updateFilterIcon();
    }
  } else {
    if (floatingActions) floatingActions.classList.add('hidden');
    if (fabBtn) fabBtn.textContent = '| Search';
    if (topSearch) topSearch.classList.add('closed');

    currentSearchQuery = '';
    if (searchInput) searchInput.value = '';
  }
}

// Sécurité : attachement automatique de l'événement au bouton de filtre si non présent dans le HTML
document.addEventListener('DOMContentLoaded', () => {
  const filterBtn = document.getElementById('filter-fab-btn');
  if (filterBtn && !filterBtn.onclick) {
    filterBtn.addEventListener('click', cycleRecordFilter);
  }
});

/* ==========================================
   UTILITAIRE TOAST
   ========================================== */
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.remove('hidden');

  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

/* ==========================================
   UTILITAIRES MULTI-GENRE & MULTI-TYPE
   ========================================== */
function getNormalizedList(data) {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.map(v => String(v).toUpperCase().trim()).filter(v => v !== '');
  }
  return String(data).split(',').map(v => v.toUpperCase().trim()).filter(v => v !== '');
}

function getNormalizedGenres(genreData) {
  return getNormalizedList(genreData);
}

function getMDAllGenres(md) {
  const genresSet = new Set(getNormalizedGenres(md.genre));
  if (md.albums && md.albums.length > 0) {
    md.albums.forEach(album => {
      getNormalizedGenres(album.genre).forEach(g => genresSet.add(g));
    });
  }
  const result = Array.from(genresSet);
  return result.length > 0 ? result : ['AUTRE'];
}

function getAlbumGenres(album, parentMd) {
  const albumGenres = getNormalizedGenres(album.genre);
  if (albumGenres.length > 0) return albumGenres;
  const parentGenres = getNormalizedGenres(parentMd ? parentMd.genre : null);
  return parentGenres.length > 0 ? parentGenres : ['AUTRE'];
}

function getNormalizedTypes(typeData) {
  return getNormalizedList(typeData);
}

function getMDAllTypes(md) {
  const typesSet = new Set(getNormalizedTypes(md.type));
  if (md.albums && md.albums.length > 0) {
    md.albums.forEach(album => {
      getNormalizedTypes(album.type).forEach(t => typesSet.add(t));
    });
  }
  const result = Array.from(typesSet);
  return result.length > 0 ? result : ['ALBUM'];
}

/* ==========================================
   UTILITAIRES D'ALÉATOIRE FIXÉ SUR 24 HEURES
   ========================================== */
function getDailySeed() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function dailyShuffle(array, extraSeedKey = '') {
  const copy = [...array];
  const seedString = getDailySeed() + extraSeedKey;
  let hash = cyrb53(seedString);

  function seededRandom() {
    hash = (hash * 9301 + 49297) % 233280;
    return hash / 233280;
  }

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

/* ==========================================
   GESTION STRICTE DE L'HISTORIQUE
   ========================================== */
if (!window.location.hash || window.location.hash === '#') {
  window.history.replaceState({ view: 'dashboard' }, '', '#dashboard');
}

/* ==========================================
   INITIALISATION DATA & ÉCOUTEURS GLOBAUX
   ========================================== */

// Gestion du bouton Retour
if (backBtn) {
  backBtn.addEventListener('click', () => {
    if (currentAlbum !== null) {
      // Si on est dans le détail d'un album, retour au MiniDisc parent
      if (currentMD !== null) {
        window.location.hash = `#md-${currentMD}`;
      } else {
        window.location.hash = '#minidiscs';
      }
    } else if (currentMD !== null) {
      // Si on est dans le détail d'un MiniDisc, retour à la liste
      window.location.hash = '#minidiscs';
    } else {
      // Sinon, retour au Dashboard
      window.location.hash = '#dashboard';
    }
  });
}

// Interception des soumissions de formulaires (évite le rechargement de page)
const adminForm = document.getElementById('admin-form');
if (adminForm) {
  adminForm.addEventListener('submit', submitNewMD);
}

const ideaForm = document.getElementById('idea-form');
if (ideaForm) {
  ideaForm.addEventListener('submit', saveIdeaAlbum);
}

function processLoadedData(data) {
  if (data && typeof data === 'object' && !Array.isArray(data) && data.minidiscs) {
    catalogData = data.minidiscs || [];
    window.ideaAlbums = data.ideaAlbums || [];
  } else if (Array.isArray(data)) {
    catalogData = data;
    if (!window.ideaAlbums) window.ideaAlbums = [];
  } else {
    catalogData = [];
    if (!window.ideaAlbums) window.ideaAlbums = [];
  }

  // Remplissage dynamique des menus déroulants une fois catalogData chargé
  populateFormDatalists();
}

// Fonction globale pour appliquer la vue selon l'URL (hash)
function handleRoute() {
  const hash = window.location.hash;
  if (hash.startsWith('#planner')) {
    if (typeof renderCompilPlanner === 'function') {
      renderCompilPlanner(false);
    }
  } else if (hash.startsWith('#minidiscs')) {
    const urlParams = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
    const genre = urlParams.get('genre');
    const type = urlParams.get('type');
    if (typeof renderMDList === 'function') {
      renderMDList({ genre, type }, false);
    }
  } else if (hash.startsWith('#md-')) {
    const mdIndex = parseInt(hash.replace('#md-', ''), 10);
    if (!isNaN(mdIndex) && catalogData[mdIndex] && typeof openMD === 'function') {
      openMD(mdIndex, false);
    } else if (typeof renderDashboard === 'function') {
      renderDashboard(false);
    }
  } else {
    if (typeof renderDashboard === 'function') {
      renderDashboard(false);
    }
  }
}

// Écouteur pour réagir aux clics sur les ancres / boutons de navigation
window.addEventListener('hashchange', handleRoute);

fetch('data.json')
  .then(response => {
    if (!response.ok) throw new Error("Erreur de réseau lors du chargement du fichier JSON.");
    return response.json();
  })
  .then(data => {
    const savedBackup = localStorage.getItem(STORAGE_KEY);
    
    if (savedBackup) {
      try {
        const parsedBackup = JSON.parse(savedBackup);
        processLoadedData(parsedBackup);
        hasUnsavedChanges = true;
        setTimeout(() => showToast("⚡ Session restaurée : modifications non exportées !"), 500);
      } catch (e) {
        processLoadedData(data);
      }
    } else {
      processLoadedData(data);
    }

    // Déclenche l'affichage initial de la vue
    handleRoute();
  })
  .catch(err => {
    const savedBackup = localStorage.getItem(STORAGE_KEY);
    if (savedBackup) {
      try {
        const parsedBackup = JSON.parse(savedBackup);
        processLoadedData(parsedBackup);
        hasUnsavedChanges = true;
        showToast("⚡ Données chargées depuis la sauvegarde locale !");
        handleRoute();
        return;
      } catch (e) {}
    }

    catalogData = [];
    window.ideaAlbums = [];
    app.innerHTML = `
      <div style="text-align:center; padding: 40px; color: var(--text-sub);">
        <p style="color: #e63946; font-weight: bold; font-size: 1.1rem;">⚠️ Erreur de chargement de data.json</p>
      </div>
    `;
    console.error(err);
  });

/* ==========================================
   COULEURS DYNAMIQUES PAR GENRE
   ========================================== */
const genreColorPalette = [
  '#e63946', '#ff007f', '#00f0ff', '#ffb703', 
  '#7b2cbf', '#70e000', '#ff70a6', '#3a86ef', 
  '#ff9770', '#06d6a0'
];
const genreColorMap = {};

function getBorderColor(genreData) {
  const genres = getNormalizedGenres(genreData);
  const primaryGenre = genres[0] || 'AUTRE';

  if (genreColorMap[primaryGenre]) {
    return genreColorMap[primaryGenre];
  }

  const assignedCount = Object.keys(genreColorMap).length;
  const color = genreColorPalette[assignedCount % genreColorPalette.length];
  genreColorMap[primaryGenre] = color;
  
  return color;
}

/* ==========================================
   SÉLECTION DU JOUR (24H)
   ========================================== */
function renderFeatured() {
  if (!catalogData || catalogData.length === 0) return;
  const featuredGrid = document.getElementById('featured-grid');
  if (!featuredGrid) return;

  const shuffled = dailyShuffle(catalogData, '-featured');
  const selected = shuffled.slice(0, 3);

  let html = '';
  selected.forEach(md => {
    const originalIndex = catalogData.indexOf(md);
    html += `
      <div class="featured-item" onclick="openMD(${originalIndex})">
        <img class="featured-thumb" src="${md.md_cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'48\\' height=\\'68\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23e5e7eb\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'20\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>💽</text></svg>'">
      </div>
    `;
  });
  featuredGrid.innerHTML = html;
}

/* ==========================================
   VUES DE L'APPLICATION
   ========================================== */

/* 1. DASHBOARD */
function renderDashboard(pushState = true) {
  const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
  if (fa) fa.style.display = 'none';
   
  if (typeof clearPlannerHeaderInfo === 'function') clearPlannerHeaderInfo();

  currentMD = null;
  currentAlbum = null;
  currentGenreFilters.clear(); // Réinitialise les filtres multiples à l'arrivée sur le dashboard
  currentTypeFilter = null;
  if (backBtn) backBtn.classList.add('hidden');
  if (headerTitle) headerTitle.textContent = "MINIDISCS";

  if (typeof updateSearchVisibility === 'function') {
    updateSearchVisibility(false);
  }

  // Vérification et normalisation des données de la collection
  const sourceData = (catalogData && Array.isArray(catalogData.minidiscs))
    ? catalogData.minidiscs
    : (Array.isArray(catalogData) ? catalogData : (Array.isArray(window.mdData) ? window.mdData : []));

  if (!sourceData || sourceData.length === 0) {
    app.innerHTML = `<p style="text-align:center; padding: 40px; color: var(--text-sub, #aaa);">Chargement de la collection...</p>`;
    return;
  }

  if (featuredContainer) featuredContainer.classList.add('hidden');

  if (pushState && window.location.hash !== '#dashboard') {
    history.pushState({ view: 'dashboard' }, '', '#dashboard');
  }

  const totalMD = sourceData.length;
  const genreCounts = {};
  const typeCounts = {};

  // Extraction sécurisée des types et genres
  sourceData.forEach(md => {
    const genres = typeof getMDAllGenres === 'function' 
      ? getMDAllGenres(md) 
      : (md.genre ? (Array.isArray(md.genre) ? md.genre : md.genre.split(',')) : []);

    const types = typeof getMDAllTypes === 'function' 
      ? getMDAllTypes(md) 
      : (md.typeTags || md.type ? (Array.isArray(md.typeTags || md.type) ? (md.typeTags || md.type) : (md.typeTags || md.type).split(',')) : []);

    genres.forEach(g => {
      const cleanG = g.trim().toUpperCase();
      if (cleanG) genreCounts[cleanG] = (genreCounts[cleanG] || 0) + 1;
    });

    types.forEach(t => {
      const cleanT = t.trim().toUpperCase();
      if (cleanT) typeCounts[cleanT] = (typeCounts[cleanT] || 0) + 1;
    });
  });

  let typeBadgesHTML = '';
  Object.keys(typeCounts).sort((a,b) => typeCounts[b] - typeCounts[a]).forEach(t => {
    const safeType = t.replace(/'/g, "\\'");
    typeBadgesHTML += `
      <div class="genre-badge" style="border-left-color: #ff007f;" onclick="window.location.hash = '#minidiscs?type=${safeType}'">
        <span class="genre-name" style="color:#ff007f">${t}</span>
        <span class="genre-count">${typeCounts[t]}</span>
      </div>
    `;
  });

  let genreBadgesHTML = '';
  Object.keys(genreCounts).sort((a,b) => genreCounts[b] - genreCounts[a]).forEach(g => {
    const color = typeof getBorderColor === 'function' ? getBorderColor(g) : '#00f0ff';
    const safeGenre = g.replace(/'/g, "\\'");
    genreBadgesHTML += `
      <div class="genre-badge" style="border-left-color: ${color};" onclick="window.location.hash = '#minidiscs?genre=${safeGenre}'">
        <span class="genre-name" style="color:${color}">${g}</span>
        <span class="genre-count">${genreCounts[g]}</span>
      </div>
    `;
  });

  const jsonBtnStyle = hasUnsavedChanges 
    ? 'background-color: #e63946; color: #fff;' 
    : 'background-color: #06d6a0; color: #000;';

  app.innerHTML = `
    <div class="dashboard-container" style="padding-top: 20px; padding-bottom: 90px;">
      
      <div class="dashboard-card" style="margin-bottom: 36px;">
        <div class="dashboard-stat-main" style="padding: 4px 0 8px 0;">
         <span class="stat-label" style="font-size: 0.75rem;">Collections de</span>
         <span class="stat-number" style="font-size: 1.2rem; line-height: 1;">${totalMD}</span>
         <span class="stat-label" style="font-size: 0.75rem;">MiniDiscs</span>
        </div>
        <div class="genres-grid">${typeBadgesHTML}</div>
      </div>

      <div class="featured-container-inline">
        <div class="featured-header">
          <div class="featured-title">SÉLECTION DU JOUR</div>
        </div>
        <div class="featured-grid" id="featured-grid-inline"></div>
      </div>

      <div class="dashboard-card" style="margin-top: 16px;">
        <div class="dashboard-section-title">MINIDISCS PAR GENRES</div>
        <div class="genres-grid">${genreBadgesHTML}</div>
      </div>

      <button class="btn-primary" style="margin-top: 16px; margin-bottom: 8px; width: 100%;" onclick="window.location.hash = '#minidiscs'">
        VOIR TOUS LES MINIDISCS &rarr;
      </button>

      <div class="dashboard-actions-row">
        <button class="action-btn-wide" onclick="window.location.hash = '#planner'">
          Créer une compilation
        </button>
        <button class="action-btn-wide" onclick="openAdminModal()">
          ＋ Ajouter un MD
        </button>
        <button class="action-btn-json" style="${jsonBtnStyle}" onclick="event.preventDefault(); downloadUpdatedJSON();" title="Télécharger data.json">
          💾 JSON
        </button>
      </div>
    </div>
  `;

  if (typeof renderFeatured === 'function') renderFeatured();

  const oldGrid = document.querySelector('.featured-grid:not(#featured-grid-inline)') || document.getElementById('featured-grid');
  const newGrid = document.getElementById('featured-grid-inline');
  if (oldGrid && newGrid) {
    newGrid.innerHTML = oldGrid.innerHTML;
  }

  window.scrollTo(0, 0);
}

/* 2. LISTE DES MINIDISCS */
function renderMDList(filters = {}, pushState = true) {
  if (catalogData === null) return;

  // 1. Afficher la barre d'actions UNIQUEMENT sur la liste
  const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
  if (fa) fa.style.display = 'flex';

  const { genre = currentGenreFilter, type = currentTypeFilter, record = currentRecordFilter } = filters;

  if (pushState) {
    window.location.hash = '#md-list';
  }
  
  currentMD = null;
  currentAlbum = null;
  currentGenreFilter = genre;
  currentTypeFilter = type;
  currentRecordFilter = record;

  if (backBtn) backBtn.classList.remove('hidden');

  updateSearchVisibility(true);
  if (headerTitle) headerTitle.textContent = "MINIDISCS";
  if (featuredContainer) featuredContainer.classList.add('hidden');

  let filteredCatalog = catalogData.map((md, originalIndex) => ({ md, originalIndex }));
  
  if (genre) {
    filteredCatalog = filteredCatalog.filter(({ md }) => getMDAllGenres(md).includes(genre.toUpperCase().trim()));
  }
  if (type) {
    filteredCatalog = filteredCatalog.filter(({ md }) => getMDAllTypes(md).includes(type.toUpperCase().trim()));
  }

  // Application du filtre de statut
  if (record === 'toRecord') {
    filteredCatalog = filteredCatalog.filter(({ md }) => 
      md.toRecord || (md.albums && md.albums.some(a => a.toRecord))
    );
  } else if (record === 'recorded') {
    filteredCatalog = filteredCatalog.filter(({ md }) => {
      const isToRecord = md.toRecord || (md.albums && md.albums.some(a => a.toRecord));
      return !isToRecord;
    });
  }

  if (currentSearchQuery) {
    filteredCatalog = filteredCatalog.filter(({ md }) => mdMatchesSearch(md, currentSearchQuery));
  }

  const seedSuffix = genre ? `-genre-${genre}` : (type ? `-type-${type}` : '-all');
  const shuffledCatalog = dailyShuffle(filteredCatalog, seedSuffix);

  // 2. Génération du HTML pur de la liste (sans reinjecter de barre flottante)
  let html = '<div class="list-container">';
  
  if (shuffledCatalog.length === 0) {
    html += `<p style="text-align:center; padding: 40px; color: var(--text-sub);">Aucun MiniDisc trouvé.</p>`;
  } else {
    shuffledCatalog.forEach(({ md, originalIndex }) => {
      const allGenres = getMDAllGenres(md);
      const borderColor = getBorderColor(allGenres);
      
      let albumsContent = '';
      if (md.albums && md.albums.length > 0) {
        albumsContent = md.albums.map(album => `
          <div class="md-album-item">
            <div class="md-album-title">${album.title || ''}</div>
            <div class="md-album-artist">${album.artist || ''}</div>
          </div>
        `).join('');
      } else {
        albumsContent = `
          <div class="md-album-item">
            <div class="md-album-title">${md.title || 'MiniDisc sans titre'}</div>
            <div class="md-album-artist">${md.artist || ''}</div>
          </div>
        `;
      }

      const isToRecord = md.toRecord || (md.albums && md.albums.some(a => a.toRecord));
      const recordBadgeHTML = isToRecord 
        ? `<span class="badge-to-record badge-record-corner">💽 À enregistrer</span>` 
        : '';

      const defaultCover = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='48' height='68'><rect width='100%' height='100%' fill='%23e5e7eb'/><text x='50%' y='50%' font-size='20' text-anchor='middle' dominant-baseline='central'>💽</text></svg>";

      html += `
        <div class="list-item" style="border-color: ${borderColor}; border-left-width: 6px; position: relative;" onclick="openMD(${originalIndex})">
          <img class="md-thumb" src="${md.md_cover || ''}" onerror="this.src='${defaultCover}'">
          <div class="item-details">
            <div class="item-tag" style="color: ${borderColor};">${allGenres.join(' / ')}</div>
            <div class="md-albums-list">${albumsContent}</div>
          </div>
          ${recordBadgeHTML}
        </div>
      `;
    });
  }
  html += '</div>';
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/* 3. VUE D'UN MINIDISC */
function openMD(index, pushState = true) {
  const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
  if (fa) fa.style.display = 'none';
   
  if (!catalogData || !catalogData[index]) return;

  if (pushState) {
    history.pushState({ view: 'album', mdIndex: index }, '', `#md-${index}`);
  }

  currentMD = catalogData[index];
  currentAlbum = null;
  if (backBtn) backBtn.classList.remove('hidden');
  updateSearchVisibility(false);
  if (featuredContainer) featuredContainer.classList.add('hidden');

  const md = catalogData[index];
  const allMdGenres = getMDAllGenres(md);
  const borderColor = getBorderColor(allMdGenres);

  const adminControls = `
    <div class="md-admin-controls">
      <button class="btn-edit" onclick="event.stopPropagation(); openAdminModal(${index})">✏️ Modifier</button>
      <button class="btn-delete" onclick="event.stopPropagation(); deleteMD(${index})">🗑️ Supprimer</button>
    </div>
  `;

  // CAS 1 : MINIDISC SIMPLE / COMPILATION (SANS ALBUMS)
  if (!md.albums || md.albums.length === 0) {
    if (headerTitle) headerTitle.textContent = "TITRES";

    let tracksHTML = '';
    if (md.tracks && md.tracks.length > 0) {
      md.tracks.forEach((track) => {
        const match = track.match(/^(\d+\.)\s*(.*)$/);
        tracksHTML += match 
          ? `<li class="track-item"><strong class="track-num">${match[1]}</strong> ${match[2]}</li>`
          : `<li class="track-item">${track}</li>`;
      });
    } else {
      tracksHTML = `<li class="track-item">Aucune piste disponible.</li>`;
    }

    const badgeCompilHTML = md.toRecord 
      ? `<div class="badge-to-record-header">💽 À ENREGISTRER</div>` 
      : '';

    app.innerHTML = `
      <div class="track-container">
        ${adminControls}
        <div class="album-header">
          <img class="album-cover-large" src="${md.md_cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'150\\' height=\\'150\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'36\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>💽</text></svg>'">
          <div>
            ${badgeCompilHTML}
            <h2 style="font-size: 1.2rem; font-weight: 800;">${md.title || 'Compilation'}</h2>
            <p style="color: var(--text-sub); font-size: 0.95rem;">${md.artist || 'Artistes divers'}</p>
            <p style="color: ${borderColor}; font-size: 0.8rem; font-weight: 800;">${allMdGenres.join(' / ')}</p>
          </div>
        </div>
        <ul class="track-list">${tracksHTML}</ul>
      </div>
    `;
    window.scrollTo(0, 0);
    return;
  }

  // CAS 2 : SÉRIE D'ALBUMS
  if (headerTitle) headerTitle.textContent = "ALBUMS";

  let html = `<div class="list-container">${adminControls}`;
  md.albums.forEach((album, aIndex) => {
    const albumGenres = getAlbumGenres(album, md);
    const albumColor = getBorderColor(albumGenres);
    
    const badgeAlbumHTML = album.toRecord 
      ? `<span class="badge-to-record badge-record-corner">💽 À enregistrer</span>` 
      : '';

    html += `
      <div class="list-item" style="border-color: ${albumColor}; border-left-width: 6px; position: relative;" onclick="openAlbum(${index}, ${aIndex})">
        <div class="album-cover-container" style="margin-right: 15px; display: inline-block;">
          <img class="album-thumb" style="margin-right: 0;" src="${album.cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'100\\' height=\\'100\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'24\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>🎵</text></svg>'">
        </div>
        <div class="item-details">
          <div class="item-tag" style="color: ${albumColor};">${albumGenres.join(' / ')}</div>
          <div class="item-title" style="font-weight: 700;">${album.title || 'Album sans titre'}</div>
          <div class="item-sub">${album.artist || 'Artiste inconnu'}</div>
          ${album.year ? `<div class="item-sub" style="font-size:0.78rem;">${album.year}</div>` : ''}
        </div>
        ${badgeAlbumHTML}
      </div>
    `;
  });
  html += '</div>';
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/* 4. VUE TRACKLIST ALBUM SPÉCIFIQUE */
function openAlbum(mdIndex, albumIndex, pushState = true) {
  const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
  if (fa) fa.style.display = 'none';
   
  if (!catalogData || !catalogData[mdIndex] || !catalogData[mdIndex].albums[albumIndex]) return;

  currentMD = mdIndex;
  currentAlbum = albumIndex;
  if (backBtn) backBtn.classList.remove('hidden');

  updateSearchVisibility(false);
  if (featuredContainer) featuredContainer.classList.add('hidden');

  const md = catalogData[mdIndex];
  const album = md.albums[albumIndex];
  const albumGenres = getAlbumGenres(album, md);
  const albumColor = getBorderColor(albumGenres);

  if (headerTitle) headerTitle.textContent = "TITRES";
  if (pushState) history.pushState({ view: 'tracklist', mdIndex, albumIndex }, '', `#md-${mdIndex}-album-${albumIndex}`);

  let tracksHTML = '';
  if (album.tracks && album.tracks.length > 0) {
    album.tracks.forEach((track) => {
      const match = track.match(/^(\d+\.)\s*(.*)$/);
      tracksHTML += match 
        ? `<li class="track-item"><strong class="track-num">${match[1]}</strong> ${match[2]}</li>`
        : `<li class="track-item">${track}</li>`;
    });
  } else {
    tracksHTML = `<li class="track-item">Aucune piste disponible.</li>`;
  }

  const badgeAlbumHTML = album.toRecord 
    ? `<div class="badge-to-record-header">💽 À ENREGISTRER</div>` 
    : '';

  app.innerHTML = `
    <div class="track-container">
      <div class="album-header">
        <img class="album-cover-large" src="${album.cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'150\\' height=\\'150\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'36\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>🎵</text></svg>'">
        <div>
          ${badgeAlbumHTML}
          <h2 style="font-size: 1.2rem; font-weight: 800;">${album.title || 'Album sans titre'}</h2>
          <p style="color: var(--text-sub); font-size: 0.95rem;">${album.artist || 'Artiste inconnu'}</p>
          <p style="color: ${albumColor}; font-size: 0.8rem; font-weight: 800;">${albumGenres.join(' / ')}</p>
          ${album.year ? `<p style="color: var(--text-sub); font-size: 0.8rem;">${album.year}</p>` : ''}
        </div>
      </div>
      <ul class="track-list">${tracksHTML}</ul>
    </div>
  `;
  window.scrollTo(0, 0);
}

/* ==========================================
   SUPPRESSION ET MODIFICATION
   ========================================== */
function deleteMD(index) {
  if (!catalogData || !catalogData[index]) return;
  
  const md = catalogData[index];
  const title = md.title || (md.albums ? md.albums.map(a => a.title).join(' / ') : 'ce MiniDisc');
  
  if (confirm(`Voulez-vous vraiment supprimer définitivement "${title}" ?`)) {
    catalogData.splice(index, 1);
    saveLocalBackup();
    showToast("🗑️ MiniDisc supprimé ! Pensez à exporter votre JSON.");
    renderDashboard(true);
  }
}

/* ==========================================
   GESTION DE LA MODALE ADMIN
   ========================================== */
function openAdminModal(indexToEdit = null) {
  // Rafraîchir les listes de suggestions (genres / types)
  populateFormDatalists();

  editingMDIndex = indexToEdit;
  const modalTitle = document.querySelector('#admin-modal h3');
  const albumsContainer = document.getElementById('albums-container');
  if (albumsContainer) albumsContainer.innerHTML = '';
  adminAlbumCount = 0;

  if (editingMDIndex !== null) {
    // ==========================================
    // MODE ÉDITION
    // ==========================================
    const md = catalogData[editingMDIndex];
    if (modalTitle) modalTitle.textContent = "✏️ Modifier le MiniDisc";

    document.getElementById('md-genre').value = Array.isArray(md.genre) ? md.genre.join(', ') : (md.genre || '');
    if (document.getElementById('md-type-tags')) {
      document.getElementById('md-type-tags').value = Array.isArray(md.type) ? md.type.join(', ') : (md.type || '');
    }
    document.getElementById('md-cover').value = md.md_cover || 'images/';

    const isCompil = !md.albums || md.albums.length === 0;
    
    const radioCompil = document.querySelector('input[name="md-type"][value="compil"]');
    const radioAlbums = document.querySelector('input[name="md-type"][value="albums"]') || document.querySelector('input[name="md-type"][value="album"]');
    
    if (isCompil && radioCompil) radioCompil.checked = true;
    if (!isCompil && radioAlbums) radioAlbums.checked = true;

    toggleAdminType(true);

    if (isCompil) {
      document.getElementById('compil-title').value = md.title || '';
      document.getElementById('compil-artist').value = md.artist || '';
      document.getElementById('compil-tracks').value = md.tracks ? md.tracks.map(t => t.replace(/^\d+\.\s*/, '')).join('\n') : '';
      if (document.getElementById('compil-to-record')) {
        document.getElementById('compil-to-record').checked = !!md.toRecord;
      }
    } else {
      md.albums.forEach(album => {
        addAdminAlbumBlock();
        const block = albumsContainer.lastElementChild;
        block.querySelector('.album-title').value = album.title || '';
        block.querySelector('.album-artist').value = album.artist || '';
        if (block.querySelector('.album-type')) block.querySelector('.album-type').value = Array.isArray(album.type) ? album.type.join(', ') : (album.type || '');
        block.querySelector('.album-genre').value = Array.isArray(album.genre) ? album.genre.join(', ') : (album.genre || '');
        block.querySelector('.album-year').value = album.year || '';
        block.querySelector('.album-cover').value = album.cover || 'images/';
        block.querySelector('.album-tracks').value = album.tracks ? album.tracks.map(t => t.replace(/^\d+\.\s*/, '')).join('\n') : '';
        if (block.querySelector('.album-to-record')) {
          block.querySelector('.album-to-record').checked = !!album.toRecord;
        }
      });
    }

  } else {
    // ==========================================
    // MODE AJOUT (RÉINITIALISATION COMPLÈTE)
    // ==========================================
    if (modalTitle) modalTitle.textContent = "＋ Ajouter un MiniDisc";
    
    // Remise à zéro du formulaire HTML (admin-form)
    const form = document.getElementById('admin-form');
    if (form) form.reset();

    // Réinitialisation des champs spécifiques
    if (document.getElementById('md-genre')) document.getElementById('md-genre').value = '';
    if (document.getElementById('md-type-tags')) document.getElementById('md-type-tags').value = '';
    if (document.getElementById('md-cover')) document.getElementById('md-cover').value = "images/";
    
    if (document.getElementById('compil-title')) document.getElementById('compil-title').value = '';
    if (document.getElementById('compil-artist')) document.getElementById('compil-artist').value = '';
    if (document.getElementById('compil-tracks')) document.getElementById('compil-tracks').value = '';
    
    if (document.getElementById('compil-to-record')) {
      document.getElementById('compil-to-record').checked = false;
    }

    // Cocher l'option compilation par défaut et basculer l'affichage
    const radioCompil = document.querySelector('input[name="md-type"][value="compil"]');
    if (radioCompil) radioCompil.checked = true;
    
    toggleAdminType(false);
  }

  // Affichage de la modale
  const modal = document.getElementById('admin-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeAdminModal() {
  const modal = document.getElementById('admin-modal');
  if (modal) modal.classList.add('hidden');
  editingMDIndex = null;
}

function toggleAdminType(isInit = false) {
  const checkedRadio = document.querySelector('input[name="md-type"]:checked');
  const isCompil = checkedRadio ? checkedRadio.value === 'compil' : true;
  
  const secCompil = document.getElementById('section-compil');
  const secAlbums = document.getElementById('section-albums');

  if (secCompil) secCompil.classList.toggle('hidden', !isCompil);
  if (secAlbums) secAlbums.classList.toggle('hidden', isCompil);

  const albumsContainer = document.getElementById('albums-container');
  if (!isCompil && !isInit && albumsContainer && albumsContainer.children.length === 0) {
    addAdminAlbumBlock();
  }
}

function addAdminAlbumBlock() {
  adminAlbumCount++;
  const container = document.getElementById('albums-container');
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'album-block';
  div.style.cssText = "border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; border-radius: 6px; position: relative;";
  div.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <h4 style="margin: 0;">Album</h4>
      <button type="button" onclick="removeAdminAlbumBlock(this)" style="background: #e63946; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">🗑️ Supprimer l'album</button>
    </div>
    <div class="form-group"><input type="text" class="album-title" placeholder="Titre de l'album" required></div>
    <div class="form-group"><input type="text" class="album-artist" placeholder="Artiste" required></div>
    <div class="form-group"><input type="text" class="album-type" placeholder="Type(s) de l'album (ex: Album, Live)"></div>
    <div class="form-group"><input type="text" class="album-genre" placeholder="Genre(s) de l'album (séparés par virgule)"></div>
    <div class="form-group"><input type="text" class="album-year" placeholder="Année (ex: 1998)"></div>
    <div class="form-group"><input type="text" class="album-cover" value="images/" placeholder="URL Pochette Album"></div>
    <div class="form-group"><textarea class="album-tracks" placeholder="Pistes de cet album (une par ligne)"></textarea></div>
    <div class="form-group" style="margin-top: 8px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold; font-size: 0.85rem;">
        <input type="checkbox" class="album-to-record" style="width: 16px; height: 16px;">
        🎙️ À enregistrer
      </label>
    </div>
  `;
  container.appendChild(div);
}

function removeAdminAlbumBlock(button) {
  const block = button.closest('.album-block');
  if (block) block.remove();
}

function submitNewMD(e) {
  if (e) e.preventDefault();

  if (catalogData === null) return;

  const rawGenreInput = document.getElementById('md-genre').value.trim();
  const rawTypeInput = document.getElementById('md-type-tags') ? document.getElementById('md-type-tags').value.trim() : '';
  const mdCover = document.getElementById('md-cover').value.trim();
  const checkedRadio = document.querySelector('input[name="md-type"]:checked');
  const typeFormat = checkedRadio ? checkedRadio.value : 'compil';

  if (!rawGenreInput) {
    showToast("⚠️ Veuillez renseigner au moins un genre");
    return;
  }

  const parsedMDGenres = rawGenreInput.includes(',') 
    ? rawGenreInput.split(',').map(g => g.trim()).filter(g => g !== '')
    : [rawGenreInput];

  const parsedMDTypes = rawTypeInput 
    ? (rawTypeInput.includes(',') ? rawTypeInput.split(',').map(t => t.trim()).filter(t => t !== '') : [rawTypeInput])
    : ['ALBUM'];

  let globalTrackCounter = 1;
  const targetMD = { genre: parsedMDGenres, type: parsedMDTypes, md_cover: mdCover };

  if (typeFormat === 'compil') {
    targetMD.title = document.getElementById('compil-title').value.trim();
    targetMD.artist = document.getElementById('compil-artist').value.trim();
    
    const rawTracks = document.getElementById('compil-tracks').value.split('\n');
    targetMD.tracks = rawTracks
      .filter(t => t.trim() !== '')
      .map(t => `${String(globalTrackCounter++).padStart(2, '0')}. ${t.trim()}`);

    const compilCheckbox = document.getElementById('compil-to-record');
    targetMD.toRecord = compilCheckbox ? compilCheckbox.checked : false;
  } else {
    targetMD.albums = [];
    const albumBlocks = document.querySelectorAll('.album-block');
    
    if (albumBlocks.length === 0) {
      showToast("⚠️ Veuillez ajouter au moins un album.");
      return;
    }

    albumBlocks.forEach(block => {
      const rawTracks = block.querySelector('.album-tracks').value.split('\n');
      const formattedTracks = rawTracks
        .filter(t => t.trim() !== '')
        .map(t => `${String(globalTrackCounter++).padStart(2, '0')}. ${t.trim()}`);

      const rawAlbumGenre = block.querySelector('.album-genre').value.trim();
      const parsedAlbumGenres = rawAlbumGenre 
        ? (rawAlbumGenre.includes(',') ? rawAlbumGenre.split(',').map(g => g.trim()).filter(g => g !== '') : [rawAlbumGenre])
        : [];

      const rawAlbumType = block.querySelector('.album-type') ? block.querySelector('.album-type').value.trim() : '';
      const parsedAlbumTypes = rawAlbumType 
        ? (rawAlbumType.includes(',') ? rawAlbumType.split(',').map(t => t.trim()).filter(t => t !== '') : [rawAlbumType])
        : [];

      const albumObj = {
        title: block.querySelector('.album-title').value.trim(),
        artist: block.querySelector('.album-artist').value.trim(),
        year: block.querySelector('.album-year').value.trim(),
        cover: block.querySelector('.album-cover').value.trim(),
        tracks: formattedTracks,
        toRecord: block.querySelector('.album-to-record') ? block.querySelector('.album-to-record').checked : false
      };

      if (parsedAlbumGenres.length > 0) albumObj.genre = parsedAlbumGenres;
      if (parsedAlbumTypes.length > 0) albumObj.type = parsedAlbumTypes;

      targetMD.albums.push(albumObj);
    });
  }

  if (editingMDIndex !== null) {
    catalogData[editingMDIndex] = targetMD;
    showToast("✅ MiniDisc modifié ! Pensez à exporter votre JSON.");
  } else {
    catalogData.push(targetMD);
    showToast("✅ MiniDisc ajouté ! Pensez à exporter votre JSON.");
  }

  saveLocalBackup();
  closeAdminModal();
  renderDashboard(false);
}

function downloadUpdatedJSON() {
  if ((!catalogData || catalogData.length === 0) && (!window.ideaAlbums || window.ideaAlbums.length === 0)) {
    showToast("⚠️ Le catalogue est vide !");
    return;
  }

  const exportPayload = {
    minidiscs: catalogData || [],
    ideaAlbums: window.ideaAlbums || []
  };

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = url;
  downloadAnchor.download = "data.json";
  
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  document.body.removeChild(downloadAnchor);

  setTimeout(() => URL.revokeObjectURL(url), 100);
  
  clearLocalBackup();
  showToast("✅ Téléchargement réussi ! Sauvegarde réinitialisée.");
  renderDashboard(false);
}

/* ==========================================
   PLANIFICATEUR DE COMPILATION & IDÉES
   ========================================== */

function getIdeaList() {
  if (!catalogData) return [];
  if (!window.ideaAlbums) window.ideaAlbums = [];
  return window.ideaAlbums;
}

function parseTimeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.toString().trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    return parts[0] * 60;
  }
  return 0;
}

function formatSecondsToDisplay(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function updatePlannerHeader() {
  const durationTextEl = document.getElementById('planner-duration-text');
  const selectedListEl = document.getElementById('planner-selected-list');
  
  const ideas = getIdeaList();
  const maxSeconds = 148 * 60;
  let totalSeconds = 0;
  let selectedHTML = '';

  if (typeof selectedIdeaIndices === 'undefined') window.selectedIdeaIndices = new Set();

  selectedIdeaIndices.forEach(idx => {
    if (ideas[idx]) {
      const item = ideas[idx];
      totalSeconds += parseTimeToSeconds(item.duration);

      selectedHTML += `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; gap: 8px;">
          <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #000; font-weight: 600;">
            🎵 <span style="color: #666;">${item.artist || 'Artiste'}</span> - ${item.title || 'Titre'}
          </div>
          <div style="font-weight: 700; color: #000; white-space: nowrap;">⏱️ ${item.duration || '00:00'}</div>
        </div>
      `;
    }
  });

  if (selectedListEl) {
    if (selectedIdeaIndices.size > 0) {
      selectedListEl.innerHTML = selectedHTML;
      selectedListEl.style.display = 'block';
    } else {
      selectedListEl.innerHTML = '';
      selectedListEl.style.display = 'none';
    }
  }

  const formattedTime = formatSecondsToDisplay(totalSeconds);
  const isOverLimit = totalSeconds > maxSeconds;

  if (durationTextEl) {
    durationTextEl.style.color = isOverLimit ? '#e63946' : '#06d6a0';
    durationTextEl.textContent = `${formattedTime} / 2h 28m`;
  }

  const convertBtn = document.getElementById('planner-btn-convert');
  if (convertBtn) {
    convertBtn.disabled = selectedIdeaIndices.size === 0;
    convertBtn.textContent = `💾 Convertir (${selectedIdeaIndices.size})`;
  }

  const remainingSeconds = maxSeconds - totalSeconds;
  document.querySelectorAll('.idea-card').forEach(card => {
    const index = parseInt(card.getAttribute('data-index'), 10);
    const item = ideas[index];
    if (!item) return;

    const isSelected = selectedIdeaIndices.has(index);
    const itemSec = parseTimeToSeconds(item.duration);

    if (!isSelected && itemSec > remainingSeconds) {
      card.classList.add('disabled-card');
      card.style.opacity = '0.4';
    } else {
      card.classList.remove('disabled-card');
      card.style.opacity = '1';
    }
  });
}

function clearPlannerHeaderInfo() {
  const badge = document.getElementById('header-planner-badge');
  if (badge) badge.remove();

  const genreMenu = document.getElementById('planner-genre-menu');
  if (genreMenu) genreMenu.remove();

  if (typeof isPlannerGenreDropdownOpen !== 'undefined') {
    isPlannerGenreDropdownOpen = false;
  }
}

function injectPlannerHeaderBadge() {
  const header = document.querySelector('header') || document.querySelector('.header');
  if (!header) return;

  let badge = document.getElementById('header-planner-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'header-planner-badge';
    badge.style.cssText = `
      position: fixed;
      top: 150px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999;
      background: #ffffff;
      border: 2px solid #000000;
      border-radius: 16px;
      padding: 10px 16px;
      box-shadow: 4px 4px 0px #000000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: calc(100% - 32px);
      max-width: 568px;
      box-sizing: border-box;
    `;
    
    badge.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
        <span style="font-size: 0.85rem; font-weight: bold; color: #000000;">Durée sélectionnée :</span>
        <strong id="planner-duration-text" style="font-family: 'Righteous', cursive; font-size: 1.05rem; color: #06d6a0;">0m 00s / 2h 28m</strong>
      </div>
      <div id="planner-selected-list" style="display: none; border-top: 1.5px dashed #ccc; padding-top: 6px; max-height: 100px; overflow-y: auto; font-size: 0.78rem;"></div>
    `;

    header.after(badge);
  }
}

// Extraction propre des genres uniques d'un album ou d'une idée
function getItemGenresList(item) {
  if (typeof getMDAllGenres === 'function') {
    return getMDAllGenres(item);
  }
  if (!item || !item.genre) return [];
  if (Array.isArray(item.genre)) {
    return item.genre.map(g => String(g).trim().toUpperCase()).filter(Boolean);
  }
  return String(item.genre).split(',').map(g => g.trim().toUpperCase()).filter(Boolean);
}

/* RENDU DU PLANIFICATEUR AVEC CARTES ET BARRE D'ACTIONS FLOTTANTE */
function renderCompilPlanner(pushState = true) {
  if (typeof selectedIdeaIndices === 'undefined') window.selectedIdeaIndices = new Set();

  const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
  if (fa) {
    fa.style.display = 'flex';
    fa.classList.remove('hidden');
  }

  currentMD = null;
  currentAlbum = null;

  if (backBtn) backBtn.classList.remove('hidden');
  if (headerTitle) headerTitle.textContent = "PLANIFICATEUR";

  if (featuredContainer) featuredContainer.classList.add('hidden');

  if (pushState && window.location.hash !== '#planner') {
    history.pushState({ view: 'planner' }, '', '#planner');
  }

  if (typeof updateSearchVisibility === 'function') {
    updateSearchVisibility(false);
  }

  injectPlannerHeaderBadge();

  const rawIdeas = getIdeaList();

  // Filtrage par genre avec découpage des genres uniques
  const filteredIdeas = rawIdeas.map((item, originalIndex) => ({ ...item, originalIndex })).filter(item => {
    if (typeof currentPlannerGenreFilters !== 'undefined' && currentPlannerGenreFilters.size > 0) {
      const itemGenres = getItemGenresList(item);
      return Array.from(currentPlannerGenreFilters).some(g => itemGenres.includes(g));
    }
    return true;
  });

  const ideas = typeof dailyShuffle === 'function' ? dailyShuffle(filteredIdeas, '-planner') : filteredIdeas;

  let cardsHTML = '';
  if (rawIdeas.length === 0) {
    cardsHTML = `<p class="planner-text-white" style="text-align:center; grid-column: 1/-1; padding: 30px; color: var(--text-sub, #aaa);">Aucun album dans votre liste d'idées. Ajoutez-en avec le bouton ci-dessous !</p>`;
  } else if (ideas.length === 0) {
    cardsHTML = `<p class="planner-text-white" style="text-align:center; grid-column: 1/-1; padding: 30px; color: var(--text-sub, #aaa);">Aucun album ne correspond aux filtres sélectionnés.</p>`;
  } else {
    ideas.forEach((item) => {
      const index = item.originalIndex;
      const isSelected = selectedIdeaIndices.has(index);
      const coverSrc = (item.cover && item.cover !== 'images/') ? item.cover : '';

      cardsHTML += `
        <div class="idea-card ${isSelected ? 'selected' : ''}" data-index="${index}">
          ${coverSrc 
            ? `<img src="${coverSrc}" class="idea-cover" alt="cover" onerror="this.onerror=null; this.parentNode.innerHTML='<div class=\\'idea-cover\\' style=\\'background:#333; display:flex; align-items:center; justify-content:center; color:#aaa; font-size:0.8rem;\\'>Pas d\\'image</div>';">` 
            : `<div class="idea-cover" style="background:#333; display:flex; align-items:center; justify-content:center; color:#aaa; font-size:0.8rem;">Pas d'image</div>`
          }
          <div class="idea-title" title="${item.title || ''}">${item.title || 'Sans titre'}</div>
          <div class="idea-artist" title="${item.artist || ''}">${item.artist || 'Artiste inconnu'}</div>
          <div class="idea-duration">⏱️ ${item.duration || '00:00'}</div>
          <button type="button" class="idea-delete-btn" data-delete="${index}" title="Supprimer cet album">🗑️</button>
        </div>
      `;
    });
  }

  const activeGenreCount = typeof currentPlannerGenreFilters !== 'undefined' ? currentPlannerGenreFilters.size : 0;
  const genreBtnStyle = activeGenreCount > 0 
    ? 'background: #ff007f; color: #ffffff; border: 2px solid #000000; box-shadow: 2px 2px 0px #000000; font-weight: bold;'
    : '';
   
  app.innerHTML = `
    <div style="padding-bottom: 110px; padding-top: 215px; max-width: 800px; margin: 0 auto;">
      
      <div class="ideas-grid" id="ideas-grid-container">
        ${cardsHTML}
      </div>

      <div style="position: fixed; bottom: 15px; left: 0; right: 0; display: flex; justify-content: center; padding: 0 15px; pointer-events: none; z-index: 1000;">
        <div class="compil-actions" style="display: flex; gap: 8px; max-width: 600px; width: 100%; justify-content: center; align-items: stretch; background: rgba(30, 30, 30, 0.9); backdrop-filter: blur(10px); padding: 10px 14px; border-radius: 30px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); pointer-events: auto;">
          
          <!-- 1. AJOUTER -->
          <button type="button" class="btn-primary" id="planner-btn-add" style="flex: 1; height: 44px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; margin: 0; border-radius: 20px; font-size: 0.8rem; padding: 0 8px;">
            ＋ Ajouter
          </button>

          <!-- 2. CONVERTIR -->
          <button type="button" class="btn-secondary" id="planner-btn-convert" ${selectedIdeaIndices.size === 0 ? 'disabled' : ''} style="flex: 1; height: 44px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; margin: 0; border-radius: 20px; font-size: 0.8rem; padding: 0 8px; background: #06d6a0; color: #000; font-weight: bold;">
            💾 Convertir (${selectedIdeaIndices.size})
          </button>

          <!-- 3. RÉINITIALISER -->
          <button type="button" class="btn-sub" id="planner-btn-reset" style="flex: 1; height: 44px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; margin: 0; border-radius: 20px; font-size: 0.8rem; padding: 0 8px;">
            Réinitialiser
          </button>

          <!-- 4. GENRES -->
          <button type="button" class="tag-btn" id="planner-btn-genre-toggle" onclick="togglePlannerGenreDropdown()" style="flex: 1; height: 44px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; margin: 0; border-radius: 20px; font-size: 0.8rem; padding: 0 8px; ${genreBtnStyle}">
            🏷️ Genres${activeGenreCount > 0 ? ` (${activeGenreCount})` : ''}
          </button>

        </div>
      </div>

    </div>
  `;

  updatePlannerHeader();

  const gridContainer = document.getElementById('ideas-grid-container');
  if (gridContainer) {
    gridContainer.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('[data-delete]');
      if (deleteBtn) {
        e.stopPropagation();
        const index = parseInt(deleteBtn.getAttribute('data-delete'), 10);
        deleteIdeaAlbum(index);
        return;
      }

      const card = e.target.closest('.idea-card');
      if (card) {
        const index = parseInt(card.getAttribute('data-index'), 10);
        toggleIdeaSelection(index);
      }
    });
  }

  const addBtn = document.getElementById('planner-btn-add');
  if (addBtn) addBtn.addEventListener('click', openIdeaModal);

  const convertBtn = document.getElementById('planner-btn-convert');
  if (convertBtn) convertBtn.addEventListener('click', convertSelectedToMD);

  const resetBtn = document.getElementById('planner-btn-reset');
  if (resetBtn) resetBtn.addEventListener('click', clearIdeaSelection);

  window.scrollTo(0, 0);
}

function toggleIdeaSelection(index) {
  if (typeof selectedIdeaIndices === 'undefined') window.selectedIdeaIndices = new Set();

  if (selectedIdeaIndices.has(index)) {
    selectedIdeaIndices.delete(index);
  } else {
    selectedIdeaIndices.add(index);
  }

  updatePlannerHeader();

  const card = document.querySelector(`.idea-card[data-index="${index}"]`);
  if (card) {
    card.classList.toggle('selected', selectedIdeaIndices.has(index));
  }
}

function togglePlannerGenreDropdown() {
  if (typeof isPlannerGenreDropdownOpen === 'undefined') window.isPlannerGenreDropdownOpen = false;
  isPlannerGenreDropdownOpen = !isPlannerGenreDropdownOpen;
  renderPlannerGenreFilter();
}

function renderPlannerGenreFilter(savedScrollTop = 0) {
  const genreBtn = document.getElementById('planner-btn-genre-toggle');
  if (!genreBtn) return;

  const existingScrollArea = document.getElementById('planner-genre-scroll-area');
  if (existingScrollArea && savedScrollTop === 0) {
    savedScrollTop = existingScrollArea.scrollTop;
  }

  const existingMenu = document.getElementById('planner-genre-menu');
  if (existingMenu) existingMenu.remove();

  if (typeof isPlannerGenreDropdownOpen === 'undefined' || !isPlannerGenreDropdownOpen) return;

  const genresSet = new Set();
  const ideas = getIdeaList();
  
  ideas.forEach(item => {
    const itemGenres = getItemGenresList(item);
    itemGenres.forEach(g => genresSet.add(g));
  });

  const genres = Array.from(genresSet).sort();
  if (genres.length === 0) return;

  const rect = genreBtn.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.id = 'planner-genre-menu';
  
  Object.assign(menu.style, {
    position: 'fixed',
    bottom: `${window.innerHeight - rect.top + 8}px`,
    right: `${window.innerWidth - rect.right}px`,
    minWidth: '190px',
    maxWidth: '260px',
    maxHeight: '320px',
    background: '#ffffff',
    border: '2px solid #000000',
    borderRadius: '12px',
    padding: '8px',
    boxShadow: '4px 4px 0px #000000',
    zIndex: '2000',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box'
  });

  const activeCount = typeof currentPlannerGenreFilters !== 'undefined' ? currentPlannerGenreFilters.size : 0;

  // 1. Bouton "Tous les genres" (Fixe en haut)
  const allBtnWrapper = document.createElement('div');
  allBtnWrapper.style.cssText = 'position: sticky; top: 0; z-index: 10; background: #ffffff; padding-bottom: 6px; border-bottom: 1.5px solid #000000; flex-shrink: 0;';
  allBtnWrapper.innerHTML = `
    <button type="button" class="tag-btn ${activeCount === 0 ? 'active' : ''}" onclick="clearPlannerGenreFilters()" style="width: 100%; text-align: left;">
      Tous les genres
    </button>
  `;
  menu.appendChild(allBtnWrapper);

  // 2. Zone de défilement propre pour les genres
  const scrollArea = document.createElement('div');
  scrollArea.id = 'planner-genre-scroll-area';
  Object.assign(scrollArea.style, {
    overflowY: 'scroll',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    paddingTop: '6px',
    paddingRight: '4px',
    flex: '1',
    webkitOverflowScrolling: 'touch'
  });

  let genresHtml = '';
  genres.forEach(genre => {
    const isActive = typeof currentPlannerGenreFilters !== 'undefined' && currentPlannerGenreFilters.has(genre);
    // Échappement propre pour ne pas casser le HTML
    const safeGenreAttr = genre.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, "\\'");
    
    genresHtml += `
      <button type="button" class="tag-btn ${isActive ? 'active' : ''}" onclick="togglePlannerGenre('${safeGenreAttr}')" style="width: 100%; text-align: left; flex-shrink: 0;">
        ${isActive ? '✓ ' : ''}${genre}
      </button>
    `;
  });

  scrollArea.innerHTML = genresHtml;
  menu.appendChild(scrollArea);
  document.body.appendChild(menu);

  if (savedScrollTop > 0) {
    scrollArea.scrollTop = savedScrollTop;
  }
}

function togglePlannerGenre(genre) {
  const scrollArea = document.getElementById('planner-genre-scroll-area');
  const scrollTop = scrollArea ? scrollArea.scrollTop : 0;

  if (typeof currentPlannerGenreFilters === 'undefined') window.currentPlannerGenreFilters = new Set();

  if (currentPlannerGenreFilters.has(genre)) {
    currentPlannerGenreFilters.delete(genre);
  } else {
    currentPlannerGenreFilters.add(genre);
  }

  renderCompilPlanner(false);
  renderPlannerGenreFilter(scrollTop);
}

function clearPlannerGenreFilters() {
  if (typeof currentPlannerGenreFilters !== 'undefined') {
    currentPlannerGenreFilters.clear();
  }
  renderCompilPlanner(false);
  renderPlannerGenreFilter(0);
}

function deleteIdeaAlbum(index) {
  const ideas = getIdeaList();
  if (!ideas[index]) return;

  if (confirm(`Supprimer "${ideas[index].title}" de vos idées ?`)) {
    ideas.splice(index, 1);
    
    if (typeof selectedIdeaIndices !== 'undefined') {
      const updatedIndices = new Set();
      selectedIdeaIndices.forEach(i => {
        if (i > index) updatedIndices.add(i - 1);
        else if (i < index) updatedIndices.add(i);
      });
      selectedIdeaIndices = updatedIndices;
    }

    if (typeof saveLocalBackup === 'function') saveLocalBackup();
    if (typeof showToast === 'function') showToast("🗑️ Album supprimé des idées");
    renderCompilPlanner(false);
  }
}

function clearIdeaSelection() {
  if (typeof selectedIdeaIndices !== 'undefined') {
    selectedIdeaIndices.clear();
  }
  renderCompilPlanner(false);
}

function openIdeaModal() {
  if (typeof populateFormDatalists === 'function') populateFormDatalists();
  const form = document.getElementById('idea-form');
  if (form) form.reset();
  const coverInput = document.getElementById('idea-cover');
  if (coverInput) coverInput.value = "images/";
  const modal = document.getElementById('idea-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeIdeaModal() {
  const modal = document.getElementById('idea-modal');
  if (modal) modal.classList.add('hidden');
}

function saveIdeaAlbum(e) {
  e.preventDefault();
  const title = document.getElementById('idea-title').value.trim();
  const artist = document.getElementById('idea-artist').value.trim();
  const genre = document.getElementById('idea-genre').value.trim();
  const duration = document.getElementById('idea-duration').value.trim();
  const cover = document.getElementById('idea-cover').value.trim();

  const newIdea = { title, artist, genre, duration, cover };
  
  if (!window.ideaAlbums) window.ideaAlbums = [];
  window.ideaAlbums.push(newIdea);

  if (typeof saveLocalBackup === 'function') saveLocalBackup();
  closeIdeaModal();
  if (typeof showToast === 'function') showToast("💡 Album ajouté aux idées !");
  renderCompilPlanner(false);
}

function convertSelectedToMD() {
  if (typeof selectedIdeaIndices === 'undefined' || selectedIdeaIndices.size === 0) return;

  const ideas = getIdeaList();
  const selectedAlbums = Array.from(selectedIdeaIndices).map(i => ideas[i]);

  const newMD = {
    genre: selectedAlbums[0].genre ? [selectedAlbums[0].genre] : ['DIVERS'],
    type: ['ALBUM'],
    md_cover: selectedAlbums[0].cover || 'images/',
    albums: selectedAlbums.map(a => ({
      title: a.title,
      artist: a.artist,
      genre: a.genre ? [a.genre] : [],
      cover: a.cover,
      tracks: []
    }))
  };

  if (Array.isArray(catalogData)) {
    catalogData.push(newMD);
  } else if (catalogData && Array.isArray(catalogData.minidiscs)) {
    catalogData.minidiscs.push(newMD);
  }

  window.ideaAlbums = ideas.filter((_, idx) => !selectedIdeaIndices.has(idx));
  selectedIdeaIndices.clear();

  clearPlannerHeaderInfo();
  if (typeof saveLocalBackup === 'function') saveLocalBackup();
  if (typeof showToast === 'function') showToast("🎉 Albums convertis en MiniDisc avec succès !");
  if (typeof renderDashboard === 'function') renderDashboard(true);
}

/* ==========================================
   GESTION DU BOUTON RETOUR (ANCRAGE HASH)
   ========================================== */

window.addEventListener('popstate', () => {
  const hash = window.location.hash;

  if (hash.startsWith('#md-') && !hash.includes('list')) {
    const index = parseInt(hash.replace('#md-', ''), 10);
    if (!isNaN(index) && typeof openMD === 'function') {
      openMD(index, false);
      return;
    }
  }

  if (hash === '#md-list') {
    if (typeof clearPlannerHeaderInfo === 'function') clearPlannerHeaderInfo();
    if (typeof renderMDList === 'function') {
      renderMDList({ genre: currentGenreFilter, type: currentTypeFilter }, false);
      return;
    }
  }

  if (hash === '#planner') {
    if (typeof renderCompilPlanner === 'function') {
      renderCompilPlanner(false);
      return;
    }
  }

  // Si le hash est vide, #home ou inconnu -> Accueil
  if (typeof clearPlannerHeaderInfo === 'function') clearPlannerHeaderInfo();
  if (typeof renderDashboard === 'function') renderDashboard(false);
});

// Remplit dynamiquement les menus déroulants avec genres et types existants
function populateFormDatalists() {
  if (!catalogData || !Array.isArray(catalogData)) return;

  const genresSet = new Set();
  const typesSet = new Set();

  catalogData.forEach(md => {
    // Récupération sécurisée des genres
    if (typeof getMDAllGenres === 'function') {
      getMDAllGenres(md).forEach(g => genresSet.add(g));
    } else if (md.genre) {
      const gList = Array.isArray(md.genre) ? md.genre : md.genre.split(',');
      gList.forEach(g => genresSet.add(g.trim()));
    }

    // Récupération sécurisée des types
    if (typeof getMDAllTypes === 'function') {
      getMDAllTypes(md).forEach(t => typesSet.add(t));
    } else if (md.type) {
      const tList = Array.isArray(md.type) ? md.type : md.type.split(',');
      tList.forEach(t => typesSet.add(t.trim()));
    }
  });

  const genresDatalist = document.getElementById('genres-list');
  const typesDatalist = document.getElementById('types-list');

  if (genresDatalist) {
    genresDatalist.innerHTML = Array.from(genresSet)
      .filter(Boolean)
      .sort()
      .map(g => `<option value="${g}">`)
      .join('');
  }

  if (typesDatalist) {
    typesDatalist.innerHTML = Array.from(typesSet)
      .filter(Boolean)
      .sort()
      .map(t => `<option value="${t}">`)
      .join('');
  }
}
