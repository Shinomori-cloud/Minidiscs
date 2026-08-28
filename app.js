/* ==========================================
   VARIABLES GLOBALES & ÉLÉMENTS DOM
   ========================================== */
let catalogData = null;
let currentMD = null;
let currentAlbum = null;
let currentGenreFilter = null;
let currentTypeFilter = null;
let adminAlbumCount = 0;
let editingMDIndex = null;
let toastTimeout = null;

const app = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const featuredContainer = document.getElementById('featured-container');

/* ==========================================
   UTILITAIRE TOAST (NOTIFICATIONS VISUELLES)
   ========================================== */
function showToast(message, duration = 2500) {
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
   GESTION STRICTE DE L'HISTORIQUE HERMIT
   ========================================== */
if (!window.location.hash || window.location.hash === '#') {
  window.history.replaceState({ view: 'dashboard' }, '', '#dashboard');
}

window.addEventListener('popstate', (e) => {
  if (!e.state || window.location.hash === '' || window.location.hash === '#dashboard') {
    renderDashboard(false);
    window.history.replaceState({ view: 'dashboard' }, '', '#dashboard');
    return;
  }

  switch (e.state.view) {
    case 'dashboard':
      renderDashboard(false);
      break;
    case 'minidiscs':
      renderMDList({ genre: e.state.genre || null, type: e.state.type || null }, false);
      break;
    case 'albums':
    case 'tracklist':
      if (e.state.mdIndex !== undefined) {
        if (e.state.albumIndex !== undefined) {
          openAlbum(e.state.mdIndex, e.state.albumIndex, false);
        } else {
          openMD(e.state.mdIndex, false);
        }
      } else {
        renderMDList({}, false);
      }
      break;
    default:
      renderDashboard(false);
  }
});

/* ==========================================
   INITIALISATION DATA & ÉCOUTEURS GLOBAUX
   ========================================== */
backBtn.addEventListener('click', () => {
  if (currentAlbum !== null) {
    openMD(currentMD, true);
  } else if (currentMD !== null) {
    renderMDList({ genre: currentGenreFilter, type: currentTypeFilter }, true);
  } else {
    renderDashboard(true);
  }
});

fetch('data.json')
  .then(response => {
    if (!response.ok) throw new Error("Erreur de réseau lors du chargement du fichier JSON.");
    return response.json();
  })
  .then(data => {
    catalogData = data;
    
    const hash = window.location.hash;
    if (hash.startsWith('#minidiscs')) {
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
    catalogData = [];
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

function formatAlbumTitles(rawTitle) {
  if (!rawTitle) return '';
  return rawTitle.split(' / ').map(t => `<div class="title-line">${t.trim()}</div>`).join('');
}

/* ==========================================
   SÉLECTION DU MOMENT (24H)
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
  currentMD = null;
  currentAlbum = null;
  currentGenreFilter = null;
  currentTypeFilter = null;
  backBtn.classList.add('hidden');
  headerTitle.textContent = "MINIDISCS";

  if (catalogData === null) {
    app.innerHTML = `<p style="text-align:center; padding: 40px; color: var(--text-sub);">Chargement de la collection...</p>`;
    return;
  }

  if (featuredContainer) {
    featuredContainer.classList.remove('hidden');
    renderFeatured();
  }

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

  app.innerHTML = `
    <div class="dashboard-container">
      <div class="dashboard-card">
        <div class="dashboard-stat-main">
          <span class="stat-number">${totalMD}</span>
          <span class="stat-label">MiniDiscs dans la collection</span>
        </div>
        
        <div class="dashboard-section-title">RÉPARTITION PAR TYPE</div>
        <div class="genres-grid">${typeBadgesHTML}</div>

        <div class="dashboard-section-title" style="margin-top: 14px;">RÉPARTITION PAR GENRE</div>
        <div class="genres-grid">${genreBadgesHTML}</div>

        <button class="btn-primary" style="margin-top: 10px;" onclick="renderMDList({})">
          VO
