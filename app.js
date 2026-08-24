// Globales
let catalogData = [];
const app = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');

// 1. Fonction post-traitement : applique l'alternance de couleurs sur les titres affichés
function applyAlternatingColors() {
  const titles = document.querySelectorAll('.item-title');
  titles.forEach(el => {
    // Si l'élément a déjà été traité, on passe
    if (el.dataset.colorized === "true") return;
    
    const text = el.textContent || '';
    if (text.includes('/')) {
      const albums = text.split('/').map(a => a.trim());
      const formatted = albums.map((album, index) => {
        const colorClass = (index % 2 === 0) ? 'title-color-1' : 'title-color-2';
        return `<span class="${colorClass}">${album}</span>`;
      }).join(' <span class="title-separator">/</span> ');
      
      el.innerHTML = formatted;
      el.dataset.colorized = "true";
    } else {
      el.innerHTML = `<span class="title-color-1">${text}</span>`;
      el.dataset.colorized = "true";
    }
  });
}

// 2. Observer le DOM pour colorer automatiquement dès que la liste ou un détail est injecté
const observer = new MutationObserver(() => {
  applyAlternatingColors();
});
observer.observe(app, { childList: true, subtree: true });

// 3. Chargement de data.json
fetch('./data.json')
  .then(res => {
    if (!res.ok) throw new Error(`Erreur HTTP: ${res.status}`);
    return res.json();
  })
  .then(data => {
    catalogData = data;
    renderList();
  })
  .catch(err => {
    console.error("Erreur de chargement :", err);
  });

// 4. Affichage de la liste principale
function renderList() {
  if (backBtn) backBtn.classList.add('hidden');
  if (headerTitle) headerTitle.textContent = "MINIDISC";
  
  // Utilisation de l'historique Android
  if (window.location.hash !== '') {
    history.replaceState(null, '', window.location.pathname);
  }
  
  let html = '<div class="list-container">';
  
  catalogData.forEach((item, index) => {
    // Conservation de toute la structure d'origine
    const imgClass = item.type === 'md' ? 'md-thumb' : 'album-thumb';
    const tagColor = item.tagColor || item.color || '#7b2cbf';
    const coverPath = item.cover || item.image || '';
    const tagText = item.tag || item.genre || 'MINIDISC';
    
    // Titre brut (la coloration sera faite par l'observer)
    let displayTitle = item.title || '';
    if (!displayTitle && item.albums) {
      displayTitle = item.albums.map(a => a.title || a.name || a).join(' / ');
    }
    
    // Sous-titre brut
    let displaySub = item.sub || item.subtitle || '';
    if (!displaySub && item.albums) {
      displaySub = `${item.albums.length} Albums • ` + item.albums.map(a => a.artist || '').filter(Boolean).join(' / ');
    }
    
    html += `
      <div class="list-item" onclick="renderDetails(${index})">
        ${coverPath ? `<img src="${coverPath}" alt="${displayTitle}" class="${imgClass}" />` : ''}
        <div class="item-details">
          <span class="item-tag" style="color: ${tagColor}">${tagText}</span>
          <h2 class="item-title">${displayTitle}</h2>
          <span class="item-sub">${displaySub}</span>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  app.innerHTML = html;
}

// 5. Affichage des détails (MiniDisc / Albums / Pistes)
function renderDetails(index) {
  const item = catalogData[index];
  if (!item) return;
  
  if (backBtn) backBtn.classList.remove('hidden');
  if (headerTitle) headerTitle.textContent = item.tag || item.genre || "DÉTAILS";
  
  // Met à jour l'historique de navigation (Bouton retour natif Android)
  history.pushState({ detailIndex: index }, '', `#detail-${index}`);
  
  const coverPath = item.cover || item.image || '';
  let displayTitle = item.title || '';
  if (!displayTitle && item.albums) {
    displayTitle = item.albums.map(a => a.title || a.name || a).join(' / ');
  }
  
  let html = `
    <div class="track-container">
      <div class="album-header">
        ${coverPath ? `<img src="${coverPath}" alt="${displayTitle}" class="album-cover-large" />` : ''}
        <div>
          <h2 class="item-title">${displayTitle}</h2>
          <span class="item-sub">${item.sub || ''}</span>
        </div>
      </div>
  `;
  
  // Affichage selon la structure (albums sous-jacents ou liste directe de pistes)
  if (item.albums && item.albums.length > 0) {
    html += `<div class="albums-sublist">`;
    item.albums.forEach(alb => {
      html += `
        <div class="album-block" style="margin-bottom: 20px;">
          <h3 style="margin-bottom: 8px; font-size: 1.1rem; color: #7b2cbf;">${alb.title || alb.name}</h3>
          ${alb.artist ? `<p style="font-size: 0.85rem; color: #64748b; margin-bottom: 10px;">${alb.artist}</p>` : ''}
          <ul class="track-list">
      `;
      if (alb.tracks) {
        alb.tracks.forEach((t, i) => {
          const num = t.number || (i + 1);
          const tTitle = t.title || t.name || t;
          html += `<li class="track-item"><strong>${num}.</strong> ${tTitle}</li>`;
        });
      }
      html += `</ul></div>`;
    });
    html += `</div>`;
  } else if (item.tracks && item.tracks.length > 0) {
    html += `<ul class="track-list">`;
    item.tracks.forEach((t, i) => {
      const num = t.number || (i + 1);
      const tTitle = t.title || t.name || t;
      const tArtist = t.artist ? ` — <em>${t.artist}</em>` : '';
      html += `<li class="track-item"><strong>${num}.</strong> ${tTitle}${tArtist}</li>`;
    });
    html += `</ul>`;
  }
  
  html += `</div>`;
  app.innerHTML = html;
}

// Gestion du retour via le bouton de l'interface ou le bouton retour Android
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
