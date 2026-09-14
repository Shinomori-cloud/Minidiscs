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
function saveLocalBackup() {
  const payload = {
    minidiscs: catalogData || [],
    ideaAlbums: window.ideaAlbums || []
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    syncCollectionToGithub(payload);
  } catch (err) {
    console.error("Erreur de sauvegarde locale:", err);
  }
}

function clearLocalBackup() {
  localStorage.removeItem(STORAGE_KEY);
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
    if (fabBtn) fabBtn.textContent = '🔍';
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

// Ouvre et ferme le sous-menu des genres dans le FAB avec la bonne liste
// Ouvre et ferme le sous-menu des genres dans le FAB et génère sa liste
function toggleGenreDropdown() {
  toggleFabSubmenu('genres-submenu');

  const submenu = document.getElementById('genres-submenu');
  
  if (submenu && !submenu.classList.contains('hidden')) {
    populateFabGenreMenu();
  }
}

// Génère le contenu dynamique des filtres avec la nouvelle structure épurée (style Planificateur)
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

  const scrollArea = document.createElement('div');
  scrollArea.className = 'fab-scrollable-submenu fab-genre-list';

  // 1. Bouton "TOUS"
  const isAllActive = !currentGenreFilter || currentGenreFilter === 'ALL';
  const allBtn = document.createElement('div');
  allBtn.className = `fab-genre-item ${isAllActive ? 'active' : ''}`;
  allBtn.innerHTML = `<span>TOUS</span>${isAllActive ? '<span>✓</span>' : ''}`;
  allBtn.onclick = (e) => {
    e.stopPropagation(); // Empêche la fermeture du FAB
    if (typeof selectGenreFilter === 'function') selectGenreFilter('ALL');
  };
  scrollArea.appendChild(allBtn);

  // 2. Boutons par genre
  Array.from(allGenres).sort().forEach(genre => {
    const isActive = currentGenreFilter === genre;
    const btn = document.createElement('div');
    btn.className = `fab-genre-item ${isActive ? 'active' : ''}`;
    btn.innerHTML = `<span>${genre}</span>${isActive ? '<span>✓</span>' : ''}`;
    btn.onclick = (e) => {
      e.stopPropagation(); // Empêche la fermeture du FAB
      if (typeof selectGenreFilter === 'function') selectGenreFilter(genre);
    };
    scrollArea.appendChild(btn);
  });

  dropdown.innerHTML = '';
  dropdown.appendChild(scrollArea);
}

// Application du filtre sélectionné et rafraîchissement de la liste
function selectGenreFilter(genre) {
  currentGenreFilter = (genre === 'ALL' || !genre) ? '' : genre.toUpperCase().trim();

  const dropdown = document.getElementById('genre-filter-dropdown');
  if (dropdown) dropdown.classList.add('hidden');

  // Met à jour l'affichage du badge sous le header
  if (typeof updateGenreBadge === 'function') updateGenreBadge();

  // Rafraîchit l'état actif et la coche dans le menu FAB des genres
  populateFabGenreMenu();

  renderMDList({ 
    genre: currentGenreFilter, 
    type: currentTypeFilter, 
    record: currentRecordFilter 
  }, false);
}

// Change le filtre à chaque clic (Tous -> À enregistrer -> Enregistrés)
function applyStatusFilter(filterValue) {
  if (filterValue === 'torecord') {
    currentRecordFilter = 'toRecord';
  } else if (filterValue === 'recorded') {
    currentRecordFilter = 'recorded';
  } else {
    currentRecordFilter = 'all';
  }

  // Masque le sous-menu après la sélection
  const statusSubmenu = document.getElementById('status-submenu');
  if (statusSubmenu) {
    statusSubmenu.classList.add('hidden');
  }

  if (typeof renderMDList === 'function') {
    renderMDList({ 
      genre: typeof currentGenreFilter !== 'undefined' ? currentGenreFilter : '', 
      type: typeof currentTypeFilter !== 'undefined' ? currentTypeFilter : '', 
      record: currentRecordFilter 
    }, false);
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
  const genreDropdown = document.getElementById('genre-filter-dropdown');

  if (show) {
    if (floatingActions) floatingActions.classList.remove('hidden');
    if (typeof updateFilterIcon === 'function') {
      updateFilterIcon();
    }
  } else {
    if (floatingActions) floatingActions.classList.add('hidden');
    if (fabBtn) fabBtn.textContent = '🔍';
    if (topSearch) topSearch.classList.add('closed');
    if (genreDropdown) genreDropdown.classList.add('hidden');

    currentSearchQuery = '';
    if (searchInput) searchInput.value = '';
  }
}

// Fonction pour attacher l'événement au bouton
function initGithubTokenForm() {
  const tokenInput = document.getElementById('gh-token-input');
  const saveBtn = document.getElementById('save-token-btn');

  if (!saveBtn || !tokenInput) {
    console.warn("Éléments du formulaire Token introuvables.");
    return;
  }

  // Affiche le token déjà sauvegardé s'il existe
  tokenInput.value = getGithubToken() || '';

  // Gestion du clic
  saveBtn.addEventListener('click', (e) => {
    e.preventDefault(); // Empêche tout rechargement de formulaire HTML
    const val = tokenInput.value;
    if (val) {
      saveGithubToken(val);
    } else {
      localStorage.removeItem('github_token');
      alert('Token supprimé.');
    }
  });
}

// S'assure que le DOM est prêt avant d'exécuter l'initialisation
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGithubTokenForm);
} else {
  initGithubTokenForm();
}

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
    const record = urlParams.get('record');
    if (typeof renderMDList === 'function') {
      renderMDList({ genre, type, record }, false);
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

  const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
  if (fa) fa.style.display = 'flex';

  // Mise à jour explicite des variables globales avec fallback
  currentGenreFilter = filters.genre !== undefined ? filters.genre : currentGenreFilter;
  currentTypeFilter = filters.type !== undefined ? filters.type : currentTypeFilter;
  currentRecordFilter = filters.record !== undefined ? filters.record : currentRecordFilter;

  const genre = currentGenreFilter;
  const type = currentTypeFilter;
  const record = currentRecordFilter;

  if (pushState) {
    window.location.hash = '#md-list';
  }
  
  currentMD = null;
  currentAlbum = null;

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

      const coverHTML = createLoadingCoverHTML(md.md_cover, 'md-thumb', '💽');

      html += `
        <div class="list-item" style="border-color: ${borderColor}; border-left-width: 6px; position: relative;" onclick="openMD(${originalIndex})">
          ${coverHTML}
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

  // FAB HTML pour la vue détail d'un MiniDisc
  const fabHTML = `
    <div id="md-detail-floating-actions" class="fab-container">
      <div id="md-detail-fab-menu" class="fab-menu hidden">
        <button type="button" class="fab-item" onclick="openAdminModal(${index});">
          ✏️ Modifier
        </button>
        <button type="button" class="fab-item" onclick="deleteMD(${index});">
          🗑️ Supprimer
        </button>
      </div>
      
      <button type="button" id="md-detail-fab-main-btn" class="fab-main-btn" onclick="toggleMdDetailFabMenu();" title="Actions MiniDisc">
        <span class="fab-icon">🎚️</span>
      </button>
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

    const coverHTML = createLoadingCoverHTML(md.md_cover, 'album-cover-large', '💽');

    app.innerHTML = `
      <div class="track-container" style="padding-bottom: 90px;">
        <div class="album-header">
          ${coverHTML}
          <div>
            ${badgeCompilHTML}
            <h2 style="font-size: 1.2rem; font-weight: 800;">${md.title || 'Compilation'}</h2>
            <p style="color: var(--text-sub); font-size: 0.95rem;">${md.artist || 'Artistes divers'}</p>
            <p style="color: ${borderColor}; font-size: 0.8rem; font-weight: 800;">${allMdGenres.join(' / ')}</p>
          </div>
        </div>
        <ul class="track-list">${tracksHTML}</ul>
        ${fabHTML}
      </div>
    `;
    window.scrollTo(0, 0);
    return;
  }

  // CAS 2 : SÉRIE D'ALBUMS
  if (headerTitle) headerTitle.textContent = "ALBUMS";

  let html = `<div class="list-container" style="padding-bottom: 90px;">`;
  md.albums.forEach((album, aIndex) => {
    const albumGenres = getAlbumGenres(album, md);
    const albumColor = getBorderColor(albumGenres);
    
    const badgeAlbumHTML = album.toRecord 
      ? `<span class="badge-to-record badge-record-corner">💽 À enregistrer</span>` 
      : '';

    const coverHTML = createLoadingCoverHTML(album.cover, 'album-thumb', '🎵');

    html += `
      <div class="list-item" style="border-color: ${albumColor}; border-left-width: 6px; position: relative;" onclick="openAlbum(${index}, ${aIndex})">
        <div class="album-cover-container" style="margin-right: 15px; display: inline-block;">
          ${coverHTML}
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
  html += `${fabHTML}</div>`;
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/* BASCULE LE MENU FAB DE LA VUE DÉTAIL MINIDISC */
function toggleMdDetailFabMenu() {
  const menu = document.getElementById('md-detail-fab-menu');
  const btn = document.getElementById('md-detail-fab-main-btn');
  if (!menu) return;

  const isHidden = menu.classList.toggle('hidden');

  if (btn) {
    btn.classList.toggle('open', !isHidden);
  }
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

  const coverHTML = createLoadingCoverHTML(album.cover, 'album-cover-large', '🎵');

  app.innerHTML = `
    <div class="track-container">
      <div class="album-header">
        ${coverHTML}
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
    showToast("🗑️ MiniDisc supprimé !");
    
    // Reste sur la vue catalogue au lieu d'aller à l'accueil
    if (typeof renderMDList === 'function') {
      renderMDList({ 
        genre: currentGenreFilter, 
        type: currentTypeFilter, 
        record: currentRecordFilter 
      }, false);
    } else if (typeof renderDashboard === 'function') {
      renderDashboard(false);
    }
  }
}

/* ==========================================
   GESTION DE LA MODALE ADMIN
   ========================================== */

/* ==========================================
   UTILITAIRE : SÉLECTION MULTIPLE PAR SUGGESTIONS
   ========================================== */
function setupMultiSelectContainer(inputId, datalistId) {
  const input = document.getElementById(inputId);
  const datalist = document.getElementById(datalistId);
  if (!input || !datalist) return;

  // Retirer l'attribut list pour empêcher le menu déroulant natif du navigateur de s'ouvrir au clic
  input.removeAttribute('list');

  // Éviter de réattacher le conteneur plusieurs fois
  let container = input.parentElement.querySelector('.tag-suggestions');
  if (!container) {
    container = document.createElement('div');
    container.className = 'tag-suggestions';
    container.style.cssText = "display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;";
    input.parentElement.appendChild(container);
  }

  // Fonction pour afficher les badges des options disponibles
  function renderBadges() {
    container.innerHTML = '';
    const currentValues = input.value.split(',').map(v => v.trim().toLowerCase());
    const options = Array.from(datalist.options).map(opt => opt.value);

    options.forEach(optValue => {
      // Si l'option n'est pas encore ajoutée dans le champ
      if (!currentValues.includes(optValue.toLowerCase())) {
        const badge = document.createElement('span');
        badge.textContent = `+ ${optValue}`;
        badge.style.cssText = "background: #e9ecef; color: #212529; border: 1px solid #ced4da; padding: 3px 8px; border-radius: 12px; font-size: 0.75rem; cursor: pointer; user-select: none;";
        
        badge.onclick = () => {
          const parts = input.value.split(',').map(p => p.trim()).filter(p => p !== '');
          parts.push(optValue);
          input.value = parts.join(', ') + ', ';
          renderBadges(); // Met à jour les puces restantes
          
          // NOUVEAU : Si c'est un champ de genre d'album, mettre à jour les genres globaux
          if (input.classList.contains('album-genre')) {
            updateGlobalGenresFromAlbums();
          }
          
          input.focus();
        };
        container.appendChild(badge);
      }
    });
  }

  // Mettre à jour si l'utilisateur retape du texte à la main
  input.oninput = () => {
    renderBadges();
    // NOUVEAU : Synchronisation en temps réel si modification manuelle
    if (input.classList.contains('album-genre')) {
      updateGlobalGenresFromAlbums();
    }
  };
  
  renderBadges();
}

/* ==========================================
   NOUVEAU : SYNCHRONISATION AUTOMATIQUE DES GENRES
   ========================================== */
function updateGlobalGenresFromAlbums() {
  const checkedRadio = document.querySelector('input[name="md-type"]:checked');
  const isCompil = checkedRadio ? checkedRadio.value === 'compil' : true;

  // On ne synchronise que si nous sommes en mode Série d'albums
  if (isCompil) return;

  const albumGenreInputs = document.querySelectorAll('.album-block .album-genre');
  const collectedGenres = new Set();

  albumGenreInputs.forEach(input => {
    const rawValues = input.value.split(',');
    rawValues.forEach(val => {
      const trimmed = val.trim();
      if (trimmed) {
        // Normalisation en majuscules pour éviter "Rock" et "ROCK"
        collectedGenres.add(trimmed.toUpperCase());
      }
    });
  });

  const globalGenreInput = document.getElementById('md-genre');
  if (globalGenreInput) {
    globalGenreInput.value = Array.from(collectedGenres).join(', ');
    // Mettre à jour les puces de suggestions du champ global si existantes
    const globalContainer = globalGenreInput.parentElement.querySelector('.tag-suggestions');
    if (globalContainer) {
      setupMultiSelectContainer('md-genre', 'genres-list');
    }
  }
}

function openAdminModal(indexToEdit = null) {
  // Rafraîchir les listes de suggestions (genres / types)
  populateFormDatalists();

  setupMultiSelectContainer('md-genre', 'genres-list');
  setupMultiSelectContainer('md-type-tags', 'types-list');

  editingMDIndex = indexToEdit;
  const modalTitle = document.querySelector('#admin-modal h3');
  const albumsContainer = document.getElementById('albums-container');
  if (albumsContainer) albumsContainer.innerHTML = '';
  adminAlbumCount = 0;

  // Réinitialiser le champ fichier principal avec une chaîne vide
  const mdCoverInput = document.getElementById('md-cover');
  if (mdCoverInput) mdCoverInput.value = '';

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
        block.querySelector('.album-tracks').value = album.tracks ? album.tracks.map(t => t.replace(/^\d+\.\s*/, '')).join('\n') : '';
        if (block.querySelector('.album-to-record')) {
          block.querySelector('.album-to-record').checked = !!album.toRecord;
        }
      });
      // Recalculer les genres globaux au chargement de l'édition
      updateGlobalGenresFromAlbums();
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
  const mdGenreInput = document.getElementById('md-genre');

  if (secCompil) secCompil.classList.toggle('hidden', !isCompil);
  if (secAlbums) secAlbums.classList.toggle('hidden', isCompil);

  // Bascule du champ global "Genre" en lecture seule quand on est en mode "albums"
  if (mdGenreInput) {
    mdGenreInput.readOnly = !isCompil;
    mdGenreInput.style.backgroundColor = !isCompil ? '#f0f0f0' : '';
    if (!isCompil) {
      updateGlobalGenresFromAlbums();
    }
  }

  const albumsContainer = document.getElementById('albums-container');
  if (!isCompil && !isInit && albumsContainer && albumsContainer.children.length === 0) {
    addAdminAlbumBlock();
  }
}

function addAdminAlbumBlock() {
  adminAlbumCount++;
  const container = document.getElementById('albums-container');
  if (!container) return;

  const genreInputId = `album-genre-${adminAlbumCount}`;
  const typeInputId = `album-type-${adminAlbumCount}`;

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
    <div class="form-group"><input type="text" id="${typeInputId}" class="album-type" list="types-list" placeholder="Type(s) de l'album (ex: Album, Live)"></div>
    <div class="form-group"><input type="text" id="${genreInputId}" class="album-genre" list="genres-list" placeholder="Genre(s) de l'album (séparés par virgule)"></div>
    <div class="form-group"><input type="text" class="album-year" placeholder="Année (ex: 1998)"></div>
    <div class="form-group">
      <label style="font-size: 0.85rem; font-weight: bold; display: block; margin-bottom: 4px;">Pochette Album</label>
      <input type="file" class="album-cover" accept="image/*">
    </div>
    <div class="form-group"><textarea class="album-tracks" placeholder="Pistes de cet album (une par ligne)"></textarea></div>
    <div class="form-group" style="margin-top: 8px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold; font-size: 0.85rem;">
        <input type="checkbox" class="album-to-record" style="width: 16px; height: 16px;">
        🎙️ À enregistrer
      </label>
    </div>
  `;
  container.appendChild(div);

  // Activer la sélection par puces pour le nouvel album
  setupMultiSelectContainer(genreInputId, 'genres-list');
  setupMultiSelectContainer(typeInputId, 'types-list');
}

function removeAdminAlbumBlock(button) {
  const block = button.closest('.album-block');
  if (block) {
    block.remove();
    // Mettre à jour les genres globaux si un album est supprimé
    updateGlobalGenresFromAlbums();
  }
}

async function submitNewMD(e) {
  if (e) e.preventDefault();
  if (catalogData === null) return;

  // S'assurer que le champ global contient bien tous les genres des albums avant enregistrement
  const checkedRadio = document.querySelector('input[name="md-type"]:checked');
  const typeFormat = checkedRadio ? checkedRadio.value : 'compil';
  if (typeFormat !== 'compil') {
    updateGlobalGenresFromAlbums();
  }

  const rawGenreInput = document.getElementById('md-genre').value.trim();
  const rawTypeInput = document.getElementById('md-type-tags') ? document.getElementById('md-type-tags').value.trim() : '';
  const mdCoverInput = document.getElementById('md-cover');

  if (!rawGenreInput) {
    showToast("⚠️ Veuillez renseigner au moins un genre");
    return;
  }

  showToast("⏳ Traitement et envoi de l'image...");

  // Upload de l'image principale du MiniDisc si un fichier est sélectionné
  let mdCoverPath = 'images/default.jpg';
  if (mdCoverInput && mdCoverInput.files && mdCoverInput.files.length > 0) {
    const uploadedPath = await handleImageUpload(mdCoverInput);
    if (uploadedPath) {
      mdCoverPath = uploadedPath;
    }
  } else if (editingMDIndex !== null && catalogData[editingMDIndex].md_cover) {
    // Conservation de l'ancienne image si aucune nouvelle n'a été choisie en édition
    mdCoverPath = catalogData[editingMDIndex].md_cover;
  }

  const parsedMDGenres = rawGenreInput.includes(',') 
    ? rawGenreInput.split(',').map(g => g.trim()).filter(g => g !== '')
    : [rawGenreInput];

  const parsedMDTypes = rawTypeInput 
    ? (rawTypeInput.includes(',') ? rawTypeInput.split(',').map(t => t.trim()).filter(t => t !== '') : [rawTypeInput])
    : ['ALBUM'];

  let globalTrackCounter = 1;
  const targetMD = { genre: parsedMDGenres, type: parsedMDTypes, md_cover: mdCoverPath };

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

    // Boucle pour l'upload d'image et la création de chaque album
    for (let i = 0; i < albumBlocks.length; i++) {
      const block = albumBlocks[i];
      const rawTracks = block.querySelector('.album-tracks').value.split('\n');
      const formattedTracks = rawTracks
        .filter(t => t.trim() !== '')
        .map(t => `${String(globalTrackCounter++).padStart(2, '0')}. ${t.trim()}`);

      const rawAlbumGenre = block.querySelector('.album-genre').value.trim();
      const parsedAlbumGenres = rawAlbumGenre 
        ? (rawAlbumGenre.includes(',') ? rawAlbumGenre.split(',').map(g => g.trim()).filter(g => g !== '') : [rawAlbumGenre])
        : [];

      const rawAlbumType = block.querySelector('.album-type-tags') ? block.querySelector('.album-type-tags').value.trim() : (block.querySelector('.album-type') ? block.querySelector('.album-type').value.trim() : '');
      const parsedAlbumTypes = rawAlbumType 
        ? (rawAlbumType.includes(',') ? rawAlbumType.split(',').map(t => t.trim()).filter(t => t !== '') : [rawAlbumType])
        : [];

      // Gestion de l'upload d'image pour l'album
      const albumCoverInput = block.querySelector('.album-cover');
      let albumCoverPath = 'images/default.jpg';
      
      if (albumCoverInput && albumCoverInput.files && albumCoverInput.files.length > 0) {
        const uploadedPath = await handleImageUpload(albumCoverInput);
        if (uploadedPath) {
          albumCoverPath = uploadedPath;
        }
      } else if (editingMDIndex !== null && catalogData[editingMDIndex].albums && catalogData[editingMDIndex].albums[i]) {
        albumCoverPath = catalogData[editingMDIndex].albums[i].cover || 'images/default.jpg';
      }

      const albumObj = {
        title: block.querySelector('.album-title').value.trim(),
        artist: block.querySelector('.album-artist').value.trim(),
        year: block.querySelector('.album-year').value.trim(),
        cover: albumCoverPath,
        tracks: formattedTracks,
        toRecord: block.querySelector('.album-to-record') ? block.querySelector('.album-to-record').checked : false
      };

      if (parsedAlbumGenres.length > 0) albumObj.genre = parsedAlbumGenres;
      if (parsedAlbumTypes.length > 0) albumObj.type = parsedAlbumTypes;

      targetMD.albums.push(albumObj);
    }
  }

  // Enregistrement dans catalogData
  if (editingMDIndex !== null) {
    catalogData[editingMDIndex] = targetMD;
    editingMDIndex = null;
    showToast("✅ MiniDisc modifié !");
  } else {
    catalogData.push(targetMD);
    showToast("✅ MiniDisc ajouté !");
  }

  if (typeof saveLocalBackup === 'function') saveLocalBackup();
  if (typeof closeAdminModal === 'function') closeAdminModal();

  // Rechargement de la vue Catalogue active
  if (typeof renderMDList === 'function') {
    renderMDList({ 
      genre: typeof currentGenreFilter !== 'undefined' ? currentGenreFilter : '', 
      type: typeof currentTypeFilter !== 'undefined' ? currentTypeFilter : '', 
      record: typeof currentRecordFilter !== 'undefined' ? currentRecordFilter : '' 
    }, false);
  } else if (typeof renderDashboard === 'function') {
    renderDashboard(false);
  }
}

/* ==========================================
   GESTION DU MENU FLOTTANT (FAB)
   ========================================== */

// Ouvre et ferme le menu déroulant au clic sur le pignon ⚙️
function toggleFabMenu() {
  const menu = document.getElementById('fab-menu');
  const btn = document.getElementById('fab-main-btn');
  if (!menu) return;

  const isOpen = menu.classList.toggle('hidden');
  
  if (btn) {
    btn.classList.toggle('open', !isOpen);
  }
}

// Ferme le menu si l'utilisateur clique en dehors de la zone du FAB
document.addEventListener('click', (e) => {
  const container = document.getElementById('floating-actions');
  const menu = document.getElementById('fab-menu');
  if (container && menu && !container.contains(e.target)) {
    menu.classList.add('hidden');
  }
});

// Ouvre/ferme le sous-menu du statut dans le FAB
function toggleFabSubmenu(id) {
  const submenu = document.getElementById(id);
  if (submenu) {
    submenu.classList.toggle('hidden');
  }
}

// Applique le filtre de statut directement au clic
function applyStatusFilter(filterValue) {
  let targetRecord = 'all';
  if (filterValue === 'torecord') {
    targetRecord = 'toRecord';
  } else if (filterValue === 'recorded') {
    targetRecord = 'recorded';
  }

  // Masque le sous-menu après sélection
  const statusSubmenu = document.getElementById('status-submenu');
  if (statusSubmenu) {
    statusSubmenu.classList.add('hidden');
  }

  // Application explicite du filtre
  renderMDList({ 
    genre: currentGenreFilter, 
    type: currentTypeFilter, 
    record: targetRecord 
  }, false);
}

// Remplit le sous-menu FAB avec le style exact du Planificateur (Bleu + coche)
function populateFabGenreMenu() {
  const container = document.getElementById('genres-submenu');
  if (!container || !catalogData) return;

  const allGenres = new Set();

  // 1. Extraction des genres
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

  container.innerHTML = '';

  if (allGenres.size === 0) {
    container.innerHTML = `<span style="font-size: 0.75rem; color: #666; padding: 6px 12px;">Aucun genre</span>`;
    return;
  }

  const activeGenreNorm = currentGenreFilter ? currentGenreFilter.toUpperCase().trim() : '';

  // Helper pour créer chaque item de genre
  const createGenreBtn = (text, isSelected, genreValue) => {
    const btn = document.createElement('div');
    btn.className = `fab-genre-item ${isSelected ? 'active' : ''}`;
    btn.innerHTML = `<span>${text}</span>${isSelected ? '<span>✓</span>' : ''}`;
    btn.onclick = (e) => {
      e.stopPropagation(); // Empêche la fermeture du FAB
      selectGenreFilter(genreValue);
    };
    return btn;
  };

  // 2. Option "TOUS"
  const isAllActive = !activeGenreNorm || activeGenreNorm === 'ALL';
  container.appendChild(createGenreBtn('TOUS', isAllActive, 'ALL'));

  // 3. Boutons par genre
  Array.from(allGenres).sort().forEach(genre => {
    const isSelected = activeGenreNorm === genre;
    container.appendChild(createGenreBtn(genre, isSelected, genre));
  });
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

  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0] * 60;
  return 0;
}

function formatSecondsToDisplay(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = num => String(num).padStart(2, '0');

  return h > 0 
    ? `${h}h ${pad(m)}m ${pad(s)}s` 
    : `${m}m ${pad(s)}s`;
}

function updatePlannerHeader() {
  const durationTextEl = document.getElementById('planner-duration-text');
  const selectedListEl = document.getElementById('planner-selected-list');
  
  const ideas = getIdeaList();
  const maxSeconds = 148 * 60; // 2h 28m
  let totalSeconds = 0;

  if (typeof selectedIdeaIndices === 'undefined') window.selectedIdeaIndices = new Set();

  const selectedHTML = Array.from(selectedIdeaIndices)
    .filter(idx => ideas[idx])
    .map(idx => {
      const item = ideas[idx];
      totalSeconds += parseTimeToSeconds(item.duration);
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; gap: 8px;">
          <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #000; font-weight: 600;">
            🎵 <span style="color: #666;">${item.artist || 'Artiste'}</span> - ${item.title || 'Titre'}
          </div>
          <div style="font-weight: 700; color: #000; white-space: nowrap;">⏱️ ${item.duration || '00:00'}</div>
        </div>`;
    }).join('');

  if (selectedListEl) {
    const hasSelection = selectedIdeaIndices.size > 0;
    selectedListEl.innerHTML = hasSelection ? selectedHTML : '';
    selectedListEl.style.display = hasSelection ? 'block' : 'none';
  }

  if (durationTextEl) {
    durationTextEl.style.color = totalSeconds > maxSeconds ? '#e63946' : '#06d6a0';
    durationTextEl.textContent = `${formatSecondsToDisplay(totalSeconds)} / 2h 28m`;
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
    const isDisabled = !isSelected && itemSec > remainingSeconds;

    card.classList.toggle('disabled-card', isDisabled);
    card.style.opacity = isDisabled ? '0.4' : '1';
  });
}

function clearPlannerHeaderInfo() {
  document.getElementById('header-planner-badge')?.remove();
  document.getElementById('planner-genre-menu')?.remove();

  if (typeof isPlannerGenreDropdownOpen !== 'undefined') {
    isPlannerGenreDropdownOpen = false;
  }
}

function injectPlannerHeaderBadge() {
  const header = document.querySelector('header') || document.querySelector('.header');
  if (!header || document.getElementById('header-planner-badge')) return;

  const badge = document.createElement('div');
  badge.id = 'header-planner-badge';
  badge.style.cssText = `
    position: fixed; top: 150px; left: 50%; transform: translateX(-50%); z-index: 999;
    background: #ffffff; border: 2px solid #000000; border-radius: 16px; padding: 10px 16px;
    box-shadow: 4px 4px 0px #000000; display: flex; flex-direction: column; gap: 8px;
    width: calc(100% - 32px); max-width: 568px; box-sizing: border-box;
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

function getItemGenresList(item) {
  if (typeof getMDAllGenres === 'function') return getMDAllGenres(item);
  if (!item || !item.genre) return [];
  if (Array.isArray(item.genre)) {
    return item.genre.map(g => String(g).trim().toUpperCase()).filter(Boolean);
  }
  return String(item.genre).split(',').map(g => g.trim().toUpperCase()).filter(Boolean);
}

/* RENDU DU PLANIFICATEUR */
function renderCompilPlanner(pushState = true) {
  try {
    window.isPlannerGenreDropdownOpen = false;
    if (typeof selectedIdeaIndices === 'undefined') window.selectedIdeaIndices = new Set();

    const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
    if (fa) {
      fa.style.display = 'flex';
      fa.classList.remove('hidden');
    }
      
    if (typeof currentMD !== 'undefined') window.currentMD = null;
    if (typeof currentAlbum !== 'undefined') window.currentAlbum = null;

    document.getElementById('back-btn')?.classList.remove('hidden');
    
    const headerTitle = document.getElementById('header-title') || document.querySelector('.header-title');
    if (headerTitle) headerTitle.textContent = "PLANIFICATEUR";

    document.getElementById('featured-container')?.classList.add('hidden');

    if (pushState && window.location.hash !== '#planner') {
      history.pushState({ view: 'planner' }, '', '#planner');
    }

    if (typeof updateSearchVisibility === 'function') updateSearchVisibility(false);
    injectPlannerHeaderBadge();

    const rawIdeas = typeof getIdeaList === 'function' ? getIdeaList() : [];
    let ideas = rawIdeas.map((item, originalIndex) => ({ ...item, originalIndex }));

    if (typeof currentPlannerGenreFilters !== 'undefined' && currentPlannerGenreFilters.size > 0) {
      ideas = ideas.filter(item => {
        const itemGenres = getItemGenresList(item);
        return Array.from(currentPlannerGenreFilters).some(g => itemGenres.includes(g));
      });
    }

    if (typeof dailyShuffle === 'function') ideas = dailyShuffle(ideas, '-planner');

    let cardsHTML = '';
    if (rawIdeas.length === 0) {
      cardsHTML = `<p style="text-align:center; grid-column: 1/-1; padding: 30px; color: #fff;">Aucun album dans votre liste d'idées.</p>`;
    } else if (ideas.length === 0) {
      cardsHTML = `<p style="text-align:center; grid-column: 1/-1; padding: 30px; color: #fff;">Aucun album ne correspond aux filtres.</p>`;
    } else {
      cardsHTML = ideas.map(item => {
        const index = item.originalIndex;
        const isSelected = selectedIdeaIndices.has(index);
        const coverSrc = (item.cover && item.cover !== 'images/' && item.cover !== 'images/default.jpg') ? item.cover : '';

        const coverHTML = coverSrc 
          ? createLoadingCoverHTML(coverSrc, 'idea-cover', '💡') 
          : `<div class="idea-cover" style="background:#333; display:flex; align-items:center; justify-content:center; color:#aaa; font-size:0.8rem;">Pas d'image</div>`;

        return `
          <div class="idea-card ${isSelected ? 'selected' : ''}" data-index="${index}">
            ${coverHTML}
            <div class="idea-title">${item.title || 'Sans titre'}</div>
            <div class="idea-artist">${item.artist || 'Artiste inconnu'}</div>
            <div class="idea-duration">⏱️ ${item.duration || '00:00'}</div>
            <button type="button" class="idea-delete-btn" data-delete="${index}">🗑️</button>
          </div>
        `;
      }).join('');
    }

    const activeGenreCount = typeof currentPlannerGenreFilters !== 'undefined' ? currentPlannerGenreFilters.size : 0;
    const countSelect = selectedIdeaIndices.size;
    const appContainer = document.getElementById('app') || document.body;
    
    appContainer.innerHTML = `
      <div style="padding-bottom: 110px; padding-top: 215px; max-width: 800px; margin: 0 auto;">
        <div class="ideas-grid" id="ideas-grid-container">
          ${cardsHTML}
        </div>

        <div id="planner-floating-actions" class="fab-container">
          <div id="planner-fab-menu" class="fab-menu hidden">
            <button type="button" id="planner-btn-add" class="fab-item" onclick="if(typeof openIdeaModal==='function') openIdeaModal();">
              💽 Ajouter
            </button>
            <button type="button" id="planner-btn-convert" class="fab-item" onclick="if(typeof convertSelectedToMD==='function') convertSelectedToMD(); else if(typeof convertIdeasToMD==='function') convertIdeasToMD();" ${countSelect === 0 ? 'disabled' : ''}>
              💾 Convertir (${countSelect})
            </button>
            <button type="button" id="planner-btn-reset" class="fab-item" onclick="if(typeof clearIdeaSelection==='function') clearIdeaSelection(); else if(typeof resetPlannerSelections==='function') resetPlannerSelections();">
              🔄 Réinitialiser
            </button>
          
            <hr class="fab-divider">
          
            <button type="button" id="planner-btn-genre-toggle" class="fab-item" onclick="if(typeof togglePlannerGenreDropdown==='function') togglePlannerGenreDropdown();">
              🎵 Genres ${activeGenreCount > 0 ? '(' + activeGenreCount + ')' : ''}
            </button>
          </div>
          
          <button type="button" id="planner-fab-main-btn" class="fab-main-btn" onclick="togglePlannerFabMenu();" title="Menu planificateur">
            <span class="fab-icon">🎚️</span>
          </button>
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
          if (typeof deleteIdeaAlbum === 'function') deleteIdeaAlbum(index);
          return;
        }

        const card = e.target.closest('.idea-card');
        if (card) {
          const index = parseInt(card.getAttribute('data-index'), 10);
          if (typeof toggleIdeaSelection === 'function') toggleIdeaSelection(index);
        }
      });
    }

    window.scrollTo(0, 0);

  } catch (err) {
    console.error("Erreur dans renderCompilPlanner:", err);
  }
}

function togglePlannerFabMenu() {
  const menu = document.getElementById('planner-fab-menu');
  const btn = document.getElementById('planner-fab-main-btn');
  if (!menu) return;
  
  const isOpening = menu.classList.contains('hidden');
  menu.classList.toggle('hidden');

  // Animation de rotation du bouton
  if (btn) {
    btn.classList.toggle('open', isOpening);
  }

  if (!isOpening) {
    window.isPlannerGenreDropdownOpen = false;
    document.getElementById('planner-genre-submenu')?.remove();
  }
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
  window.isPlannerGenreDropdownOpen = !Boolean(window.isPlannerGenreDropdownOpen);
  renderPlannerGenreFilter();
}

function renderPlannerGenreFilter(savedScrollTop = 0) {
  const fabMenu = document.getElementById('planner-fab-menu');
  if (!fabMenu) return;

  const existingScrollArea = document.getElementById('planner-genre-scroll-area');
  if (existingScrollArea && savedScrollTop === 0) {
    savedScrollTop = existingScrollArea.scrollTop;
  }

  document.getElementById('planner-genre-submenu')?.remove();
  if (!window.isPlannerGenreDropdownOpen) return;

  const genresSet = new Set();
  const ideas = getIdeaList();
  ideas.forEach(item => {
    getItemGenresList(item).forEach(g => genresSet.add(g));
  });

  const genres = Array.from(genresSet).sort();
  if (genres.length === 0) return;

  const subMenu = document.createElement('div');
  subMenu.id = 'planner-genre-submenu';
  // On utilise exactement les mêmes classes que pour la vue MiniDisc
  subMenu.className = 'fab-submenu fab-genre-submenu';

  const scrollArea = document.createElement('div');
  scrollArea.id = 'planner-genre-scroll-area';
  scrollArea.className = 'fab-scrollable-submenu fab-genre-list';

  const activeFilters = typeof currentPlannerGenreFilters !== 'undefined' ? currentPlannerGenreFilters : new Set();

  const createGenreBtn = (text, isSelected, onClick) => {
    const btn = document.createElement('div');
    btn.className = `fab-genre-item ${isSelected ? 'active' : ''}`;
    btn.innerHTML = `<span>${text}</span>${isSelected ? '<span>✓</span>' : ''}`;
    btn.onclick = (e) => {
      e.stopPropagation(); // Empêche la fermeture du menu FAB
      onClick(e);
    };
    return btn;
  };

  scrollArea.appendChild(createGenreBtn('Tous les genres', activeFilters.size === 0, () => {
    if (typeof clearPlannerGenreFilters === 'function') clearPlannerGenreFilters();
  }));

  genres.forEach(g => {
    scrollArea.appendChild(createGenreBtn(g, activeFilters.has(g), () => {
      if (typeof togglePlannerGenreFilter === 'function') togglePlannerGenreFilter(g);
    }));
  });

  subMenu.appendChild(scrollArea);
  fabMenu.appendChild(subMenu);

  if (savedScrollTop > 0) {
    scrollArea.scrollTop = savedScrollTop;
  }
}

function togglePlannerGenreFilter(genre) {
  const scrollArea = document.getElementById('planner-genre-scroll-area');
  const scrollTop = scrollArea ? scrollArea.scrollTop : 0;

  if (typeof currentPlannerGenreFilters === 'undefined') window.currentPlannerGenreFilters = new Set();

  if (currentPlannerGenreFilters.has(genre)) {
    currentPlannerGenreFilters.delete(genre);
  } else {
    currentPlannerGenreFilters.add(genre);
  }

  renderCompilPlanner(false);

  // On s'assure d'enlever le hidden au lieu d'injecter du display inline
  const menu = document.getElementById('planner-fab-menu');
  if (menu) menu.classList.remove('hidden');
  window.isPlannerGenreDropdownOpen = true;

  renderPlannerGenreFilter(scrollTop);
}

function clearPlannerGenreFilters() {
  if (typeof currentPlannerGenreFilters !== 'undefined') {
    currentPlannerGenreFilters.clear();
  }
  renderCompilPlanner(false);

  // On s'assure d'enlever le hidden au lieu d'injecter du display inline
  const menu = document.getElementById('planner-fab-menu');
  if (menu) menu.classList.remove('hidden');
  window.isPlannerGenreDropdownOpen = true;

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
  if (typeof setupMultiSelectContainer === 'function') setupMultiSelectContainer('idea-genre', 'genres-list');

  const form = document.getElementById('idea-form');
  if (form) form.reset();
  const coverInput = document.getElementById('idea-cover');
  if (coverInput) coverInput.value = "";
  document.getElementById('idea-modal')?.classList.remove('hidden');
}

function closeIdeaModal() {
  document.getElementById('idea-modal')?.classList.add('hidden');
}

async function saveIdeaAlbum(e) {
  if (e) e.preventDefault();
  const title = document.getElementById('idea-title').value.trim();
  const artist = document.getElementById('idea-artist').value.trim();
  const rawGenre = document.getElementById('idea-genre').value.trim();
  const duration = document.getElementById('idea-duration').value.trim();
  const coverInput = document.getElementById('idea-cover');

  if (typeof showToast === 'function') showToast("⏳ Traitement et envoi de l'image...");

  // Upload de la pochette sur GitHub
  let coverPath = 'images/default.jpg';
  if (coverInput && coverInput.files && coverInput.files.length > 0) {
    const uploadedPath = await handleImageUpload(coverInput);
    if (uploadedPath) coverPath = uploadedPath;
  }

  const genre = rawGenre
    .split(',')
    .map(g => g.trim())
    .filter(Boolean)
    .join(', ');

  const newIdea = { title, artist, genre, duration, cover: coverPath };
  
  if (!window.ideaAlbums) window.ideaAlbums = [];
  window.ideaAlbums.push(newIdea);

  if (typeof saveLocalBackup === 'function') saveLocalBackup();
  closeIdeaModal();
  if (typeof showToast === 'function') showToast("💡 Album ajouté aux idées !");
  if (typeof renderCompilPlanner === 'function') renderCompilPlanner(false);
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

/* =======================
   CONNEXION A GITHUB
   =======================*/
// Sauvegarder le token sur le téléphone
function saveGithubToken(token) {
  localStorage.setItem('github_token', token.trim());
  alert('Token GitHub enregistré avec succès !');
}

// Récupérer le token stocké
function getGithubToken() {
  return localStorage.getItem('github_token');
}

async function syncCollectionToGithub(dataArray) {
  const token = getGithubToken();
  if (!token) {
    console.warn("Pas de token GitHub configuré. Sauvegarde locale uniquement.");
    return;
  }

  const USERNAME = 'Shinomori-cloud';
  const REPO = 'Minidiscs';
  const FILE_PATH = 'data.json'; // Chemin vers le fichier JSON dans le repo

  const url = `https://api.github.com/repos/${USERNAME}/${REPO}/contents/${FILE_PATH}`;

  try {
    // Étape A : Récupérer le SHA actuel du fichier
    const getResponse = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    let sha = '';
    if (getResponse.ok) {
      const fileData = await getResponse.json();
      sha = fileData.sha;
    }

    // Étape B : Convertir les données en JSON puis en Base64 (UTF-8 compatible)
    const jsonString = JSON.stringify(dataArray, null, 2);
    const bytes = new TextEncoder().encode(jsonString);
    const base64Content = btoa(String.fromCharCode(...bytes));

    // Étape C : Pousser la mise à jour sur GitHub
    const putResponse = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        message: 'Mise à jour automatique de la collection MiniDisc',
        content: base64Content,
        sha: sha // Nécessaire pour écraser le fichier existant
      })
    });

    if (putResponse.ok) {
      console.log("Synchronisation GitHub réussie !");
    } else {
      console.error("Erreur lors de la synchro GitHub :", await putResponse.json());
    }

  } catch (error) {
    console.error("Erreur réseau pendant la synchronisation :", error);
  }
}

// Gestion du token GitHub dans app.js
function initGithubTokenForm() {
  const tokenInput = document.getElementById('gh-token-input');
  const saveBtn = document.getElementById('save-token-btn');

  if (!saveBtn || !tokenInput) return;

  tokenInput.value = getGithubToken() || '';

  saveBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const val = tokenInput.value;
    if (val) {
      saveGithubToken(val);
    } else {
      localStorage.removeItem('github_token');
      alert('Token supprimé.');
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGithubTokenForm);
} else {
  initGithubTokenForm();
}

async function handleImageUpload(fileInput) {
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    return null; // Aucun fichier sélectionné
  }

  const file = fileInput.files[0];
  const token = getGithubToken();

  if (!token) {
    console.warn("Pas de token GitHub disponible. Impossible d'envoyer l'image.");
    return null;
  }

  // Nom de fichier unique basé sur le horodatage pour éviter d'écraser des images existantes
  const extension = file.name.split('.').pop().toLowerCase();
  const fileName = `img_${Date.now()}.${extension}`;
  const filePath = `images/${fileName}`;

  const USERNAME = 'Shinomori-cloud';
  const REPO = 'Minidiscs';
  const url = `https://api.github.com/repos/${USERNAME}/${REPO}/contents/${filePath}`;

  try {
    // Lecture du fichier local en Base64
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });

    // Envoi à l'API GitHub
    const putResponse = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        message: `Ajout automatique de l'image ${fileName}`,
        content: base64Data
      })
    });

    if (putResponse.ok) {
      console.log(`Image envoyée sur GitHub : ${filePath}`);
      return filePath;
    } else {
      console.error("Erreur lors de l'envoi de l'image sur GitHub :", await putResponse.json());
      return null;
    }
  } catch (err) {
    console.error("Erreur réseau pendant le chargement de l'image :", err);
    return null;
  }
}

/* ==========================================
   HELPER D'AFFICHAGE DES IMAGES (NOW LOADING)
   ========================================== */
function createLoadingCoverHTML(srcPath, cssClass = '') {
  // S'il n'y a vraiment aucun chemin renseigné
  if (!srcPath || srcPath.trim() === '' || srcPath === 'images/' || srcPath === 'images/default.jpg') {
    return `
      <div class="cover-wrapper ${cssClass}" style="position: relative; background: #111; overflow: hidden; display: flex; align-items: center; justify-content: center; border: 1px solid #333;">
        <span style="color: #666; font-family: monospace; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1px; text-align: center; padding: 4px;">PAS D'IMAGE</span>
      </div>
    `;
  }

  // Si une image est renseignée, on affiche l'effet NOW LOADING...
  return `
    <div class="cover-wrapper ${cssClass}" style="position: relative; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center; border: 1px solid #333;">
      <span class="now-loading-text" style="color: #00ff66; font-family: monospace; font-size: 0.75rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; animation: pulseLoading 1.2s infinite; text-shadow: 0 0 5px rgba(0,255,102,0.6); pointer-events: none; text-align: center; padding: 4px;">NOW LOADING...</span>
      <img 
        src="${srcPath}" 
        alt="Cover"
        onload="this.previousElementSibling.style.display='none'; this.style.opacity='1';"
        onerror="this.style.opacity='0'; this.previousElementSibling.style.display='block'; this.previousElementSibling.textContent='NOW LOADING...';"
        style="position: absolute; top:0; left:0; width:100%; height:100%; object-fit: cover; opacity: 0; transition: opacity 0.4s ease;"
      >
    </div>
  `;
}
