/* ==========================================
   VARIABLES GLOBALES & ÉLÉMENTS DOM
   ========================================== */
let catalogData = null; // Initialisé à null pour distinguer "en cours" et "vide"
let currentMD = null;
let currentAlbum = null;
let currentGenreFilter = null;
let currentTypeFilter = null;
let adminAlbumCount = 0;
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

// Normalise une valeur (texte ou tableau) en tableau nettoyé et mis en majuscules
function getNormalizedList(data) {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.map(v => String(v).toUpperCase().trim()).filter(v => v !== '');
  }
  return String(data).split(',').map(v => v.toUpperCase().trim()).filter(v => v !== '');
}

/* --- LOGIQUE GENRES --- */

// Normalise un champ genre
function getNormalizedGenres(genreData) {
  return getNormalizedList(genreData);
}

// Récupère TOUS les genres uniques d'un MiniDisc (ses propres genres + ceux de ses albums)
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

// Renvoie les genres effectifs d'un album (ses genres propres ou par défaut ceux du MD)
function getAlbumGenres(album, parentMd) {
  const albumGenres = getNormalizedGenres(album.genre);
  if (albumGenres.length > 0) return albumGenres;
  const parentGenres = getNormalizedGenres(parentMd ? parentMd.genre : null);
  return parentGenres.length > 0 ? parentGenres : ['AUTRE'];
}

/* --- LOGIQUE TYPES --- */

// Normalise un champ type
function getNormalizedTypes(typeData) {
  return getNormalizedList(typeData);
}

// Récupère TOUS les types uniques d'un MiniDisc (ses propres types + ceux de ses albums)
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

// Renvoie les types effectifs d'un album (ses types propres ou par défaut ceux du MD)
function getAlbumTypes(album, parentMd) {
  const albumTypes = getNormalizedTypes(album.type);
  if (albumTypes.length > 0) return albumTypes;
  const parentTypes = getNormalizedTypes(parentMd ? parentMd.type : null);
  return parentTypes.length > 0 ? parentTypes : ['ALBUM'];
}

/* ==========================================
   UTILITAIRES D'ALÉATOIRE FIXÉ SUR 24 HEURES
   ========================================== */

// Génère une clé unique sous forme de chaîne pour la journée en cours (ex: "2026-08-28")
function getDailySeed() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Fonction de hachage simple (cyrb53) basée sur une chaîne
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

// Mélange déterministe (Fisher-Yates) fixe sur 24h
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
   INITIALISATION DATA
   ========================================== */
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
    app.innerHTML = `<p style="color:red; text-align:center;">Erreur de chargement du catalogue JSON.</p>`;
    console.error(err);
  });

// Bouton retour UI dans le Header
backBtn.addEventListener('click', () => {
  if (currentAlbum !== null) {
    openMD(currentMD, true);
  } else if (currentMD !== null) {
    renderMDList({ genre: currentGenreFilter, type: currentTypeFilter }, true);
  } else {
    renderDashboard(true);
  }
});

/* ==========================================
   COULEURS DYNAMIQUES PAR GENRE ET TYPE
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
   SÉLECTION DU MOMENT (ALÉATOIRE 24H)
   ========================================== */
function refreshFeatured() {
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

/* 1. ACCUEIL / DASHBOARD */
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
    refreshFeatured();
  }

  if (pushState && window.location.hash !== '#dashboard') {
    history.pushState({ view: 'dashboard' }, '', '#dashboard');
  }

  const totalMD = catalogData.length;
  const genreCounts = {};
  const typeCounts = {};

  // Comptage global incluant les genres et types des MDs et de tous leurs albums
  catalogData.forEach(md => {
    const allGenres = getMDAllGenres(md);
    allGenres.forEach(g => {
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });

    const allTypes = getMDAllTypes(md);
    allTypes.forEach(t => {
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
  });

  // Badges Types
  const sortedTypes = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a]);
  let typeBadgesHTML = '';
  sortedTypes.forEach(t => {
    const color = '#ff007f'; // Style unifié pour les types
    typeBadgesHTML += `
      <div class="genre-badge" style="border-left-color: ${color};" onclick="renderMDList({ type: '${t}' })">
        <span class="genre-name" style="color:${color}">${t}</span>
        <span class="genre-count">${typeCounts[t]}</span>
      </div>
    `;
  });

  // Badges Genres
  const sortedGenres = Object.keys(genreCounts).sort((a, b) => genreCounts[b] - genreCounts[a]);
  let genreBadgesHTML = '';
  sortedGenres.forEach(g => {
    const color = getBorderColor(g);
    genreBadgesHTML += `
      <div class="genre-badge" style="border-left-color: ${color};" onclick="renderMDList({ genre: '${g}' })">
        <span class="genre-name" style="color:${color}">${g}</span>
        <span class="genre-count">${genreCounts[g]}</span>
      </div>
    `;
  });

  let html = `
    <div class="dashboard-container">
      <div class="dashboard-card">
        <div class="dashboard-stat-main">
          <span class="stat-number">${totalMD}</span>
          <span class="stat-label">MiniDiscs dans la collection</span>
        </div>
        
        <div class="dashboard-section-title">RÉPARTITION PAR TYPE</div>
        <div class="genres-grid">
          ${typeBadgesHTML}
        </div>

        <div class="dashboard-section-title" style="margin-top: 14px;">RÉPARTITION PAR GENRE</div>
        <div class="genres-grid">
          ${genreBadgesHTML}
        </div>

        <button class="btn-primary" style="margin-top: 10px;" onclick="renderMDList({})">
          VOIR TOUS LES MINIDISCS &rarr;
        </button>

        <div class="dashboard-footer">
          <button class="btn-add-md" onclick="openAdminModal()">＋ Ajouter un MD</button>
        </div>
      </div>
    </div>
  `;

  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/* 2. LISTE DES MINIDISCS (FILTRE PAR GENRE / TYPE + MÉLANGE FIXE 24H) */
function renderMDList(filters = {}, pushState = true) {
  if (catalogData === null) return;
  
  const { genre = null, type = null } = filters;
  
  currentMD = null;
  currentAlbum = null;
  currentGenreFilter = genre;
  currentTypeFilter = type;
  backBtn.classList.remove('hidden');

  if (genre) {
    headerTitle.textContent = genre.toUpperCase();
  } else if (type) {
    headerTitle.textContent = type.toUpperCase();
  } else {
    headerTitle.textContent = "COLLECTION";
  }

  if (featuredContainer) {
    featuredContainer.classList.add('hidden');
  }

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
    const targetGenre = genre.toUpperCase().trim();
    filteredCatalog = filteredCatalog.filter(({ md }) => {
      const allGenres = getMDAllGenres(md);
      return allGenres.includes(targetGenre);
    });
  }

  if (type) {
    const targetType = type.toUpperCase().trim();
    filteredCatalog = filteredCatalog.filter(({ md }) => {
      const allTypes = getMDAllTypes(md);
      return allTypes.includes(targetType);
    });
  }

  // Application du mélange 24h déterministe avec une clé propre au filtre
  let seedSuffix = '-mdlist-all';
  if (genre) seedSuffix = `-mdlist-genre-${genre}`;
  if (type) seedSuffix = `-mdlist-type-${type}`;
  
  const shuffledCatalog = dailyShuffle(filteredCatalog, seedSuffix);

  let html = '<div class="list-container">';
  
  if (shuffledCatalog.length === 0) {
    html += `<p style="text-align:center; padding: 20px;">Aucun MiniDisc trouvé.</p>`;
  } else {
    shuffledCatalog.forEach(({ md, originalIndex }) => {
      const allGenres = getMDAllGenres(md);
      const borderColor = getBorderColor(allGenres);
      const displayGenre = allGenres.join(' / ');
      
      const rawTitle = (md.albums && md.albums.length > 0) 
        ? md.albums.map(a => a.title).join(' / ') 
        : (md.title || 'MiniDisc sans titre');

      html += `
        <div class="list-item" style="border-color: ${borderColor}; border-left-width: 6px;" onclick="openMD(${originalIndex})">
          <img class="md-thumb" src="${md.md_cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'48\\' height=\\'68\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23e5e7eb\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'20\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>💽</text></svg>'">
          <div class="item-details">
            <div class="item-tag" style="color: ${borderColor};">${displayGenre}</div>
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

/* 3. VUE D'UN MINIDISC (ALBUMS) */
function openMD(index, pushState = true) {
  if (!catalogData || !catalogData[index]) return;

  currentMD = index;
  currentAlbum = null;
  backBtn.classList.remove('hidden');

  if (featuredContainer) {
    featuredContainer.classList.add('hidden');
  }

  const md = catalogData[index];
  const allMdGenres = getMDAllGenres(md);
  const borderColor = getBorderColor(allMdGenres);
  const displayGenre = allMdGenres.join(' / ');

  if (!md.albums || md.albums.length === 0) {
    headerTitle.textContent = "PISTES";

    if (pushState) {
      history.pushState({ view: 'tracklist', mdIndex: index, isDirectTracks: true }, '', `#md-${index}`);
    }

    let tracksHTML = '';
    if (md.tracks && md.tracks.length > 0) {
      md.tracks.forEach((track) => {
        const match = track.match(/^(\d+\.)\s*(.*)$/);
        if (match) {
          tracksHTML += `<li class="track-item"><strong class="track-num">${match[1]}</strong> ${match[2]}</li>`;
        } else {
          tracksHTML += `<li class="track-item">${track}</li>`;
        }
      });
    } else {
      tracksHTML = `<li class="track-item">Aucune piste disponible.</li>`;
    }

    let html = `
      <div class="track-container">
        <div class="album-header">
          <img class="album-cover-large" src="${md.md_cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'150\\' height=\\'150\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'36\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>💽</text></svg>'">
          <div>
            <h2 style="font-size: 1.2rem; font-weight: 800; line-height: 1.2;">${md.title || 'Compilation'}</h2>
            <p style="color: var(--text-sub); font-size: 0.95rem; margin-top: 4px;">${md.artist || 'Artistes divers'}</p>
            ${displayGenre ? `<p style="color: ${borderColor}; font-size: 0.8rem; margin-top: 2px; font-weight: 800;">${displayGenre}</p>` : ''}
          </div>
        </div>
        <ul class="track-list">
          ${tracksHTML}
        </ul>
      </div>
    `;
    app.innerHTML = html;
    window.scrollTo(0, 0);
    return;
  }

  headerTitle.textContent = displayGenre || "ALBUMS";

  if (pushState) {
    history.pushState({ view: 'albums', mdIndex: index }, '', `#md-${index}`);
  }

  let html = '<div class="list-container">';
  md.albums.forEach((album, aIndex) => {
    const albumGenres = getAlbumGenres(album, md);
    const albumColor = getBorderColor(albumGenres);
    const albumGenreText = albumGenres.join(' / ');

    html += `
      <div class="list-item" style="border-color: ${albumColor}; border-left-width: 6px;" onclick="openAlbum(${index}, ${aIndex})">
        <img class="album-thumb" src="${album.cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'100\\' height=\\'100\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'24\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>🎵</text></svg>'">
        <div class="item-details">
          <div class="item-tag" style="color: ${albumColor};">${albumGenreText}</div>
          <div class="item-title" style="font-weight: 700; font-size: 1.05rem;">${album.title || 'Album sans titre'}</div>
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

/* 4. VUE TRACKLIST (ALBUM SPÉCIFIQUE) */
function openAlbum(mdIndex, albumIndex, pushState = true) {
  if (!catalogData || !catalogData[mdIndex] || !catalogData[mdIndex].albums[albumIndex]) return;

  currentMD = mdIndex;
  currentAlbum = albumIndex;
  backBtn.classList.remove('hidden');

  if (featuredContainer) {
    featuredContainer.classList.add('hidden');
  }

  const md = catalogData[mdIndex];
  const album = md.albums[albumIndex];
  const albumGenres = getAlbumGenres(album, md);
  const albumColor = getBorderColor(albumGenres);
  const albumGenreText = albumGenres.join(' / ');

  headerTitle.textContent = "PISTES";

  if (pushState) {
    history.pushState({ view: 'tracklist', mdIndex: mdIndex, albumIndex: albumIndex }, '', `#md-${mdIndex}-album-${albumIndex}`);
  }

  let tracksHTML = '';
  if (album.tracks && album.tracks.length > 0) {
    album.tracks.forEach((track) => {
      const match = track.match(/^(\d+\.)\s*(.*)$/);
      if (match) {
        tracksHTML += `<li class="track-item"><strong class="track-num">${match[1]}</strong> ${match[2]}</li>`;
      } else {
        tracksHTML += `<li class="track-item">${track}</li>`;
      }
    });
  } else {
    tracksHTML = `<li class="track-item">Aucune piste disponible.</li>`;
  }

  let html = `
    <div class="track-container">
      <div class="album-header">
        <img class="album-cover-large" src="${album.cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'150\\' height=\\'150\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'36\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>🎵</text></svg>'">
        <div>
          <h2 style="font-size: 1.2rem; font-weight: 800; line-height: 1.2;">${album.title || 'Album sans titre'}</h2>
          <p style="color: var(--text-sub); font-size: 0.95rem; margin-top: 4px;">${album.artist || 'Artiste inconnu'}</p>
          <p style="color: ${albumColor}; font-size: 0.8rem; margin-top: 2px; font-weight: 800;">${albumGenreText}</p>
          ${album.year ? `<p style="color: var(--text-sub); font-size: 0.8rem; margin-top: 2px;">${album.year}</p>` : ''}
        </div>
      </div>
      <ul class="track-list">
        ${tracksHTML}
      </ul>
    </div>
  `;
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/* ==========================================
   GESTION DU FORMULAIRE ADMIN (MODAL)
   ========================================== */
function openAdminModal() {
  document.getElementById('admin-modal').classList.remove('hidden');
}

function closeAdminModal() {
  document.getElementById('admin-modal').classList.add('hidden');
}

function toggleAdminType() {
  const isCompil = document.querySelector('input[name="md-type"]:checked').value === 'compil';
  document.getElementById('section-compil').classList.toggle('hidden', !isCompil);
  document.getElementById('section-albums').classList.toggle('hidden', isCompil);
  if (!isCompil && adminAlbumCount === 0) addAdminAlbumBlock();
}

function addAdminAlbumBlock() {
  adminAlbumCount++;
  const container = document.getElementById('albums-container');
  const div = document.createElement('div');
  div.className = 'album-block';
  div.innerHTML = `
    <h4>Album #${adminAlbumCount}</h4>
    <div class="form-group"><input type="text" class="album-title" placeholder="Titre de l'album" required></div>
    <div class="form-group"><input type="text" class="album-artist" placeholder="Artiste" required></div>
    <div class="form-group"><input type="text" class="album-type" placeholder="Type(s) de l'album (ex: Album, Live - séparés par virgule)"></div>
    <div class="form-group"><input type="text" class="album-genre" placeholder="Genre(s) de l'album (séparés par virgule)"></div>
    <div class="form-group"><input type="text" class="album-year" placeholder="Année (ex: 1998)"></div>
    <div class="form-group"><input type="text" class="album-cover" value="images/" placeholder="URL Pochette Album"></div>
    <div class="form-group"><textarea class="album-tracks" placeholder="Pistes de cet album (une par ligne)"></textarea></div>
  `;
  container.appendChild(div);
}

function submitNewMD() {
  if (catalogData === null) {
    showToast("⏳ Now Loading... Patientez un instant");
    return;
  }

  const rawGenreInput = document.getElementById('md-genre').value.trim();
  const rawTypeInput = document.getElementById('md-type-tags') ? document.getElementById('md-type-tags').value.trim() : '';
  const mdCover = document.getElementById('md-cover').value.trim();
  const typeFormat = document.querySelector('input[name="md-type"]:checked').value;

  if (!rawGenreInput) {
    showToast("⚠️ Veuillez renseigner au moins un genre pour le MiniDisc");
    return;
  }

  const parsedMDGenres = rawGenreInput.includes(',') 
    ? rawGenreInput.split(',').map(g => g.trim()).filter(g => g !== '')
    : [rawGenreInput];

  const parsedMDTypes = rawTypeInput 
    ? (rawTypeInput.includes(',') ? rawTypeInput.split(',').map(t => t.trim()).filter(t => t !== '') : [rawTypeInput])
    : ['ALBUM'];

  let globalTrackCounter = 1;
  const newMD = { genre: parsedMDGenres, type: parsedMDTypes, md_cover: mdCover };

  if (typeFormat === 'compil') {
    newMD.title = document.getElementById('compil-title').value.trim();
    newMD.artist = document.getElementById('compil-artist').value.trim();
    
    const rawTracks = document.getElementById('compil-tracks').value.split('\n');
    newMD.tracks = rawTracks
      .filter(t => t.trim() !== '')
      .map(t => `${String(globalTrackCounter++).padStart(2, '0')}. ${t.trim()}`);
  } else {
    newMD.albums = [];
    const blocks = document.querySelectorAll('.album-block');
    
    blocks.forEach(block => {
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

      if (parsedAlbumGenres.length > 0) {
        albumObj.genre = parsedAlbumGenres;
      }

      if (parsedAlbumTypes.length > 0) {
        albumObj.type = parsedAlbumTypes;
      }

      newMD.albums.push(albumObj);
    });
  }

  catalogData.push(newMD);
  renderDashboard(false);
  closeAdminModal();
  
  showToast("✅ MiniDisc ajouté ! Téléchargez votre data.json");
  document.getElementById('md-form').reset();
  
  document.getElementById('md-cover').value = "images/";
  document.getElementById('albums-container').innerHTML = '';
  adminAlbumCount = 0;
  toggleAdminType();
}

function downloadUpdatedJSON() {
  if (catalogData === null) {
    showToast("⏳ Now Loading... Patientez un instant");
    return;
  }

  if (catalogData.length === 0) {
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

  showToast("✅ Téléchargement réussi !");
}
