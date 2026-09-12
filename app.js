/* ==========================================
   VARIABLES GLOBALES & ÉLÉMENTS DOM
   ========================================== */
let catalogData = null;
let currentMD = null;
let currentAlbum = null;
let currentGenreFilter = null;
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
  const fabBtn = document.getElementById('search-fab-btn');

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
  renderMDList({ record: currentRecordFilter }, false);
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
  const fabBtn = document.getElementById('search-fab-btn');

  if (show) {
    if (floatingActions) floatingActions.classList.remove('hidden');
    if (typeof updateFilterIcon === 'function') {
      updateFilterIcon();
    }
  } else {
    if (floatingActions) floatingActions.classList.add('hidden');
    if (fabBtn) fabBtn.textContent = '🔍';
    if (topSearch) topSearch.classList.add('closed');
    
    currentSearchQuery = '';
    if (searchInput) searchInput.value = '';
  }
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
      openMD(currentMD, true);
    } else if (currentMD !== null) {
      renderMDList({ genre: currentGenreFilter, type: currentTypeFilter }, true);
    } else {
      renderDashboard(true);
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

    const hash = window.location.hash;
    if (hash.startsWith('#planner')) {
      renderCompilPlanner(false);
    } else if (hash.startsWith('#minidiscs')) {
      const urlParams = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
      const genre = urlParams.get('genre');
      const type = urlParams.get('type');
      renderMDList({ genre, type }, false);
    } else if (hash.startsWith('#md-')) {
      const mdIndex = parseInt(hash.replace('#md-', ''), 10);
      if (!isNaN(mdIndex) && catalogData[mdIndex]) {
        openMD(mdIndex, false);
      } else {
        renderDashboard(false);
      }
    } else {
      renderDashboard(false);
    }
  })
  .catch(err => {
    const savedBackup = localStorage.getItem(STORAGE_KEY);
    if (savedBackup) {
      try {
        const parsedBackup = JSON.parse(savedBackup);
        processLoadedData(parsedBackup);
        hasUnsavedChanges = true;
        showToast("⚡ Données chargées depuis la sauvegarde locale !");
        renderDashboard(false);
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
  currentGenreFilter = null;
  currentTypeFilter = null;
  if (backBtn) backBtn.classList.add('hidden');
  if (headerTitle) headerTitle.textContent = "MINIDISCS";

  updateSearchVisibility(false);

  if (catalogData === null) {
    app.innerHTML = `<p style="text-align:center; padding: 40px; color: var(--text-sub);">Chargement de la collection...</p>`;
    return;
  }

  if (featuredContainer) featuredContainer.classList.add('hidden');

  if (pushState && window.location.hash !== '#dashboard') {
    history.pushState({ view: 'dashboard' }, '', '#dashboard');
  }

  const totalMD = catalogData.length;
  const genreCounts = {};
  const typeCounts = {};

  catalogData.forEach(md => {
    getMDAllGenres(md).forEach(g => genreCounts[g] = (genreCounts[g] || 0) + 1);
    getMDAllTypes(md).forEach(t => typeCounts[t] = (typeCounts[t] || 0) + 1);
  });

  let typeBadgesHTML = '';
  Object.keys(typeCounts).sort((a,b) => typeCounts[b] - typeCounts[a]).forEach(t => {
    typeBadgesHTML += `
      <div class="genre-badge" style="border-left-color: #ff007f;" onclick="renderMDList({ type: '${t}' })">
        <span class="genre-name" style="color:#ff007f">${t}</span>
        <span class="genre-count">${typeCounts[t]}</span>
      </div>
    `;
  });

  let genreBadgesHTML = '';
  Object.keys(genreCounts).sort((a,b) => genreCounts[b] - genreCounts[a]).forEach(g => {
    const color = getBorderColor(g);
    genreBadgesHTML += `
      <div class="genre-badge" style="border-left-color: ${color};" onclick="renderMDList({ genre: '${g}' })">
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

      <button class="btn-primary" style="margin-top: 16px; margin-bottom: 8px; width: 100%;" onclick="renderMDList({})">
        VOIR TOUS LES MINIDISCS &rarr;
      </button>

      <div class="dashboard-actions-row">
        <button class="action-btn-wide" onclick="renderCompilPlanner()">
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

  renderFeatured();
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

  selectedIdeaIndices.forEach(idx => {
    if (ideas[idx]) {
      const item = ideas[idx];
      totalSeconds += parseTimeToSeconds(item.duration);

      selectedHTML += `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; gap: 8px;">
          <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #000; font-weight: 600;">
            🎵 <span style="color: #666;">${item.artist}</span> - ${item.title}
          </div>
          <div style="font-weight: 700; color: #000; white-space: nowrap;">⏱️ ${item.duration}</div>
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
    convertBtn.textContent = `💾 Convertir en MD (${selectedIdeaIndices.size})`;
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
    } else {
      card.classList.remove('disabled-card');
    }
  });
}

function clearPlannerHeaderInfo() {
  const badge = document.getElementById('header-planner-badge');
  if (badge) badge.remove();

  const genreFilter = document.getElementById('planner-genre-filter');
  if (genreFilter) genreFilter.style.display = 'none';

  isPlannerGenreDropdownOpen = false;
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

function renderPlannerGenreFilter() {
  const container = document.getElementById('planner-genre-filter');
  const tagsCloud = document.getElementById('planner-tags-list');
  if (!container || !tagsCloud) return;

  // Extraction uniquement des genres présents dans la collection principale de MiniDiscs (catalogData)
  const genresSet = new Set();
  
  if (catalogData && Array.isArray(catalogData)) {
    catalogData.forEach(md => {
      if (typeof getMDAllGenres === 'function') {
        getMDAllGenres(md).forEach(g => genresSet.add(g.trim().toUpperCase()));
      } else if (md.genre) {
        const gList = Array.isArray(md.genre) ? md.genre : md.genre.split(',');
        gList.forEach(g => genresSet.add(g.trim().toUpperCase()));
      }
    });
  }

  const genres = Array.from(genresSet).filter(Boolean).sort();

  if (genres.length === 0) {
    container.style.display = 'none';
    tagsCloud.innerHTML = '';
    return;
  }

  container.style.display = 'block';

  const activeCount = currentPlannerGenreFilters.size;
  const btnLabel = activeCount > 0 
    ? `🏷️ Genres (${activeCount}) ${isPlannerGenreDropdownOpen ? '▴' : '▾'}`
    : `🏷️ Filtrer par genre ${isPlannerGenreDropdownOpen ? '▴' : '▾'}`;

  let html = `
    <button type="button" class="action-btn-dropdown" onclick="togglePlannerGenreDropdown()" style="padding: 6px 14px; border-radius: 20px; font-weight: bold; background: var(--bg-card, #222); color: var(--text-main, #fff); border: 1px solid rgba(255,255,255,0.2); cursor: pointer;">
      ${btnLabel}
    </button>
  `;

  if (isPlannerGenreDropdownOpen) {
    html += `
      <div class="genre-dropdown-menu" style="margin-top: 8px; padding: 10px; background: rgba(25, 25, 25, 0.95); backdrop-filter: blur(10px); border-radius: 12px; border: 1px solid rgba(255,255,255,0.15); display: flex; flex-wrap: wrap; gap: 6px; max-height: 180px; overflow-y: auto;">
        <button type="button" class="tag-btn ${currentPlannerGenreFilters.size === 0 ? 'active' : ''}" onclick="clearPlannerGenreFilters()" style="font-size: 0.8rem; padding: 4px 10px;">
          Tous
        </button>
    `;

    genres.forEach(genre => {
      const isActive = currentPlannerGenreFilters.has(genre);
      html += `
        <button type="button" class="tag-btn ${isActive ? 'active' : ''}" onclick="togglePlannerGenre('${genre.replace(/'/g, "\\'")}')" style="font-size: 0.8rem; padding: 4px 10px; border-radius: 15px;">
          ${isActive ? '✓ ' : ''}${genre}
        </button>
      `;
    });

    html += `</div>`;
  }

  tagsCloud.innerHTML = html;
}

function togglePlannerGenreDropdown() {
  isPlannerGenreDropdownOpen = !isPlannerGenreDropdownOpen;
  renderPlannerGenreFilter();
}

function togglePlannerGenre(genre) {
  if (currentPlannerGenreFilters.has(genre)) {
    currentPlannerGenreFilters.delete(genre);
  } else {
    currentPlannerGenreFilters.add(genre);
  }
  renderCompilPlanner(false);
}

function clearPlannerGenreFilters() {
  currentPlannerGenreFilters.clear();
  renderCompilPlanner(false);
}

function renderCompilPlanner(pushState = true) {
   const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
   if (fa) fa.style.display = 'none';
   
  if (pushState && window.location.hash !== '#planner') {
    window.location.hash = '#planner';
    return;
  }
   
  currentMD = null;
  currentAlbum = null;
  if (backBtn) backBtn.classList.remove('hidden');
  if (headerTitle) headerTitle.textContent = "PLANIFICATEUR";

  injectPlannerHeaderBadge();

  if (featuredContainer) featuredContainer.classList.add('hidden');

  const rawIdeas = getIdeaList();

  // Filtrage des idées par sélection multiple de genres
  let filteredIdeas = rawIdeas.map((item, originalIndex) => ({ ...item, originalIndex }));
  if (currentPlannerGenreFilters.size > 0) {
    filteredIdeas = filteredIdeas.filter(item => {
      if (!item.genre) return false;
      const itemGenres = Array.isArray(item.genre) 
        ? item.genre.map(g => g.trim().toUpperCase())
        : item.genre.split(',').map(g => g.trim().toUpperCase());
      return itemGenres.some(g => currentPlannerGenreFilters.has(g));
    });
  }

  const ideas = dailyShuffle(filteredIdeas, '-planner');

  let cardsHTML = '';
  if (ideas.length === 0) {
    cardsHTML = `<p class="planner-text-white" style="text-align:center; grid-column: 1/-1; padding: 30px;">Aucun album trouvé${currentPlannerGenreFilters.size > 0 ? ' pour ce(s) genre(s)' : ''}.</p>`;
  } else {
    ideas.forEach((item) => {
      const index = item.originalIndex;
      const isSelected = selectedIdeaIndices.has(index);
      const coverSrc = (item.cover && item.cover !== 'images/') ? item.cover : '';

      cardsHTML += `
        <div class="idea-card ${isSelected ? 'selected' : ''}" data-index="${index}">
          ${coverSrc 
            ? `<img src="${coverSrc}" class="idea-cover" alt="cover">` 
            : `<div class="idea-cover" style="background:#333; display:flex; align-items:center; justify-content:center; color:#aaa; font-size:0.8rem;">Pas d'image</div>`
          }
          <div class="idea-title" title="${item.title}">${item.title}</div>
          <div class="idea-artist" title="${item.artist}">${item.artist}</div>
          <div class="idea-duration">⏱️ ${item.duration}</div>
          <button type="button" class="idea-delete-btn" data-delete="${index}" title="Supprimer cet album">🗑️</button>
        </div>
      `;
    });
  }
   
  app.innerHTML = `
    <div style="padding-bottom: 90px; padding-top: 215px;">
      <div class="ideas-grid" id="ideas-grid-container">
        ${cardsHTML}
      </div>

      <div style="position: fixed; bottom: 15px; left: 0; right: 0; display: flex; justify-content: center; padding: 0 15px; pointer-events: none; z-index: 1000;">
        <div class="compil-actions" style="display:flex; gap:10px; max-width: 500px; width:100%; justify-content: center; background: rgba(30, 30, 30, 0.85); backdrop-filter: blur(10px); padding: 10px 15px; border-radius: 30px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); pointer-events: auto;">
          <button type="button" class="btn-primary" id="planner-btn-add" style="flex:1; border-radius:20px;">＋ Ajouter un Album</button>
          <button type="button" class="btn-secondary" id="planner-btn-convert" ${selectedIdeaIndices.size === 0 ? 'disabled' : ''} style="flex:1; border-radius:20px;">
            💾 Convertir en MD (${selectedIdeaIndices.size})
          </button>
          <button type="button" class="btn-sub" id="planner-btn-reset" style="flex:1; border-radius:20px;">Réinitialiser la sélection</button>
        </div>
      </div>
    </div>
  `;

  renderPlannerGenreFilter();
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
        if (selectedIdeaIndices.has(index)) {
          selectedIdeaIndices.delete(index);
          card.classList.remove('selected');
        } else {
          selectedIdeaIndices.add(index);
          card.classList.add('selected');
        }
        updatePlannerHeader();
      }
    });
  }

  const addBtn = document.getElementById('planner-btn-add');
  if (addBtn) addBtn.addEventListener('click', openIdeaModal);

  const convertBtn = document.getElementById('planner-btn-convert');
  if (convertBtn) convertBtn.addEventListener('click', convertSelectedToMD);

  const resetBtn = document.getElementById('planner-btn-reset');
  if (resetBtn) resetBtn.addEventListener('click', clearIdeaSelection);
}

function deleteIdeaAlbum(index) {
  const ideas = getIdeaList();
  if (!ideas[index]) return;

  if (confirm(`Supprimer "${ideas[index].title}" de vos idées ?`)) {
    ideas.splice(index, 1);
    
    const updatedIndices = new Set();
    selectedIdeaIndices.forEach(i => {
      if (i > index) updatedIndices.add(i - 1);
      else if (i < index) updatedIndices.add(i);
    });
    selectedIdeaIndices = updatedIndices;

    saveLocalBackup();
    showToast("🗑️ Album supprimé des idées");
    renderCompilPlanner(false);
  }
}

function clearIdeaSelection() {
  selectedIdeaIndices.clear();
  renderCompilPlanner(false);
}

function openIdeaModal() {
  populateFormDatalists();
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

  saveLocalBackup();
  closeIdeaModal();
  showToast("💡 Album ajouté aux idées !");
  renderCompilPlanner(false);
}

function convertSelectedToMD() {
  if (selectedIdeaIndices.size === 0) return;

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

  catalogData.push(newMD);

  window.ideaAlbums = ideas.filter((_, idx) => !selectedIdeaIndices.has(idx));
  selectedIdeaIndices.clear();

  clearPlannerHeaderInfo();
  saveLocalBackup();
  showToast("🎉 Albums convertis en MiniDisc avec succès !");
  renderDashboard(true);
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
