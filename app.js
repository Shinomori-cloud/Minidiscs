let catalogData = [];
let currentMD = null;

const app = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');

// Palette de couleurs personnalisées par genre musical
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

// Chargement sécurisé depuis ./data.json
fetch('./data.json')
  .then(response => {
    if (!response.ok) {
      throw new Error(`Erreur réseau (${response.status} ${response.statusText})`);
    }
    return response.json();
  })
  .then(data => {
    catalogData = data;
    renderMDList();
  })
  .catch(error => {
    console.error("Détail de l'erreur :", error);
    app.innerHTML = `<p style="text-align:center; padding:20px; color:#e63946;">
      Impossible de charger <strong>data.json</strong>.<br><br>
      <small style="color:#6b7280;">(${error.message})</small>
    </p>`;
  });

function renderMDList() {
  currentMD = null;
  backBtn.classList.add('hidden');
  headerTitle.textContent = "Collection MiniDisc";

  let html = '<div class="list-container">';
  catalogData.forEach((md, index) => {
    const borderColor = getBorderColor(md.genre);
    const albumTitles = md.albums.map(a => a.title).join(' / ');

    html += `
      <div class="list-item" style="border-left-color: ${borderColor};" onclick="openMD(${index})">
        <div class="item-icon">💽</div>
        <div class="item-details">
          <div class="item-tag" style="color: ${borderColor};">${md.genre || 'MINIDISC'}</div>
          <div class="item-title">${albumTitles}</div>
        </div>
      </div>
    `;
  });
  html += '</div>';
  app.innerHTML = html;
}

function openMD(index) {
  currentMD = catalogData[index];
  backBtn.classList.remove('hidden');
  headerTitle.textContent = currentMD.genre || "MiniDisc";

  const borderColor = getBorderColor(currentMD.genre);

  let html = '<div class="list-container">';
  currentMD.albums.forEach((album, aIndex) => {
    html += `
      <div class="list-item" style="border-left-color: ${borderColor};" onclick="openAlbum(${aIndex})">
        <img class="item-thumb" src="${album.cover || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'48\\' height=\\'48\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23e5e7eb\\'/></svg>'">
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

function openAlbum(aIndex) {
  const album = currentMD.albums[aIndex];
  headerTitle.textContent = album.title;

  let html = `
    <div class="track-container">
      <div class="album-header">
        <img class="album-cover-large" src="${album.cover || ''}" onerror="this.style.display='none'">
        <div>
          <div style="font-weight:700; font-size:1rem;">${album.title}</div>
          <div style="color:var(--text-sub); font-size:0.85rem; margin-top:2px;">${album.artist}</div>
        </div>
      </div>
      <ul class="track-list">
  `;
  
  if (album.tracks && album.tracks.length > 0) {
    album.tracks.forEach((track) => {
      html += `
        <li class="track-item">
          <span>${track}</span>
        </li>
      `;
    });
  } else {
    html += '<li class="track-item" style="color:var(--text-sub); italic;">Aucune liste de pistes renseignée.</li>';
  }

  html += '</ul></div>';
  app.innerHTML = html;
}

backBtn.addEventListener('click', () => {
  if (headerTitle.textContent !== (currentMD?.genre || "MiniDisc") && currentMD) {
    openMD(catalogData.indexOf(currentMD));
  } else {
    renderMDList();
  }
});
