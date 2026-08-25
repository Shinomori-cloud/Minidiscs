/* ==========================================
   VARIABLES GLOBALES & ÉLÉMENTS DOM
   ========================================== */
let catalogData = [];
let currentMD = null;
let currentAlbum = null;
let currentGenreFilter = null;
let adminAlbumCount = 0;

const app = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const featuredContainer = document.getElementById('featured-container');

/* ==========================================
   GESTION STRICTE DE L'HISTORIQUE HERMIT
   ========================================== */

// 1. Définition du hash par défaut pour bloquer la sortie de l'application
if (!window.location.hash || window.location.hash === '#') {
  window.history.replaceState({ view: 'dashboard' }, '', '#dashboard');
}

// 2. Interception du bouton retour physique (popstate)
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
      renderMDList(e.state.genre || null, false);
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
        renderMDList(null, false);
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
  .then(response => response.json())
  .then(data => {
    catalogData = data;
    
    const hash = window.location.hash;
    if (hash.startsWith('#minidiscs')) {
      const parts = hash.split('?genre=');
      const genre = parts[1] ? decodeURIComponent(parts[1]) : null;
      renderMDList(genre, false);
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
    app.innerHTML = `<p style="color:red; text-align:center;">Erreur de chargement du catalogue JSON.</p>`;
    console.error(err);
  });

// Bouton retour UI dans le Header
backBtn.addEventListener('click', () => {
  if (currentAlbum !== null) {
    openMD(currentMD, true);
  } else if (currentMD !== null) {
    renderMDList(currentGenreFilter, true);
  } else {
    renderDashboard(true);
  }
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

function getBorderColor(genre) {
  if (!genre) return '#7b2cbf';
  const g = genre.toUpperCase().trim();

  if (genreColorMap[g]) {
    return genreColorMap[g];
  }

  const assignedCount = Object.keys(genreColorMap).length;
  const color = genreColorPalette[assignedCount % genreColorPalette.length];
  genreColorMap[g] = color;
  
  return color;
}

function formatAlbumTitles(rawTitle) {
  if (!rawTitle) return '';
  return rawTitle.split(' / ').map(t => `<div class="title-line">${t.trim()}</div>`).join('');
}

/* ==========================================
   SÉLECTION DU MOMENT (ALÉATOIRE)
   ========================================== */
function refreshFeatured() {
  if (!catalogData || catalogData.length === 0) return;
  
  const featuredGrid = document.getElementById('featured-grid');
  if (!featuredGrid) return;

  const shuffled = [...catalogData].sort(() => 0.5 - Math.random());
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
  backBtn.classList.add('hidden');
  headerTitle.textContent = "MINIDISCS";

  if (featuredContainer) {
    featuredContainer.classList.remove('hidden');
    refreshFeatured();
  }

  if (pushState && window.location.hash !== '#dashboard') {
    history.pushState({ view: 'dashboard' }, '', '#dashboard');
  }

  const totalMD = catalogData.length;
  const genreCounts = {};

  catalogData.forEach(md => {
    const g = (md.genre || 'AUTRE').toUpperCase().trim();
    genreCounts[g] = (genreCounts[g] || 0) + 1;
  });

  const sortedGenres = Object.keys(genreCounts).sort((a, b) => genreCounts[b] - genreCounts[a]);

  let genreBadgesHTML = '';
  sortedGenres.forEach(g => {
    const color = getBorderColor(g);
    genreBadgesHTML += `
      <div class="genre-badge" style="border-left-color: ${color};" onclick="renderMDList('${g}')">
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
        
        <div class="dashboard-section-title">RÉPARTITION PAR GENRE</div>
        <div class="genres-grid">
          ${genreBadgesHTML}
        </div>

        <button class="btn-primary" onclick="renderMDList(null)">
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

/* 2. LISTE DES MINIDISCS (AVEC FILTRE PAR GENRE) */
function renderMDList(genreFilter = null, pushState = true) {
  currentMD = null;
  currentAlbum = null;
  currentGenreFilter = genreFilter;
  backBtn.classList.remove('hidden');

  if (genreFilter) {
    headerTitle.textContent = genreFilter.toUpperCase();
  } else {
    headerTitle.textContent = "COLLECTION";
  }

  if (featuredContainer) {
    featuredContainer.classList.add('hidden');
  }

  if (pushState) {
    const urlHash = genreFilter ? `#minidiscs?genre=${encodeURIComponent(genreFilter)}` : '#minidiscs';
    history.pushState({ view: 'minidiscs', genre: genreFilter }, '', urlHash);
  }

  let filteredCatalog = catalogData.map((md, originalIndex) => ({ md, originalIndex }));
  
  if (genreFilter) {
    filteredCatalog = filteredCatalog.filter(({ md }) => {
      const g = (md.genre || 'AUTRE').toUpperCase().trim();
      return g === genreFilter.toUpperCase().trim();
    });
  }

  const shuffledCatalog = filteredCatalog.sort(() => 0.5 - Math.random());

  let html = '<div class="list-container">';
  
  if (shuffledCatalog.length === 0) {
    html += `<p style="text-align:center; padding: 20px;">Aucun MiniDisc trouvé pour ce genre.</p>`;
  } else {
    shuffledCatalog.forEach(({ md, originalIndex }) => {
      const borderColor = getBorderColor(md.genre);
      
      const rawTitle = (md.albums && md.albums.length > 0) 
        ? md.albums.map(a => a.title).join(' / ') 
        : (md.title || 'MiniDisc sans titre');

      html += `
        <div class="list-item" style="border-color: ${borderColor}; border-left-width: 6px;" onclick="openMD(${originalIndex})">
          <img class="md-thumb" src="${md.md_cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'48\\' height=\\'68\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23e5e7eb\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'20\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>💽</text></svg>'">
          <div class="item-details">
            <div class="item-tag" style="color: ${borderColor};">${md.genre || 'MINIDISC'}</div>
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

/* 3. VUE D'UN MINIDISC (ALBUMS OU PISTES DIRECTES) */
function openMD(index, pushState = true) {
  currentMD = index;
  currentAlbum = null;
  backBtn.classList.remove('hidden');

  if (featuredContainer) {
    featuredContainer.classList.add('hidden');
  }

  const md = catalogData[index];
  const borderColor = getBorderColor(md.genre);

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
          <img class="album-cover-large" src="${md.md_cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'150\\' height=\\'150\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23e5e7eb\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'36\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>💽</text></svg>'">
          <div>
            <h2 style="font-size: 1.2rem; font-weight: 800; line-height: 1.2;">${md.title || 'Compilation'}</h2>
            <p style="color: var(--text-sub); font-size: 0.95rem; margin-top: 4px;">${md.artist || 'Artistes divers'}</p>
            ${md.genre ? `<p style="color: ${borderColor}; font-size: 0.8rem; margin-top: 2px; font-weight: 800;">${md.genre}</p>` : ''}
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

  headerTitle.textContent = md.genre || "ALBUMS";

  if (pushState) {
    history.pushState({ view: 'albums', mdIndex: index }, '', `#md-${index}`);
  }

  let html = '<div class="list-container">';
  md.albums.forEach((album, aIndex) => {
    html += `
      <div class="list-item" style="border-color: ${borderColor}; border-left-width: 6px;" onclick="openAlbum(${index}, ${aIndex})">
        <img class="album-thumb" src="${album.cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'100\\' height=\\'100\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23e5e7eb\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'24\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>🎵</text></svg>'">
        <div class="item-details">
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
  currentMD = mdIndex;
  currentAlbum = albumIndex;
  backBtn.classList.remove('hidden');

  if (featuredContainer) {
    featuredContainer.classList.add('hidden');
  }

  const md = catalogData[mdIndex];
  const album = md.albums[albumIndex];
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
        <img class="album-cover-large" src="${album.cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'150\\' height=\\'150\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23e5e7eb\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'36\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>🎵</text></svg>'">
        <div>
          <h2 style="font-size: 1.2rem; font-weight: 800; line-height: 1.2;">${album.title || 'Album sans titre'}</h2>
          <p style="color: var(--text-sub); font-size: 0.95rem; margin-top: 4px;">${album.artist || 'Artiste inconnu'}</p>
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
    <div class="form-group"><input type="text" class="album-year" placeholder="Année (ex: 1998)"></div>
    <div class="form-group"><input type="text" class="album-cover" value="/Minidiscs/images/" placeholder="URL Pochette Album"></div>
    <div class="form-group"><textarea class="album-tracks" placeholder="Pistes de cet album (une par ligne)"></textarea></div>
  `;
  container.appendChild(div);
}

function submitNewMD() {
  const genre = document.getElementById('md-genre').value.trim();
  const mdCover = document.getElementById('md-cover').value.trim();
  const type = document.querySelector('input[name="md-type"]:checked').value;

  if (!genre) {
    alert("Veuillez renseigner au moins le genre.");
    return;
  }

  let globalTrackCounter = 1;
  const newMD = { genre: genre, md_cover: mdCover };

  if (type === 'compil') {
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

      newMD.albums.push({
        title: block.querySelector('.album-title').value.trim(),
        artist: block.querySelector('.album-artist').value.trim(),
        year: block.querySelector('.album-year').value.trim(),
        cover: block.querySelector('.album-cover').value.trim(),
        tracks: formattedTracks
      });
    });
  }

  catalogData.push(newMD);
  renderDashboard(false);
  closeAdminModal();
  
  alert("MiniDisc ajouté au catalogue local ! Pensez à télécharger votre data.json mis à jour.");
  document.getElementById('md-form').reset();
  
  // Réinitialisation explicite du préremplissage des pochettes
  document.getElementById('md-cover').value = "images/";
  document.getElementById('albums-container').innerHTML = '';
  adminAlbumCount = 0;
  toggleAdminType();
}

function downloadUpdatedJSON() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(catalogData, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", "data.json");
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}
