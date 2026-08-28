/* ==========================================
   VARIABLES GLOBALES ET ÉTAT DE L'APPLICATION
   ========================================== */
let catalogData = null;
let currentSearchQuery = '';
let currentMD = null;
let currentAlbum = null;
let currentGenreFilter = null;
let currentTypeFilter = null;
let editingMDIndex = null;
let adminAlbumCount = 0;
let hasUnsavedChanges = false;

// Éléments DOM principaux
const app = document.getElementById('app');
const headerTitle = document.getElementById('header-title');
const backBtn = document.getElementById('back-btn');
const featuredContainer = document.getElementById('featured-container');
const toast = document.getElementById('toast');

/* ==========================================
   INITIALISATION ET CHARGEMENT
   ========================================== */
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupNavigation();
  setupSearchListeners();
});

function initApp() {
  const localBackup = localStorage.getItem('catalogData_backup');
  if (localBackup) {
    try {
      catalogData = JSON.parse(localBackup);
      hasUnsavedChanges = true;
      handleInitialRoute();
      return;
    } catch (e) {
      console.error("Erreur de lecture du backup local", e);
    }
  }

  fetch('data.json')
    .then(res => res.json())
    .then(data => {
      catalogData = data;
      hasUnsavedChanges = false;
      handleInitialRoute();
    })
    .catch(err => {
      console.error("Erreur de chargement du JSON", err);
      if (app) app.innerHTML = `<p style="text-align:center; padding: 40px; color: #e63946;">Erreur de chargement des données.</p>`;
    });
}

function saveLocalBackup() {
  if (catalogData) {
    localStorage.setItem('catalogData_backup', JSON.stringify(catalogData));
    hasUnsavedChanges = true;
  }
}

function clearLocalBackup() {
  localStorage.removeItem('catalogData_backup');
  hasUnsavedChanges = false;
}

function showToast(message, duration = 3000) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.classList.add('visible');
  setTimeout(() => {
    toast.classList.remove('visible');
    toast.classList.add('hidden');
  }, duration);
}

/* ==========================================
   ROUTAGE ET NAVIGATION HASH
   ========================================== */
function handleInitialRoute() {
  const hash = window.location.hash;
  
  if (hash.startsWith('#md-')) {
    const albumMatch = hash.match(/^#md-(\d+)-album-(\d+)$/);
    const mdMatch = hash.match(/^#md-(\d+)$/);

    if (albumMatch) {
      openAlbum(parseInt(albumMatch[1]), parseInt(albumMatch[2]), false);
    } else if (mdMatch) {
      openMD(parseInt(mdMatch[1]), false);
    } else {
      renderDashboard(false);
    }
  } else if (hash.startsWith('#minidiscs')) {
    const params = new URLSearchParams(hash.split('?')[1] || '');
    renderMDList({ genre: params.get('genre'), type: params.get('type') }, false);
  } else {
    renderDashboard(false);
  }
}

function setupNavigation() {
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.view) {
      switch (e.state.view) {
        case 'dashboard':
          renderDashboard(false);
          break;
        case 'minidiscs':
          renderMDList({ genre: e.state.genre, type: e.state.type }, false);
          break;
        case 'albums':
        case 'tracklist':
          if (e.state.albumIndex !== undefined) {
            openAlbum(e.state.mdIndex, e.state.albumIndex, false);
          } else if (e.state.mdIndex !== undefined) {
            openMD(e.state.mdIndex, false);
          }
          break;
      }
    } else {
      handleInitialRoute();
    }
  });

  if (backBtn) {
    backBtn.addEventListener('click', goBack);
  }
}

function goBack() {
  if (currentAlbum !== null) {
    openMD(currentMD);
  } else if (currentMD !== null) {
    renderMDList({ genre: currentGenreFilter, type: currentTypeFilter });
  } else {
    renderDashboard();
  }
}

/* ==========================================
   RECHERCHE ET FILTRES
   ========================================== */
function setupSearchListeners() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value.toLowerCase().trim();
      renderMDList({ genre: currentGenreFilter, type: currentTypeFilter }, false);
    });
  }
}

function toggleSearch() {
  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  const fabBtn = document.getElementById('search-fab-btn');

  if (!searchBar) return;

  const isOpen = searchBar.classList.contains('open');

  if (isOpen) {
    searchBar.classList.remove('open');
    searchBar.classList.add('closed');
    if (fabBtn) fabBtn.textContent = '🔍';
    if (currentSearchQuery !== '') {
      currentSearchQuery = '';
      if (searchInput) searchInput.value = '';
      renderMDList({ genre: currentGenreFilter, type: currentTypeFilter }, false);
    }
  } else {
    searchBar.classList.remove('closed');
    searchBar.classList.add('open');
    if (fabBtn) fabBtn.textContent = '✕';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (searchInput) searchInput.focus();
  }
}

function updateSearchVisibility(show) {
  const fabBtn = document.getElementById('search-fab-btn');
  const searchBar = document.getElementById('search-bar');
  
  if (fabBtn) fabBtn.style.display = show ? 'flex' : 'none';
  if (!show && searchBar) {
    searchBar.classList.remove('open');
    searchBar.classList.add('closed');
    if (fabBtn) fabBtn.textContent = '🔍';
  }
}

/* ==========================================
   UTILITAIRES DE DONNÉES
   ========================================== */
function getMDAllGenres(md) {
  const set = new Set();
  if (Array.isArray(md.genre)) md.genre.forEach(g => set.add(g.toUpperCase().trim()));
  else if (md.genre) set.add(md.genre.toUpperCase().trim());

  if (md.albums) {
    md.albums.forEach(a => {
      if (Array.isArray(a.genre)) a.genre.forEach(g => set.add(g.toUpperCase().trim()));
      else if (a.genre) set.add(a.genre.toUpperCase().trim());
    });
  }
  return Array.from(set);
}

function getMDAllTypes(md) {
  const set = new Set();
  if (Array.isArray(md.type)) md.type.forEach(t => set.add(t.toUpperCase().trim()));
  else if (md.type) set.add(md.type.toUpperCase().trim());

  if (md.albums) {
    md.albums.forEach(a => {
      if (Array.isArray(a.type)) a.type.forEach(t => set.add(t.toUpperCase().trim()));
      else if (a.type) set.add(a.type.toUpperCase().trim());
    });
  }
  if (set.size === 0) set.add('ALBUM');
  return Array.from(set);
}

function getAlbumGenres(album, md) {
  if (Array.isArray(album.genre) && album.genre.length > 0) return album.genre.map(g => g.toUpperCase().trim());
  if (typeof album.genre === 'string' && album.genre.trim() !== '') return [album.genre.toUpperCase().trim()];
  return getMDAllGenres(md);
}

function getBorderColor(genres) {
  const gList = Array.isArray(genres) ? genres : [genres];
  const primary = gList[0] ? gList[0].toUpperCase() : '';

  const colorMap = {
    'ROCK': '#e63946',
    'POP': '#ff007f',
    'JAZZ': '#ffb703',
    'ELECTRO': '#00f5d4',
    'RAP': '#7209b7',
    'HIP-HOP': '#7209b7',
    'METAL': '#d62828',
    'CLASSICAL': '#4a4e69',
    'REGGAE': '#52b788',
    'BLUES': '#0077b6'
  };

  return colorMap[primary] || '#40e0d0';
}

function formatAlbumTitles(titleString) {
  if (!titleString) return '';
  return titleString.split(' / ').map(t => `<span class="title-part">${t}</span>`).join(' / ');
}

function dailyShuffle(array, seedSuffix = '') {
  const today = new Date().toISOString().slice(0, 10);
  let seed = 0;
  const str = today + seedSuffix;
  for (let i = 0; i < str.length; i++) {
    seed = (seed << 5) - seed + str.charCodeAt(i);
    seed |= 0;
  }
  
  const pseudoRandom = () => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };

  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(pseudoRandom() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function mdMatchesSearch(md, query) {
  if (!query) return true;
  if (md.title && md.title.toLowerCase().includes(query)) return true;
  if (md.artist && md.artist.toLowerCase().includes(query)) return true;
  
  const genres = getMDAllGenres(md);
  if (genres.some(g => g.toLowerCase().includes(query))) return true;

  const types = getMDAllTypes(md);
  if (types.some(t => t.toLowerCase().includes(query))) return true;

  if (md.tracks && md.tracks.some(t => t.toLowerCase().includes(query))) return true;

  if (md.albums) {
    return md.albums.some(a => {
      if (a.title && a.title.toLowerCase().includes(query)) return true;
      if (a.artist && a.artist.toLowerCase().includes(query)) return true;
      if (a.tracks && a.tracks.some(t => t.toLowerCase().includes(query))) return true;
      return false;
    });
  }
  return false;
}

/* ==========================================
   FONCTIONS DE RENDU DE VUES
   ========================================== */

/* 1. DASHBOARD */
function renderDashboard(pushState = true) {
  currentMD = null;
  currentAlbum = null;
  currentGenreFilter = null;
  currentTypeFilter = null;
  
  if (backBtn) backBtn.classList.add('hidden');
  updateSearchVisibility(false);
  if (headerTitle) headerTitle.textContent = "COLLECTION";

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
        ${hasUnsavedChanges ? `<div style="background: #ffb703; color: #000; padding: 8px 12px; border-radius: 6px; font-size: 0.85rem; font-weight: bold; margin-bottom: 15px; text-align: center;">⚠️ Vous avez des modifications non exportées en JSON.</div>` : ''}
        <div class="dashboard-stat-main">
          <span class="stat-number">${totalMD}</span>
          <span class="stat-label">MiniDiscs dans la collection</span>
        </div>
        
        <div class="dashboard-section-title">RÉPARTITION PAR TYPE</div>
        <div class="genres-grid">${typeBadgesHTML}</div>

        <div class="dashboard-section-title" style="margin-top: 14px;">RÉPARTITION PAR GENRE</div>
        <div class="genres-grid">${genreBadgesHTML}</div>

        <button class="btn-primary" style="margin-top: 10px;" onclick="renderMDList({})">
          VOIR TOUS LES MINIDISCS &rarr;
        </button>

        <div class="dashboard-footer">
          <button class="btn-add-md" onclick="openAdminModal()">＋ Ajouter un MD</button>
        </div>
      </div>
    </div>
  `;
  window.scrollTo(0, 0);
}

function renderFeatured() {
  if (!catalogData || catalogData.length === 0 || !featuredContainer) return;
  const shuffled = dailyShuffle(catalogData, '-featured');
  const featured = shuffled[0];
  const originalIndex = catalogData.indexOf(featured);
  
  const genres = getMDAllGenres(featured);
  const title = (featured.albums && featured.albums.length > 0)
    ? featured.albums.map(a => a.title).join(' / ')
    : (featured.title || 'MiniDisc');

  featuredContainer.innerHTML = `
    <div class="featured-card" onclick="openMD(${originalIndex})">
      <div class="featured-tag">DÉCOUVERTE DU JOUR</div>
      <div class="featured-title">${formatAlbumTitles(title)}</div>
      <div class="featured-sub">${genres.join(' / ')}</div>
    </div>
  `;
}

/* 2. LISTE DES MINIDISCS */
function renderMDList(filters = {}, pushState = true) {
  if (catalogData === null) return;
  const { genre = null, type = null } = filters;
  
  currentMD = null;
  currentAlbum = null;
  currentGenreFilter = genre;
  currentTypeFilter = type;
  if (backBtn) backBtn.classList.remove('hidden');

  updateSearchVisibility(true);

  if (headerTitle) {
    headerTitle.textContent = genre ? genre.toUpperCase() : (type ? type.toUpperCase() : "COLLECTION");
  }

  if (featuredContainer) featuredContainer.classList.add('hidden');

  if (pushState) {
    let urlHash = '#minidiscs';
    const params = [];
    if (genre) params.push(`genre=${encodeURIComponent(genre)}`);
    if (type) params.push(`type=${encodeURIComponent(type)}`);
    if (params.length > 0) urlHash += '?' + params.join('&');
    history.pushState({ view: 'minidiscs', genre, type }, '', urlHash);
  }

  let filteredCatalog = catalogData.map((md, originalIndex) => ({ md, originalIndex }));
  
  if (genre) {
    filteredCatalog = filteredCatalog.filter(({ md }) => getMDAllGenres(md).includes(genre.toUpperCase().trim()));
  }
  if (type) {
    filteredCatalog = filteredCatalog.filter(({ md }) => getMDAllTypes(md).includes(type.toUpperCase().trim()));
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
      const rawTitle = (md.albums && md.albums.length > 0) 
        ? md.albums.map(a => a.title).join(' / ') 
        : (md.title || 'MiniDisc sans titre');

      html += `
        <div class="list-item" style="border-color: ${borderColor}; border-left-width: 6px;" onclick="openMD(${originalIndex})">
          <img class="md-thumb" src="${md.md_cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'48\\' height=\\'68\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23e5e7eb\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'20\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>💽</text></svg>'">
          <div class="item-details">
            <div class="item-tag" style="color: ${borderColor};">${allGenres.join(' / ')}</div>
            <div class="item-title">${formatAlbumTitles(rawTitle)}</div>
          </div>
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
  if (!catalogData || !catalogData[index]) return;

  currentMD = index;
  currentAlbum = null;
  if (backBtn) backBtn.classList.remove('hidden');

  updateSearchVisibility(false);

  if (featuredContainer) featuredContainer.classList.add('hidden');

  const md = catalogData[index];
  const allMdGenres = getMDAllGenres(md);
  const borderColor = getBorderColor(allMdGenres);

  const adminControls = `
    <div class="md-admin-controls" style="margin-bottom: 15px; display: flex; gap: 10px;">
      <button class="btn-primary" style="background-color: #ffb703; color: #000; padding: 6px 12px; font-size: 0.85rem;" onclick="event.stopPropagation(); openAdminModal(${index})">✏️ Modifier</button>
      <button class="btn-primary" style="background-color: #e63946; color: #fff; padding: 6px 12px; font-size: 0.85rem;" onclick="event.stopPropagation(); deleteMD(${index})">🗑️ Supprimer</button>
    </div>
  `;

  if (!md.albums || md.albums.length === 0) {
    if (headerTitle) headerTitle.textContent = "PISTES";
    if (pushState) history.pushState({ view: 'tracklist', mdIndex: index, isDirectTracks: true }, '', `#md-${index}`);

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

    app.innerHTML = `
      <div class="track-container">
        ${adminControls}
        <div class="album-header">
          <img class="album-cover-large" src="${md.md_cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'150\\' height=\\'150\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'36\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>💽</text></svg>'">
          <div>
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

  if (headerTitle) headerTitle.textContent = allMdGenres.join(' / ') || "ALBUMS";
  if (pushState) history.pushState({ view: 'albums', mdIndex: index }, '', `#md-${index}`);

  let html = `<div class="list-container">${adminControls}`;
  md.albums.forEach((album, aIndex) => {
    const albumGenres = getAlbumGenres(album, md);
    const albumColor = getBorderColor(albumGenres);

    html += `
      <div class="list-item" style="border-color: ${albumColor}; border-left-width: 6px;" onclick="openAlbum(${index}, ${aIndex})">
        <img class="album-thumb" src="${album.cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'100\\' height=\\'100\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'24\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>🎵</text></svg>'">
        <div class="item-details">
          <div class="item-tag" style="color: ${albumColor};">${albumGenres.join(' / ')}</div>
          <div class="item-title" style="font-weight: 700;">${album.title || 'Album sans titre'}</div>
          <div class="item-sub">${album.artist || 'Artiste inconnu'}</div>
          ${album.year ? `<div class="item-sub" style="font-size:0.78rem;">${album.year}</div>` : ''}
        </div>
      </div>
    `;
  });
  html += '</div>';
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/* 4. VUE TRACKLIST ALBUM SPÉCIFIQUE */
function openAlbum(mdIndex, albumIndex, pushState = true) {
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

  if (headerTitle) headerTitle.textContent = "PISTES";
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

  app.innerHTML = `
    <div class="track-container">
      <div class="album-header">
        <img class="album-cover-large" src="${album.cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'150\\' height=\\'150\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'36\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>🎵</text></svg>'">
        <div>
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
  editingMDIndex = indexToEdit;
  const modalTitle = document.querySelector('#admin-modal h3');
  const albumsContainer = document.getElementById('albums-container');
  if (albumsContainer) albumsContainer.innerHTML = '';
  adminAlbumCount = 0;

  if (editingMDIndex !== null) {
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
      });
    }

  } else {
    if (modalTitle) modalTitle.textContent = "＋ Ajouter un MiniDisc";
    const form = document.getElementById('md-form');
    if (form) form.reset();
    document.getElementById('md-cover').value = "images/";
    const radioCompil = document.querySelector('input[name="md-type"][value="compil"]');
    if (radioCompil) radioCompil.checked = true;
    toggleAdminType(false);
  }

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

  const container = document.getElementById('albums-container');
  if (!isCompil && !isInit && container && container.children.length === 0) {
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
  `;
  container.appendChild(div);
}

function removeAdminAlbumBlock(button) {
  const block = button.closest('.album-block');
  if (block) {
    block.remove();
  }
}

function submitNewMD() {
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
        tracks: formattedTracks
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
  if (!catalogData || catalogData.length === 0) {
    showToast("⚠️ Le catalogue est vide !");
    return;
  }

  const jsonString = JSON.stringify(catalogData, null, 2);
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
