// Variable globale pour stocker la collection chargée depuis data.json
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

// Chargement automatique des données depuis data.json
fetch('./data.json')
  .then(response => {
    if (!response.ok) throw new Error(`Erreur de chargement (${response.status})`);
    return response.json();
  })
  .then(data => {
    catalogData = data;
    renderList();
  })
  .catch(error => {
    console.error("Erreur lors du chargement des données :", error);
    app.innerHTML = `<p style="text-align:center; padding: 20px;">Erreur de chargement du fichier data.json</p>`;
  });

// Affichage de la liste principale
function renderList() {
  if (backBtn) backBtn.classList.add('hidden');
  if (headerTitle) headerTitle.textContent = "MINIDISC";
  
  let html = '<div class="list-container">';
  
  catalogData.forEach((item, index) => {
    const imgClass = item.type === 'md' ? 'md-thumb' : 'album-thumb';
    const tagColor = item.tagColor || '#7b2cbf';
    
    html += `
      <div class="list-item" onclick="renderDetails(${index})">
        <img src="${item.cover}" alt="${item.title}" class="${imgClass}" />
        <div class="item-details">
          <span class="item-tag" style="color: ${tagColor}">${item.tag}</span>
          <h2 class="item-title">${formatAlbumTitles(item.title)}</h2>
          <span class="item-sub">${item.sub}</span>
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
  if (headerTitle) headerTitle.textContent = item.tag;
  
  let html = `
    <div class="track-container">
      <div class="album-header">
        <img src="${item.cover}" alt="${item.title}" class="album-cover-large" />
        <div>
          <h2 class="item-title">${formatAlbumTitles(item.title)}</h2>
          <span class="item-sub">${item.sub}</span>
        </div>
      </div>
      <ul class="track-list">
  `;
  
  if (item.tracks && item.tracks.length > 0) {
    item.tracks.forEach(track => {
      html += `
        <li class="track-item">
          <strong>${track.number}.</strong> ${track.title} ${track.artist ? `— <em>${track.artist}</em>` : ''}
        </li>
      `;
    });
  }
  
  html += `
      </ul>
    </div>
  `;
  
  app.innerHTML = html;
}

// Gestion du bouton retour
if (backBtn) {
  backBtn.addEventListener('click', renderList);
}
