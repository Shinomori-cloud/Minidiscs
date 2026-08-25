/* ==========================================
   VARIABLES GLOBALES & ÉLÉMENTS DOM
   ========================================== */
let catalogData = [];
let currentMD = null;
let currentAlbum = null;
let currentGenreFilter = null;

const app = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const featuredContainer = document.getElementById('featured-container');

/* ==========================================
   VERROU HISTORIQUE SPÉCIFIQUE HERMIT
   ========================================== */
// On arme le piège d'historique IMMÉDIATEMENT, sans attendre le JSON
(function initHermitHistoryLock() {
  if (!history.state || history.state.view !== 'dashboard') {
    // 1. On remplace la page d'ouverture par la racine fictive
    history.replaceState({ view: 'root' }, '', '#root');
    // 2. On empile le vrai dashboard par-dessus
    history.pushState({ view: 'dashboard' }, '', '#dashboard');
  }
})();

/* ==========================================
   INITIALISATION & CHARGEMENT DATA
   ========================================== */
fetch('data.json')
  .then(response => response.json())
  .then(data => {
    catalogData = data;

    // Chargement de la vue initiale selon l'URL (sans repousser d'état)
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

/* ==========================================
   GESTION DU POPSTATE (GESTES ET RETOUR HERMIT)
   ========================================== */
window.addEventListener('popstate', (e) => {
  // Si le retour système touche au root (le fond de pile dans Hermit)
  if (!e.state || e.state.view === 'root') {
    // On force l'affichage du Dashboard
    renderDashboard(false);
    // On ré-arme immédiatement un cran d'historique devant pour ré-emprisonner le retour système
    history.pushState({ view: 'dashboard' }, '', '#dashboard');
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

// Bouton retour du Header : gère le retour proprement sans dépendre uniquement de l'historique
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
      </div>
    </div>
  `;

  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/* 2. LISTE DES MINIDISCS (FILTRE PAR GENRE OPTIONNEL) */
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

/* 3. VUE D'UN MINIDISC (ALBUMS OU PISTES DIRECTES SI COMPILATION) */
function openMD(index, pushState = true) {
  currentMD = index;
  currentAlbum = null;
  backBtn.classList.remove('hidden');

  if (featuredContainer) {
    featuredContainer.classList.add('hidden');
  }

  const md = catalogData[index];
  const borderColor = getBorderColor(md.genre);

  // CAS COMPILATION : Pas d'albums -> Affichage direct des pistes
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

  // CAS CLASSIQUE : Plusieurs albums sur le MiniDisc
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

/* 4. VUE TRACKLIST (POUR ALBUMS SPÉCIFIQUES) */
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
