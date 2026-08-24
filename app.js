let catalogData = [];

// Alternance automatique des couleurs pour les titres séparés par "/"
function formatAlbumTitles(titleString) {
  if (!titleString) return '';
  if (titleString.includes('/')) {
    const albums = titleString.split('/').map(a => a.trim());
    return albums.map((album, index) => {
      const colorClass = (index % 2 === 0) ? 'title-color-1' : 'title-color-2';
      return `<span class="${colorClass}">${album}</span>`;
    }).join(' <span class="title-separator">/</span> ');
  }
  return `<span class="title-color-1">${titleString}</span>`;
}

// Éléments du DOM
const app = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');

// Chargement de data.json
fetch('./data.json')
  .then(response => {
    if (!response.ok) throw new Error(`Erreur réseau (${response.status})`);
    return response.json();
  })
  .then(data => {
    catalogData = data;
    renderList();
  })
  .catch(error => {
    console.error("Erreur :", error);
    app.innerHTML = `<p style="text-align:center; padding: 20px;">Erreur de chargement de data.json</p>`;
  });

// Affichage de la liste principale
function renderList() {
  if (backBtn) backBtn.classList.add('hidden');
  if (headerTitle) headerTitle.textContent = "MINIDISC";
  
  let html = '<div class="list-container">';
  
  catalogData.forEach((item, index) => {
    // Extraction intelligente des propriétés selon la structure de l'objet
    const type = item.type || (item.albums ? 'md' : 'album');
    const imgClass = type === 'md' ? 'md-thumb' : 'album-thumb';
    const tag = item.tag || item.genre || 'MINIDISC';
    const tagColor = item.tagColor || '#7b2cbf';
    const cover = item.cover || item.image || item.coverUrl || '';
    
    // Titre : soit direct, soit construit à partir des albums du MD
    let title = item.title || item.name || '';
    if (!title && item.albums && Array.isArray(item.albums)) {
      title = item.albums.map(a => a.title || a.name || a).join(' / ');
    }
    
    // Sous-titre : soit direct, soit liste des artistes
    let sub = item.sub || item.subtitle || item.artist || '';
    if (!sub && item.albums && Array.isArray(item.albums)) {
      const count = item.albums.length;
      const artists = item.albums.map(a => a.artist).filter(Boolean).join(' / ');
      sub = `${count} Album${count > 1 ? 's' : ''}${artists ? ' • ' + artists : ''}`;
    }

    html += `
      <div class="list-item" onclick="renderDetails(${index})">
        ${cover ? `<img src="${cover}" alt="${title}" class="${imgClass}" />` : ''}
        <div class="item-details">
          <span class="item-tag" style="color: ${tagColor}">${tag}</span>
          <h2 class="item-title">${formatAlbumTitles(title)}</h2>
          <span class="item-sub">${sub}</span>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  app.innerHTML = html;
}

// Affichage de la vue détaillée
function renderDetails(index) {
  const item = catalogData[index];
  if (backBtn) backBtn.classList.remove('hidden');
  
  const tag = item.tag || item.genre || 'MINIDISC';
  if (headerTitle) headerTitle.textContent = tag;
  
  const cover = item.cover || item.image || item.coverUrl || '';
  
  let title = item.title || item.name || '';
  if (!title && item.albums && Array.isArray(item.albums)) {
    title = item.albums.map(a => a.title || a.name || a).join(' / ');
  }
  
  let sub = item.sub || item.subtitle || item.artist || '';
  if (!sub && item.albums && Array.isArray(item.albums)) {
    const artists = item.albums.map(a => a.artist).filter(Boolean).join(' / ');
    sub = artists;
  }
  
  let html = `
    <div class="track-container">
      <div class="album-header">
        ${cover ? `<img src="${cover}" alt="${title}" class="album-cover-large" />` : ''}
        <div>
          <h2 class="item-title">${formatAlbumTitles(title)}</h2>
          <span class="item-sub">${sub}</span>
        </div>
      </div>
      <ul class="track-list">
  `;
  
  // Extraction des pistes (soit sous item.tracks, soit imbriquées dans item.albums)
  let tracks = item.tracks || [];
  if (tracks.length === 0 && item.albums) {
    item.albums.forEach(alb => {
      if (alb.tracks) {
        tracks = tracks.concat(alb.tracks);
      }
    });
  }

  if (tracks.length > 0) {
    tracks.forEach((track, idx) => {
      const num = track.number || track.trackNumber || (idx + 1);
      const trackTitle = track.title || track.name || track;
      const artist = track.artist ? `— <em>${track.artist}</em>` : '';
      html += `
        <li class="track-item">
          <strong>${num}.</strong> ${trackTitle} ${artist}
        </li>
      `;
    });
  } else {
    html += `<li class="track-item">Aucune piste répertoriée.</li>`;
  }
  
  html += `
      </ul>
    </div>
  `;
  
  app.innerHTML = html;
}

// Bouton retour
if (backBtn) {
  backBtn.addEventListener('click', renderList);
}
