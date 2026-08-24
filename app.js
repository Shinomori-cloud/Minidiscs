// Fonction pour alterner les couleurs sur les titres séparés par "/"
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

// Exemple de données (remplace par ton propre tableau si besoin)
const minidiscData = [
  {
    id: "rock-garage",
    tag: "ROCK GARAGE",
    tagColor: "#e67e22",
    type: "md",
    title: "Siamese Dream / In Utero / Live Through This",
    sub: "3 Albums • Smashing Pumpkins / Nirvana / Hole",
    cover: "/Minidiscs/images/rock-garage.jpg",
    tracks: [
      { number: 1, title: "Cherub Rock", artist: "Smashing Pumpkins", album: "Siamese Dream" },
      { number: 2, title: "Serve the Servants", artist: "Nirvana", album: "In Utero" },
      { number: 3, title: "Violet", artist: "Hole", album: "Live Through This" }
    ]
  }
];

// Gestion de l'affichage principal
const app = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');

function renderList() {
  backBtn.classList.add('hidden');
  headerTitle.textContent = "MINIDISC";
  
  let html = '<div class="list-container">';
  
  minidiscData.forEach((item, index) => {
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

function renderDetails(index) {
  const item = minidiscData[index];
  backBtn.classList.remove('hidden');
  headerTitle.textContent = item.tag;
  
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
  
  item.tracks.forEach(track => {
    html += `
      <li class="track-item">
        <strong>${track.number}.</strong> ${track.title} — <em>${track.artist}</em>
      </li>
    `;
  });
  
  html += `
      </ul>
    </div>
  `;
  
  app.innerHTML = html;
}

backBtn.addEventListener('click', renderList);

// Initialisation au chargement
renderList();
