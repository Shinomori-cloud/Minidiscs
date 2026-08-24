let catalogData = [];
let currentMD = null;
let currentAlbum = null;

const app = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const featuredContainer = document.getElementById('featured-container');
const refreshFeaturedBtn = document.getElementById('refresh-featured-btn');

const genreColors = {
  'ROCK': '#e63946',
  'ROCK FRANÇAIS': '#d90429',
  'ROCK CALIFORNIEN': '#ffb703',
  'ROCK GARAGE': '#fb8500',
  'ROCK ATMOSPHÉRIQUE': '#457b9d',
  'ROCK 80\'S': '#9d4edd',
  'POP': '#00b4d8',
  'POP ROCK': '#0077b6',
  'RAP': '#16a34a',
  'RAP / REGGAE': '#2a9d8f',
  'HUMOUR': '#f72585',
  'OST': '#7209b7',
  'JEUNESSE': '#ff0676',
  'METAL': '#b91c1c',
  'LIVE': '#4b5563',
  'FOLK ROCK': '#e07a5f',
  'FRANÇAIS': '#2563eb',
  'DEFAULT': '#6b7280'
};

function getBorderColor(genre) {
  if (!genre) return genreColors['DEFAULT'];
  const cleanGenre = genre.toUpperCase().trim();
  return genreColors[cleanGenre] || genreColors['DEFAULT'];
}

function formatAlbumTitles(titleString) {
  if (!titleString) return '';
  if (titleString.includes('/')) {
    return titleString
      .split('/')
      .map(t => `<div class="title-line">${t.trim()}</div>`)
      .join('');
  }
  return `<div class="title-line">${titleString}</div>`;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function getFeaturedGridHTML() {
  if (catalogData.length < 3) return '';
  const randomPick = [...catalogData].sort(() => 0.5 - Math.random()).slice(0, 3);
  let html = '';
  
  randomPick.forEach(md => {
    const originalIndex = catalogData.indexOf(md);
    const borderColor = getBorderColor(md.genre);
    html += `
      <div class="featured-item" style="border-color: ${borderColor};" onclick="openMD(${originalIndex})">
        <img class="featured-thumb" src="${md.md_cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'48\\' height=\\'68\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%231e1b2e\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'16\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>💽</text></svg>'">
      </div>
    `;
  });
  
  return html;
}

function refreshFeatured() {
  const grid = document.getElementById('featured-grid');
  if (grid) {
    grid.innerHTML = getFeaturedGridHTML();
  }
}

fetch('./data.json')
  .then(response => {
    if (!response.ok) throw new Error(`Erreur réseau (${response.status})`);
    return response.json();
  })
  .then(data => {
    catalogData = data;
    shuffleArray(catalogData);
    renderMDList(false);
  })
  .catch(error => {
    console.error("Détail de l'erreur :", error);
    app.innerHTML = `<p style="text-align:center; padding:20px; color:#e63946;">
      Impossible de charger <strong>data.json</strong>.<br><br>
      <small style="color:#6b7280;">(${error.message})</small>
    </p>`;
  });

function renderMDList(pushState = true) {
  currentMD = null;
  currentAlbum = null;
  backBtn.classList.add('hidden');
  headerTitle.textContent = "COLLECTION MINIDISC";

  if (featuredContainer) {
    featuredContainer.classList.remove('hidden');
    refreshFeatured();
  }

  if (pushState) {
    history.pushState({ view: 'home' }, '', '#home');
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
}

function openMD(index, pushState = true) {
  currentMD = catalogData[index];
  currentAlbum = null;
  backBtn.classList.remove('hidden');

  if (featuredContainer) {
    featuredContainer.classList.add('hidden');
  }

  if (pushState) {
    history.pushState({ view: 'md', mdIndex: index }, '', `#md-${index}`);
  }

  if (currentMD.tracks && (!currentMD.albums || currentMD.albums.length === 0)) {
    headerTitle.textContent = currentMD.title || currentMD.genre || "MiniDisc";
    renderTrackList(currentMD.title || "Compilation", "Artistes variés", currentMD.md_cover, currentMD.tracks);
    return;
  }

  headerTitle.textContent = currentMD.genre || "MiniDisc";
  const borderColor = getBorderColor(currentMD.genre);

  let html = '<div class="list-container">';
  (currentMD.albums || []).forEach((album, aIndex) => {
    html += `
      <div class="list-item" style="border-color: ${borderColor}; border-left-width: 6px;" onclick="openAlbum(${aIndex})">
        <img class="album-thumb" src="${album.cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'52\\' height=\\'52\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23e5e7eb\\'/></svg>'">
        <div class="item-details">
          <div class="item-title">${album.title}</div>
          <div class="item-sub">${album.artist} • ${album.tracks ? album.tracks.length : 0} pistes</div>
        </div>
      </div>
    `;
  });
  html += '</div>';
  app.innerHTML = html;
}

function openAlbum(aIndex, pushState = true) {
  currentAlbum = currentMD.albums[aIndex];
  headerTitle.textContent = currentAlbum.title;

  if (featuredContainer) {
    featuredContainer.classList.add('hidden');
  }

  if (pushState) {
    const mdIndex = catalogData.indexOf(currentMD);
    history.pushState({ view: 'album', mdIndex: mdIndex, albumIndex: aIndex }, '', `#md-${mdIndex}-album-${aIndex}`);
  }

  renderTrackList(currentAlbum.title, currentAlbum.artist, currentAlbum.cover, currentAlbum.tracks);
}

function renderTrackList(title, artist, coverSrc, tracks) {
  let html = `
    <div class="track-container">
      <div class="album-header">
        <img class="album-cover-large" src="${coverSrc || ''}" onerror="this.style.display='none'">
        <div>
          <div style="font-weight:700; font-size:1rem;">${title}</div>
          <div style="color:var(--text-sub); font-size:0.85rem; margin-top:2px;">${artist}</div>
        </div>
      </div>
      <ul class="track-list">
  `;
  
  if (tracks && tracks.length > 0) {
    tracks.forEach((track) => {
      html += `
        <li class="track-item">
          <span>${track}</span>
        </li>
      `;
    });
  } else {
    html += '<li class="track-item" style="color:var(--text-sub); font-style:italic;">Aucune liste de pistes renseignée.</li>';
  }

  html += '</ul></div>';
  app.innerHTML = html;
}

backBtn.addEventListener('click', () => {
  history.back();
});

// ÉCOUTEUR OPTIMISÉ POUR HERMIT & MOBILE
if (refreshFeaturedBtn) {
  const triggerRefresh = (e) => {
    e.preventDefault();
    e.stopPropagation();
    refreshFeatured();
  };

  refreshFeaturedBtn.addEventListener('click', triggerRefresh);
  refreshFeaturedBtn.addEventListener('touchstart', triggerRefresh, { passive: false });
}

window.addEventListener('popstate', (event) => {
  const state = event.state;

  if (!state || state.view === 'home') {
    renderMDList(false);
  } else if (state.view === 'md') {
    openMD(state.mdIndex, false);
  } else if (state.view === 'album') {
    currentMD = catalogData[state.mdIndex];
    openAlbum(state.albumIndex, false);
  }
});
