let catalogData = [];

// Fonction automatique pour alterner la couleur des titres séparés par "/"
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
    console.error("Erreur de chargement de data.json :", error);
    app.innerHTML = `<p style="text-align:center; padding: 20px;">Erreur de chargement du fichier data.json</p>`;
  });

// Affichage de la liste principale des MiniDiscs
function renderList() {
  if (backBtn) backBtn.classList.add('hidden');
  if (headerTitle) headerTitle.textContent = "MINIDISC";
  
  if (window.location.hash !== '') {
    history.replaceState(null, '', window.location.pathname);
  }
  
  let html = '<div class="list-container">';
  
  catalogData.forEach((item, index) => {
    const imgClass = item.type === 'md' ? 'md-thumb' : 'album-thumb';
    const tagColor = item.tagColor || item.color || '#7b2cbf';
    const tagText = item.tag || item.genre || 'MINIDISC';
    
    html += `
      <div class="list-item" onclick="renderDetails(${index})">
        <img src="${item.cover}" alt="${item.title}" class="${imgClass}" />
        <div class="item-details">
          <span class="item-tag" style="color: ${tagColor}">${tagText}</span>
          <h2 class="item-title">${formatAlbumTitles(item.title)}</h2>
          <span class="item-sub">${item.sub}</span>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  app.innerHTML = html;
}

// Affichage de la vue détaillée (avec la couche Albums)
function renderDetails(index) {
  const item = catalogData[index];
  if (!item) return;
  
  if (backBtn) backBtn.classList.remove('hidden');
  if (headerTitle) headerTitle.textContent = item.tag || item.genre || "DÉTAILS";
  
  history.pushState({ detailIndex: index }, '', `#detail-${index}`);
  
  let html = `
    <div class="track-container">
      <div class="album-header">
        <img src="${item.cover}" alt="${item.title}" class="album-cover-large" />
        <div>
          <h2 class="item-title">${formatAlbumTitles(item.title)}</h2>
          <span class="item-sub">${item.sub}</span>
        </div>
      </div>
  `;
  
  // Couche 1 : Si le MiniDisc contient plusieurs albums avec leurs propres pochettes/pistes
  if (item.albums && item.albums.length > 0) {
    html += `<div class="albums-sublist">`;
    item.albums.forEach(album => {
      html += `
        <div class="album-block" style="margin-bottom: 24px;">
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
            ${album.cover ? `<img src="${album.cover}" style="width:60px; height:60px; border-radius:8px; object-fit:cover;" />` : ''}
            <div>
              <h3 style="font-size: 1.1rem; color: #7b2cbf;">${album.title}</h3>
              ${album.artist ? `<p style="font-size: 0.85rem; color: #64748b;">${album.artist}</p>` : ''}
            </div>
          </div>
          <ul class="track-list">
      `;
      if (album.tracks) {
        album.tracks.forEach(track => {
          html += `
            <li class="track-item">
              <strong>${track.number}.</strong> ${track.title}
            </li>
          `;
        });
      }
      html += `</ul></div>`;
    });
    html += `</div>`;
  } 
  // Couche 2 : Si c'est une compilation directe avec une liste unique de pistes
  else if (item.tracks && item.tracks.length > 0) {
    html += `<ul class="track-list">`;
    item.tracks.forEach(track => {
      html += `
        <li class="track-item">
          <strong>${track.number}.</strong> ${track.title} ${track.artist ? `— <em>${track.artist}</em>` : ''}
        </li>
      `;
    });
    html += `</ul>`;
  }
  
  html += `</div>`;
  app.innerHTML = html;
}

// Navigation du bouton retour
if (backBtn) {
  backBtn.addEventListener('click', () => {
    renderList();
  });
}

window.addEventListener('popstate', (e) => {
  if (e.state && e.state.detailIndex !== undefined) {
    renderDetails(e.state.detailIndex);
  } else {
    renderList();
  }
});
