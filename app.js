/* ==========================================
   VARIABLES GLOBALES & ÉLÉMENTS DOM
   ========================================== */
let catalogData = [];
let currentMD = null;
let currentAlbum = null;

const app = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const featuredContainer = document.getElementById('featured-container');

/* ==========================================
   INITIALISATION & NAVIGATION HISTORY
   ========================================== */
fetch('data.json')
  .then(response => response.json())
  .then(data => {
    catalogData = data;
    
    // Chargement initial selon le hash URL
    const hash = window.location.hash;
    if (hash === '#minidiscs') {
      renderMDList(false);
    } else {
      renderDashboard(false);
    }
  })
  .catch(err => {
    app.innerHTML = `<p style="color:red; text-align:center;">Erreur de chargement du catalogue JSON.</p>`;
    console.error(err);
  });

// Gestion du bouton "Précédent" du navigateur / smartphone
window.addEventListener('popstate', (e) => {
  if (!e.state) {
    renderDashboard(false);
    return;
  }
  
  switch (e.state.view) {
    case 'dashboard':
      renderDashboard(false);
      break;
    case 'minidiscs':
      renderMDList(false);
      break;
    case 'albums':
      if (e.state.mdIndex !== undefined) {
        openMD(e.state.mdIndex, false);
      } else {
        renderMDList(false);
      }
      break;
    case 'tracklist':
      if (e.state.mdIndex !== undefined && e.state.albumIndex !== undefined) {
        openAlbum(e.state.mdIndex, e.state.albumIndex, false);
      } else {
        renderMDList(false);
      }
      break;
    default:
      renderDashboard(false);
  }
});

// Bouton retour du Header
backBtn.addEventListener('click', () => {
  if (currentAlbum !== null) {
    openMD(currentMD, true);
  } else if (currentMD !== null) {
    renderMDList(true);
  } else {
    renderDashboard(true);
  }
});

/* ==========================================
   COULEURS PAR GENRE
   ========================================== */
function getBorderColor(genre) {
  if (!genre) return '#7b2cbf';
  const g = genre.toUpperCase().trim();
  switch (g) {
    case 'ROCK': return '#e63946';
    case 'POP': return '#ff007f';
    case 'ELECTRO': return '#00f0ff';
    case 'HIP-HOP': return '#ffb703';
    case 'INDIE': return '#7b2cbf';
    case 'METAL': return '#2b2d42';
    default: return '#7b2cbf';
  }
}

function formatAlbumTitles(rawTitle) {
  if (!rawTitle) return '';
  return rawTitle.split(' / ').map(t => `<div class="title-line">${t.trim()}</div>`).join('');
}

/* ==========================================
   SÉLECTION DU MOMENT (ALEATOIRE)
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
  backBtn.classList.add('hidden');
  headerTitle.textContent = "MINIDISCS";

  if (featuredContainer) {
    featuredContainer.classList.remove('hidden');
    refreshFeatured();
  }

  if (pushState) {
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
      <div class="genre-badge" style="border-left-color: ${color};">
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

        <button class="btn-primary" onclick="renderMDList()">
          VOIR TOUS LES MINIDISCS &rarr;
        </button>
      </div>
    </div>
  `;

  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/* 2. LISTE DES MINIDISCS */
function renderMDList(pushState = true) {
  currentMD = null;
  currentAlbum = null;
  backBtn.classList.remove('hidden');
  headerTitle.textContent = "COLLECTION";

  if (featuredContainer) {
    featuredContainer.classList.add('hidden');
  }

  if (pushState) {
    history.pushState({ view: 'minidiscs' }, '', '#minidiscs');
  }

  let html = '<div class="list-container">';
  catalogData.forEach((md, index) => {
    const borderColor = getBorderColor(md.genre);
    
    const rawTitle = (md.albums && md.albums.length > 0) 
      ? md.albums.map(a => a.title).join(' / ') 
      : (md.title || 'MiniDisc sans titre');

    html += `
      <div class="list-item" style="border-color: ${borderColor}; border-left-width: 6px;" onclick="openMD(${index})">
        <img class="md-thumb" src="${md.md_cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'48\\' height=\\'68\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23e5e7eb\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'20\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>💽</text></svg>'">
        <div class="item-details">
          <div class="item-tag" style="color: ${borderColor};">${md.genre || 'MINIDISC'}</div>
          <div class="item-title">${formatAlbumTitles(rawTitle)}</div>
        </div>
      </div>
    `;
  });
  html += '</div>';
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/* 3. VUE D'UN MINIDISC (ALBUMS) */
function openMD(index, pushState = true) {
  currentMD = index;
  currentAlbum = null;
  backBtn.classList.remove('hidden');

  if (featuredContainer) {
    featuredContainer.classList.add('hidden');
  }

  const md = catalogData[index];
  const borderColor = getBorderColor(md.genre);
  headerTitle.textContent = md.genre || "ALBUMS";

  if (pushState) {
    history.pushState({ view: 'albums', mdIndex: index }, '', `#md-${index}`);
  }

  let html = '<div class="list-container">';
  if (md.albums && md.albums.length > 0) {
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
  } else {
    html += `<p style="text-align:center; padding: 20px;">Aucun album trouvé sur ce MiniDisc.</p>`;
  }
  html += '</div>';
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/* 4. VUE TRACKLIST (NUMÉROTATION CORRIGÉE) */
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
      // Découpe la piste si elle commence par un numéro pour styliser ce numéro en gras
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
