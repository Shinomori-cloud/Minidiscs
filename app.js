/* ==========================================
   VARIABLES GLOBALES & ÉLÉMENTS DOM
   ========================================== */
let catalogData = null;
let currentMD = null;
let currentAlbum = null;
let currentGenreFilters = new Set(); // Gestion multi-genres pour le catalogue principal
let currentGenreFilter = null;       // Genre unique filtré sur la page "Minidiscs" (ex: 'ROCK & BLUES')
let currentTypeFilter = null;
let currentSearchQuery = '';
let adminAlbumCount = 0;
let editingMDIndex = null;
let toastTimeout = null;
let selectedIdeaIndices = new Set();
let currentRecordFilter = 'all'; // 'all', 'toRecord', 'recorded'

// Filtre multi-genres et état du menu déroulant du planificateur
let currentPlannerGenreFilters = new Set();
let isPlannerGenreDropdownOpen = false;

// Dépôt GitHub qui héberge le site et le fichier de données
const GITHUB_USER = 'Shinomori-cloud';
const GITHUB_REPO = 'Minidiscs';
const GITHUB_DATA_PATH = 'data.json';
const GITHUB_API_BASE = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/`;

// Clés du localStorage
const STORAGE_KEY = 'minidisc_catalog_backup';               // copie locale des données
const SYNC_META_KEY = 'minidisc_sync_meta';                   // état de synchro (modifs en attente, version GitHub connue)
const CONFLICT_BACKUP_KEY = 'minidisc_remote_conflict_backup'; // copie de sécurité si GitHub a changé ailleurs

const REMOTE_WAIT_MS = 2000; // au-delà, on affiche la copie locale en attendant la réponse de GitHub

const app = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const featuredContainer = document.getElementById('featured-container');

/* ==========================================
   STOCKAGE LOCAL & SYNCHRONISATION GITHUB
   ------------------------------------------
   - Toute modification est appliquée et affichée immédiatement (données en mémoire), puis
     enregistrée sur l'appareil (localStorage) et envoyée à GitHub en arrière-plan.
   - Tant que l'envoi n'est pas confirmé ("pending"), la copie locale fait foi : elle n'est
     jamais écrasée par une version distante plus ancienne.
   - Au chargement, les données sont lues via l'API GitHub (dernier commit, sans le délai de
     déploiement de GitHub Pages). data.json puis la copie locale servent de solutions de secours.
   ========================================== */
let changeCounter = 0;      // incrémenté à chaque modification enregistrée
let syncInFlight = false;   // un envoi GitHub est en cours
let syncAgain = false;      // une modification est arrivée pendant l'envoi : il faudra renvoyer

function buildPayload() {
  return {
    minidiscs: catalogData || [],
    ideaAlbums: window.ideaAlbums || []
  };
}

function readLocalBackup() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function readSyncMeta() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_META_KEY)) || {};
  } catch (err) {
    return {};
  }
}

function writeSyncMeta(patch) {
  const meta = { ...readSyncMeta(), ...patch };
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch (err) {
    console.error("Erreur de sauvegarde de l'état de synchro:", err);
  }
  return meta;
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const CHUNK = 0x8000; // évite de dépasser la limite d'arguments de String.fromCharCode
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// Appelée après chaque modification : la vue est déjà à jour, on sécurise les données.
function saveLocalBackup() {
  changeCounter++;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPayload()));
  } catch (err) {
    console.error("Erreur de sauvegarde locale:", err);
  }

  // Sans token, la sauvegarde reste locale uniquement.
  if (getGithubToken()) {
    writeSyncMeta({ pending: true });
    syncCollectionToGithub();
  }
}

// Envoie la collection à GitHub. Les envois sont mis en file : jamais deux en parallèle,
// et le dernier état est toujours celui qui part.
async function syncCollectionToGithub() {
  const token = getGithubToken();
  if (!token) {
    console.warn("Pas de token GitHub configuré. Sauvegarde locale uniquement.");
    return false;
  }
  if (syncInFlight) {
    syncAgain = true;
    return false;
  }

  syncInFlight = true;
  let success = false;
  try {
    do {
      syncAgain = false;
      success = await pushCollectionToGithub(token);
    } while (syncAgain);
  } finally {
    syncInFlight = false;
  }

  if (success) {
    showToast("☁️ Synchronisé avec GitHub", 2000);
  } else {
    showToast("⚠️ Synchro GitHub impossible : modifications gardées sur cet appareil", 4500);
  }
  return success;
}

async function pushCollectionToGithub(token) {
  const url = GITHUB_API_BASE + GITHUB_DATA_PATH;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json'
  };

  // Jusqu'à 3 essais : si le fichier a changé entre-temps (SHA périmé), on relit et on renvoie.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // A. SHA actuel du fichier (nécessaire pour l'écraser)
      let sha = '';
      const getResponse = await fetch(url, { headers, cache: 'no-store' });
      if (getResponse.ok) {
        const fileData = await getResponse.json();
        sha = fileData.sha || '';
        keepCopyIfRemoteChanged(fileData);
      } else if (getResponse.status !== 404) {
        console.error("Erreur de lecture GitHub avant synchro :", getResponse.status);
        return false;
      }

      // B. Dernière version des données, en JSON puis Base64 (UTF-8)
      const versionSent = changeCounter;
      const base64Content = utf8ToBase64(JSON.stringify(buildPayload(), null, 2));

      // C. Envoi
      const putResponse = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Mise à jour automatique de la collection MiniDisc',
          content: base64Content,
          ...(sha ? { sha } : {})
        })
      });

      if (putResponse.ok) {
        const result = await putResponse.json();
        const newSha = result && result.content ? result.content.sha : null;
        // Si l'utilisateur a modifié autre chose pendant l'envoi, ça reste "en attente"
        writeSyncMeta(versionSent === changeCounter
          ? { pending: false, baseSha: newSha, syncedAt: Date.now() }
          : { baseSha: newSha });
        console.log("Synchronisation GitHub réussie !");
        return true;
      }

      if (putResponse.status === 409 || putResponse.status === 422) continue; // SHA périmé : on réessaie

      console.error("Erreur lors de la synchro GitHub :", await putResponse.json().catch(() => ({})));
      return false;
    } catch (error) {
      console.error("Erreur réseau pendant la synchronisation :", error);
      return false;
    }
  }
  return false;
}

// Si data.json a changé sur GitHub depuis notre dernière synchro (autre appareil...), la copie locale
// prime quand même, mais on garde une copie de sécurité de la version distante avant de l'écraser.
function keepCopyIfRemoteChanged(fileData) {
  const meta = readSyncMeta();
  if (!meta.baseSha || !fileData || !fileData.sha || meta.baseSha === fileData.sha) return;

  console.warn("data.json a été modifié sur GitHub depuis la dernière synchro : copie de sécurité conservée.");
  try {
    if (fileData.content && fileData.encoding === 'base64') {
      localStorage.setItem(CONFLICT_BACKUP_KEY, base64ToUtf8(fileData.content));
    }
  } catch (err) {
    console.error("Impossible de conserver la copie de sécurité :", err);
  }
}

// Relance l'envoi des modifications restées en attente (retour du réseau, retour sur l'appli...)
function retryPendingSync() {
  if (catalogData === null || syncInFlight) return;
  if (getGithubToken() && readSyncMeta().pending) syncCollectionToGithub();
}

window.addEventListener('online', retryPendingSync);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') retryPendingSync();
});

/* ==========================================
   CHARGEMENT DES DONNÉES
   ========================================== */
// Lecture via l'API GitHub : reflète tout de suite le dernier commit.
async function fetchCollectionFromGithubApi() {
  const token = getGithubToken();
  const url = GITHUB_API_BASE + GITHUB_DATA_PATH;
  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(url, { headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`API GitHub : HTTP ${response.status}`);
  const file = await response.json();

  let text;
  if (file.content && file.encoding === 'base64') {
    text = base64ToUtf8(file.content);
  } else {
    // Fichier > 1 Mo : l'API ne fournit pas le contenu encodé, on demande le brut
    const rawResponse = await fetch(url, {
      headers: { ...headers, 'Accept': 'application/vnd.github.raw+json' },
      cache: 'no-store'
    });
    if (!rawResponse.ok) throw new Error(`API GitHub (brut) : HTTP ${rawResponse.status}`);
    text = await rawResponse.text();
  }

  return { data: JSON.parse(text), sha: file.sha || null };
}

// GitHub d'abord (à jour), puis data.json tel que publié par GitHub Pages (peut avoir du retard).
async function fetchRemoteCollection() {
  try {
    return await fetchCollectionFromGithubApi();
  } catch (err) {
    console.warn("API GitHub indisponible, lecture de data.json :", err);
  }

  const response = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error("Erreur de réseau lors du chargement du fichier JSON.");
  return { data: await response.json(), sha: null };
}

// La version GitHub devient la référence, et la copie locale la suit (secours si GitHub tombe).
function adoptRemoteCollection(remote) {
  processLoadedData(remote.data);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPayload()));
  } catch (err) {
    console.error("Erreur de sauvegarde locale:", err);
  }
  writeSyncMeta(remote.sha ? { pending: false, baseSha: remote.sha } : { pending: false });
}

// Réponse GitHub arrivée après l'affichage de la copie locale : mise à jour discrète,
// sauf si l'utilisateur a déjà modifié quelque chose ou remplit un formulaire.
function applyLateRemote(remote) {
  const formOpen = ['admin-modal', 'idea-modal'].some(id => {
    const modal = document.getElementById(id);
    return modal && !modal.classList.contains('hidden');
  });
  if (changeCounter > 0 || readSyncMeta().pending || formOpen) return;

  const before = JSON.stringify(buildPayload());
  adoptRemoteCollection(remote);
  if (JSON.stringify(buildPayload()) !== before) handleRoute();
}

async function initData() {
  const backup = readLocalBackup();

  // 1) Des modifications locales attendent encore leur envoi : elles font foi.
  //    On les affiche tout de suite et on relance l'envoi.
  if (backup && getGithubToken() && readSyncMeta().pending) {
    processLoadedData(backup);
    handleRoute();
    syncCollectionToGithub();
    return;
  }

  // 2) Sinon GitHub fait foi. Si sa réponse tarde, on affiche la copie locale en attendant.
  const remotePromise = fetchRemoteCollection().catch(err => {
    console.error(err);
    return null;
  });

  let remote;
  if (backup) {
    const waited = await Promise.race([
      remotePromise,
      new Promise(resolve => setTimeout(() => resolve(undefined), REMOTE_WAIT_MS))
    ]);

    if (waited === undefined) {
      processLoadedData(backup);
      handleRoute();
      const late = await remotePromise;
      if (late) applyLateRemote(late);
      return;
    }
    remote = waited;
  } else {
    remote = await remotePromise;
  }

  if (remote) {
    adoptRemoteCollection(remote);
    handleRoute();
    return;
  }

  // 3) GitHub injoignable : copie locale, ou message d'erreur si on n'a rien.
  if (backup) {
    processLoadedData(backup);
    handleRoute();
    return;
  }

  catalogData = [];
  window.ideaAlbums = [];
  app.innerHTML = `
    <div style="text-align:center; padding: 40px; color: var(--text-sub);">
      <p style="color: #e63946; font-weight: bold; font-size: 1.1rem;">⚠️ Erreur de chargement de data.json</p>
    </div>
  `;
}

/* ==========================================
   GESTION DE LA RECHERCHE CATALOGUE VIA FAB
   ========================================== */
function handleCatalogSearch(query) {
  // Met à jour la variable globale de recherche
  currentSearchQuery = query ? query.trim() : '';

  // Relance le rendu du catalogue avec les filtres actifs et la recherche
  renderMDList({ 
    genre: currentGenreFilter, 
    type: currentTypeFilter, 
    record: currentRecordFilter 
  }, false);
}

// Application du filtre sélectionné et rafraîchissement de la liste
function selectGenreFilter(genre) {
  currentGenreFilter = (genre === 'ALL' || !genre) ? '' : genre.toUpperCase().trim();

  const dropdown = document.getElementById('genre-filter-dropdown');
  if (dropdown) dropdown.classList.add('hidden');

  // Rafraîchit l'état actif et la coche dans le menu FAB des genres
  populateFabGenreMenu();

  renderMDList({ 
    genre: currentGenreFilter, 
    type: currentTypeFilter, 
    record: currentRecordFilter 
  }, false);
}

function mdMatchesSearch(md, query) {
  if (!query) return true;
  const q = query.toLowerCase().trim();

  if (md.title && md.title.toLowerCase().includes(q)) return true;
  if (md.artist && md.artist.toLowerCase().includes(q)) return true;

  const genres = getMDAllGenres(md);
  if (genres.some(g => g.toLowerCase().includes(q))) return true;

  const types = getMDAllTypes(md);
  if (types.some(t => t.toLowerCase().includes(q))) return true;

  if (md.tracks && md.tracks.some(t => t.toLowerCase().includes(q))) return true;

  if (md.albums && md.albums.length > 0) {
    for (const album of md.albums) {
      if (album.title && album.title.toLowerCase().includes(q)) return true;
      if (album.artist && album.artist.toLowerCase().includes(q)) return true;
      if (album.release_year && String(album.release_year).includes(q)) return true;
      if (album.tracks && album.tracks.some(t => t.toLowerCase().includes(q))) return true;
    }
  }

  return false;
}

function onSearchInput(value) {
  currentSearchQuery = value;
  renderMDList({ 
    genre: currentGenreFilter, 
    type: currentTypeFilter, 
    record: currentRecordFilter 
  }, false);
}

function updateSearchVisibility(show) {
  const floatingActions = document.getElementById('floating-actions');
  const topSearch = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  const fabBtn = document.getElementById('btn-search');
  const genreDropdown = document.getElementById('genre-filter-dropdown');

  if (show) {
    if (floatingActions) floatingActions.classList.remove('hidden');
    if (typeof updateFilterIcon === 'function') {
      updateFilterIcon();
    }
  } else {
    if (floatingActions) floatingActions.classList.add('hidden');
    if (fabBtn) fabBtn.textContent = '🔍';
    if (topSearch) topSearch.classList.add('closed');
    if (genreDropdown) genreDropdown.classList.add('hidden');

    currentSearchQuery = '';
    if (searchInput) searchInput.value = '';
  }
}

/* ==========================================
   GESTION DU MENU FLOTTANT (FAB) - CATALOGUE
   ========================================== */

// Ouvre et ferme le menu déroulant principal
function toggleFabMenu() {
  const menu = document.getElementById('fab-menu');
  const btn = document.getElementById('fab-main-btn');
  if (!menu) return;

  const isOpening = menu.classList.contains('hidden');
  menu.classList.toggle('hidden');
  
  if (btn) {
    btn.classList.toggle('open', isOpening);
  }

  // Ferme les sous-menus si on ferme le FAB
  if (!isOpening) {
    document.getElementById('genres-submenu')?.classList.add('hidden');
    document.getElementById('status-submenu')?.classList.add('hidden');
  }
}

// Ferme le menu si l'utilisateur clique en dehors de la zone du FAB
document.addEventListener('click', (e) => {
  const container = document.getElementById('floating-actions') || document.querySelector('.fab-container');
  const menu = document.getElementById('fab-menu');
  if (container && menu && !container.contains(e.target)) {
    menu.classList.add('hidden');
    document.getElementById('genres-submenu')?.classList.add('hidden');
    document.getElementById('status-submenu')?.classList.add('hidden');
  }
});

// Bascule l'affichage d'un sous-menu spécifique (genres ou statut)
function toggleFabSubmenu(id) {
  const targetSubmenu = document.getElementById(id);
  if (!targetSubmenu) return;

  const isHidden = targetSubmenu.classList.contains('hidden');

  // Ferme l'autre sous-menu pour éviter les chevauchements
  const otherId = id === 'genres-submenu' ? 'status-submenu' : 'genres-submenu';
  document.getElementById(otherId)?.classList.add('hidden');

  targetSubmenu.classList.toggle('hidden', !isHidden);

  // Si on ouvre les genres, on génère dynamiquement le contenu
  if (id === 'genres-submenu' && isHidden) {
    populateFabGenreMenu();
  }
}

// Applique le filtre de statut directement au clic sans fermer le FAB
function applyStatusFilter(filterValue, event) {
  if (event) {
    event.stopPropagation();
  }

  let targetRecord = 'all';
  if (filterValue === 'torecord') {
    targetRecord = 'toRecord';
  } else if (filterValue === 'recorded') {
    targetRecord = 'recorded';
  }

  renderMDList({ 
    genre: typeof currentGenreFilter !== 'undefined' ? currentGenreFilter : '', 
    type: typeof currentTypeFilter !== 'undefined' ? currentTypeFilter : '', 
    record: targetRecord 
  }, false);

  // Garde le sous-menu statut ouvert et rafraîchit l'état visuel si besoin
  const statusSubmenu = document.getElementById('status-submenu');
  if (statusSubmenu) {
    statusSubmenu.classList.remove('hidden');
  }
}

// Remplit le sous-menu FAB des genres avec "TOUS" fixe en haut
function populateFabGenreMenu() {
  const container = document.getElementById('genres-submenu');
  if (!container || !catalogData) return;

  const allGenres = new Set();
  const rawData = Array.isArray(catalogData) ? catalogData : (catalogData.minidiscs || []);

  rawData.forEach(md => {
    let genres = [];
    if (typeof getMDAllGenres === 'function') {
      genres = getMDAllGenres(md);
    } else if (md.genre) {
      genres = typeof md.genre === 'string' ? md.genre.split(',') : md.genre;
    }

    genres.forEach(g => {
      if (g && typeof g === 'string' && g.trim()) {
        allGenres.add(g.trim().toUpperCase());
      }
    });
  });

  container.innerHTML = '';

  if (allGenres.size === 0) {
    container.innerHTML = `<span style="font-size: 0.75rem; color: var(--text-sub); padding: 6px 12px;">Aucun genre</span>`;
    return;
  }

  const activeGenreNorm = typeof currentGenreFilter !== 'undefined' && currentGenreFilter ? currentGenreFilter.toUpperCase().trim() : '';

  const createGenreBtn = (text, isSelected, genreValue, isSticky = false) => {
    const btn = document.createElement('div');
    btn.className = `fab-genre-item ${isSelected ? 'active' : ''}`;

    if (isSticky) {
      btn.style.position = 'sticky';
      btn.style.top = '0';
      btn.style.zIndex = '10';
      btn.style.backgroundColor = 'var(--bg-card, #1a1a1a)';
      btn.style.borderBottom = '1px solid var(--border-color, rgba(255, 255, 255, 0.1))';
    }

    btn.innerHTML = `<span>${text}</span>${isSelected ? '<span>✓</span>' : ''}`;
    btn.onclick = (e) => {
      e.stopPropagation();
      if (typeof selectGenreFilter === 'function') {
        selectGenreFilter(genreValue);
      }
    };
    return btn;
  };

  // Option "TOUS" fixée en haut
  const isAllActive = !activeGenreNorm || activeGenreNorm === 'ALL';
  container.appendChild(createGenreBtn('TOUS', isAllActive, 'ALL', true));

  // Boutons par genre
  Array.from(allGenres).sort().forEach(genre => {
    const isSelected = activeGenreNorm === genre;
    container.appendChild(createGenreBtn(genre, isSelected, genre));
  });
}

/* ==========================================
   UTILITAIRE TOAST
   ========================================== */
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.remove('hidden');

  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

/* ==========================================
   GENRE(S) FILTRÉ(S) AFFICHÉ(S) SOUS LE TITRE DU HEADER
   ------------------------------------------
   L'encart a une taille fixe (voir style.css) : c'est le texte qui rétrécit pour y tenir,
   afin de ne jamais déformer la page. Il n'apparaît que lorsqu'un filtre par genre est actif.
   ========================================== */
const HEADER_GENRE_MAX_FONT = 12; // px : taille normale du texte
const HEADER_GENRE_MIN_FONT = 7;  // px : en dessous, le texte est tronqué avec "…"

function setHeaderGenreInfo(genres) {
  const box = document.getElementById('header-genre-info');
  const text = document.getElementById('header-genre-text');
  if (!box || !text) return;

  const names = (genres || []).map(g => String(g).trim()).filter(Boolean);
  if (names.length === 0) {
    box.classList.add('hidden');
    text.textContent = '';
    return;
  }

  text.textContent = names.join(' · ');
  box.classList.remove('hidden');
  fitHeaderGenreText();
}

function fitHeaderGenreText() {
  const box = document.getElementById('header-genre-info');
  const text = document.getElementById('header-genre-text');
  if (!box || !text || box.classList.contains('hidden')) return;

  let size = HEADER_GENRE_MAX_FONT;
  text.style.fontSize = size + 'px';
  while (size > HEADER_GENRE_MIN_FONT && text.scrollWidth > text.clientWidth) {
    size -= 0.5;
    text.style.fontSize = size + 'px';
  }
}

window.addEventListener('resize', fitHeaderGenreText);

/* ==========================================
   UTILITAIRES MULTI-GENRE & MULTI-TYPE
   ========================================== */
function getNormalizedList(data) {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.map(v => String(v).toUpperCase().trim()).filter(v => v !== '');
  }
  return String(data).split(',').map(v => v.toUpperCase().trim()).filter(v => v !== '');
}

function getNormalizedGenres(genreData) {
  return getNormalizedList(genreData);
}

// L'affichage et le filtrage de l'appli ne considèrent que le genre principal
// (main_genre, un seul des 8 genres fixes) — les tags servent uniquement à un
// classement plus fin, pas affiché dans les listes ni les filtres.
function getItemGenreList(item) {
  if (!item) return [];
  
  const genres = [];

  // 1. Si l'objet a directement un genre (ou main_genre)
  const directGenre = item.main_genre || item.genre;
  if (directGenre) {
    if (Array.isArray(directGenre)) genres.push(...directGenre);
    else genres.push(directGenre);
  }

  // 2. Si l'objet est un MiniDisc contenant des albums
  if (item.albums && Array.isArray(item.albums)) {
    item.albums.forEach(album => {
      const albumGenre = album.main_genre || album.genre;
      if (albumGenre) {
        if (Array.isArray(albumGenre)) genres.push(...albumGenre);
        else genres.push(albumGenre);
      }
    });
  }

  return genres;
}

function getMDAllGenres(md) {
  const genresSet = new Set(getNormalizedGenres(getItemGenreList(md)));
  if (md.albums && md.albums.length > 0) {
    md.albums.forEach(album => {
      getNormalizedGenres(getItemGenreList(album)).forEach(g => genresSet.add(g));
    });
  }
  const result = Array.from(genresSet);
  return result.length > 0 ? result : ['AUTRE'];
}

function getAlbumGenres(album, parentMd) {
  const albumGenres = getNormalizedGenres(getItemGenreList(album));
  if (albumGenres.length > 0) return albumGenres;
  const parentGenres = getNormalizedGenres(getItemGenreList(parentMd));
  return parentGenres.length > 0 ? parentGenres : ['AUTRE'];
}

function getNormalizedTypes(typeData) {
  return getNormalizedList(typeData);
}

function getMDAllTypes(md) {
  const typesSet = new Set(getNormalizedTypes(md.type));
  if (md.albums && md.albums.length > 0) {
    md.albums.forEach(album => {
      getNormalizedTypes(album.type).forEach(t => typesSet.add(t));
    });
  }
  const result = Array.from(typesSet);
  return result.length > 0 ? result : ['ALBUM'];
}

/* ==========================================
   UTILITAIRES D'ALÉATOIRE FIXÉ SUR 24 HEURES
   ========================================== */
function getDailySeed() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function dailyShuffle(array, extraSeedKey = '') {
  const copy = [...array];
  const seedString = getDailySeed() + extraSeedKey;
  let hash = cyrb53(seedString);

  function seededRandom() {
    hash = (hash * 9301 + 49297) % 233280;
    return hash / 233280;
  }

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

/* ==========================================
   GESTION STRICTE DE L'HISTORIQUE
   ========================================== */
if (!window.location.hash || window.location.hash === '#') {
  window.history.replaceState({ view: 'dashboard' }, '', '#dashboard');
}

/* ==========================================
   INITIALISATION DATA & ÉCOUTEURS GLOBAUX
   ========================================== */

// Gestion du bouton Retour
if (backBtn) {
  backBtn.addEventListener('click', () => {
    if (currentAlbum !== null) {
      // Si on est dans le détail d'un album, retour au MiniDisc parent
      if (currentMD !== null) {
        window.location.hash = `#md-${currentMD}`;
      } else {
        window.location.hash = '#minidiscs';
      }
    } else if (currentMD !== null) {
      // Si on est dans le détail d'un MiniDisc, retour à la liste
      window.location.hash = '#minidiscs';
    } else {
      // Si on est dans la liste (filtrée ou non), retour au Dashboard
      currentGenreFilter = null;
      currentTypeFilter = null;
      currentRecordFilter = null;
      window.location.hash = '#dashboard';
      
      if (typeof renderDashboard === 'function') {
        renderDashboard(true);
      }
    }
  });
}

// Interception des soumissions de formulaires (évite le rechargement de page)
const adminForm = document.getElementById('admin-form');
if (adminForm) {
  adminForm.addEventListener('submit', submitNewMD);
}

const ideaForm = document.getElementById('idea-form');
if (ideaForm) {
  ideaForm.addEventListener('submit', saveIdeaAlbum);
}

function processLoadedData(data) {
  if (data && typeof data === 'object' && !Array.isArray(data) && data.minidiscs) {
    catalogData = data.minidiscs || [];
    window.ideaAlbums = data.ideaAlbums || [];
  } else if (Array.isArray(data)) {
    catalogData = data;
    if (!window.ideaAlbums) window.ideaAlbums = [];
  } else {
    catalogData = [];
    if (!window.ideaAlbums) window.ideaAlbums = [];
  }

  // Remplissage dynamique des menus déroulants une fois catalogData chargé
  populateFormDatalists();
}

// Fonction globale pour appliquer la vue selon l'URL (hash)
function handleRoute() {
  const hash = window.location.hash;
  if (hash.startsWith('#planner')) {
    if (typeof renderCompilPlanner === 'function') {
      renderCompilPlanner(false);
    }
  } else if (hash.startsWith('#minidiscs')) {
    const urlParams = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
    const genre = urlParams.get('genre');
    const type = urlParams.get('type');
    const record = urlParams.get('record');
    if (typeof renderMDList === 'function') {
      renderMDList({ genre, type, record }, false);
    }
  } else if (hash.startsWith('#md-')) {
    const mdIndex = parseInt(hash.replace('#md-', ''), 10);
    if (!isNaN(mdIndex) && catalogData[mdIndex] && typeof openMD === 'function') {
      openMD(mdIndex, false);
    } else if (typeof renderDashboard === 'function') {
      renderDashboard(false);
    }
  } else {
    if (typeof renderDashboard === 'function') {
      renderDashboard(false);
    }
  }
}

// Écouteur pour réagir aux clics sur les ancres / boutons de navigation
window.addEventListener('hashchange', handleRoute);

// Le chargement des données est lancé tout en bas du fichier (voir initData).

/* ==========================================
   COULEURS DYNAMIQUES PAR GENRE
   ========================================== */
// Une couleur fixe par genre, toujours la même (peu importe l'ordre de chargement).
// (teintes un peu plus lumineuses pour rester lisibles sur le fond sombre)
const genreColorMap = {
  'ALTERNATIVE & GRUNGE 90S': '#ff4d5e',
  'ROCK & BLUES': '#ff3d9a',
  'RAP, SOUL & REGGAE': '#ffc933',
  'METAL & HARD ROCK': '#b46cff',
  'POP & FOLK & VARIETY': '#5aa2ff',
  'TALKS & HUMOUR': '#ffa07a',
  'ÉLECTRO, TRIP-HOP & EXPÉRIMENTAL': '#00f0ff',
  'AMBIENT & ORCHESTRAL': '#2ee6b6',
  'AUTRE': '#b0b0c0',
};
// Couleurs de secours si jamais un genre hors de cette liste apparaît (données à corriger)
const genreColorPalette = ['#ff4d5e', '#ff3d9a', '#00f0ff', '#ffc933', '#b46cff', '#70e000', '#ff70a6', '#5aa2ff'];

// Couleur d'un genre (attribue une couleur de la palette aux genres inconnus)
function getSingleGenreColor(genre) {
  if (genreColorMap[genre]) return genreColorMap[genre];

  const assignedCount = Object.keys(genreColorMap).length;
  const color = genreColorPalette[assignedCount % genreColorPalette.length];
  genreColorMap[genre] = color;
  return color;
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return '#' + rgb.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

// Mélange de plusieurs couleurs de genres : moyenne des couleurs, puis on réavive le résultat
// (deux teintes éloignées donnent sinon un gris terne) pour rester dans l'esprit néon.
function mixGenreColors(hexColors) {
  if (hexColors.length === 1) return hexColors[0];

  const rgbs = hexColors.map(hexToRgb);
  const avg = [0, 1, 2].map(i => rgbs.reduce((sum, c) => sum + c[i], 0) / rgbs.length);
  let [h, sat, l] = rgbToHsl(avg[0], avg[1], avg[2]);

  // Moyenne quasi grise : la teinte n'a plus de sens, on garde celle du premier genre
  if (sat < 0.12) h = rgbToHsl(...rgbs[0])[0];

  return hslToHex(h, Math.max(sat, 0.7), Math.min(Math.max(l, 0.58), 0.68));
}

// Couleur de bordure d'une tuile : celle du genre, ou un mélange des couleurs si plusieurs genres
function getBorderColor(genreData) {
  const genres = getNormalizedGenres(genreData);
  if (genres.length === 0) return getSingleGenreColor('AUTRE');
  return mixGenreColors(genres.map(getSingleGenreColor));
}

// Construit un affichage où chaque genre garde sa propre couleur (au lieu de tout
// écrire dans la couleur du premier genre), utile quand un MiniDisc a plusieurs genres.
function genreListHTML(genresArray, fontSize = '0.8rem') {
  return genresArray
    .map(g => `<span style="color:${getBorderColor([g])}; font-weight:800; font-size:${fontSize};">${g}</span>`)
    .join(' <span style="color:var(--text-sub); font-weight:400;">/</span> ');
}

/* ==========================================
   SÉLECTION DU JOUR (24H)
   ========================================== */
function renderFeatured() {
  if (!catalogData || catalogData.length === 0) return;
  const featuredGrid = document.getElementById('featured-grid');
  if (!featuredGrid) return;

  const shuffled = dailyShuffle(catalogData, '-featured');
  const selected = shuffled.slice(0, 3);

  let html = '';
  selected.forEach(md => {
    const originalIndex = catalogData.indexOf(md);
    const mdCover = md.md_cover || (md.albums && md.albums[0] ? md.albums[0].md_cover : '') || '';
    html += `
      <div class="featured-item" onclick="openMD(${originalIndex})">
        <img class="featured-thumb" src="${resolveImageSrc(mdCover)}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'48\\' height=\\'68\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23e5e7eb\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'20\\' text-anchor=\\'middle\\' dominant-baseline=\\'central\\'>💽</text></svg>'">
      </div>
    `;
  });
  featuredGrid.innerHTML = html;
}

/* ==========================================
   VUES DE L'APPLICATION
   ========================================== */

/* ==========================================
   TAILLE DES VIGNETTES DE L'ACCUEIL
   ------------------------------------------
   L'accueil est en position fixe (il ne défile pas) : les vignettes du carrousel et les boutons du bas
   prennent toute la hauteur d'écran disponible, entre DASH_TILE_MIN et DASH_TILE_MAX.
   La taille est stockée dans la variable CSS --dash-tile.
   ========================================== */
const DASH_TILE_MIN = 72;   // px
const DASH_TILE_MAX = 140;  // px
const DASH_BOTTOM_GAP = 22; // px laissés libres sous les boutons (ombre + respiration)

// Largeur d'un lot de vignettes du carrousel (mesurée dans le DOM)
function getCarouselSetWidth() {
  const track = document.querySelector('.carousel-track');
  if (!track || track.children.length < 6) return 0;
  const setCount = track.children.length / 3;
  return track.children[setCount].offsetLeft - track.children[0].offsetLeft;
}

function fitDashboardSize() {
  const lastRow = document.querySelector('.dashboard-actions-row');
  if (!lastRow) return;

  const root = document.documentElement;
  const carousel = document.querySelector('.genre-carousel-container');
  const oldSetWidth = getCarouselSetWidth();
  const ratio = carousel && oldSetWidth ? carousel.scrollLeft / oldSetWidth : null;

  const current = parseFloat(getComputedStyle(root).getPropertyValue('--dash-tile')) || 110;
  const free = window.innerHeight - DASH_BOTTOM_GAP - lastRow.getBoundingClientRect().bottom;
  // La taille compte deux fois dans la hauteur (vignettes + boutons du bas)
  const next = Math.max(DASH_TILE_MIN, Math.min(DASH_TILE_MAX, Math.floor(current + free / 2)));

  if (next !== Math.round(current)) {
    root.style.setProperty('--dash-tile', next + 'px');
    const newSetWidth = getCarouselSetWidth();
    if (carousel && ratio !== null && newSetWidth) carousel.scrollLeft = ratio * newSetWidth;
  }
}

window.addEventListener('resize', fitDashboardSize);

/* ==========================================
   DÉFILEMENT AUTOMATIQUE DU CARROUSEL
   ------------------------------------------
   Le carrousel avance doucement tout seul. Il s'arrête dès qu'on le touche, qu'on clique ou qu'on
   fait défiler, puis reprend progressivement CAROUSEL_PAUSE_MS après le dernier geste.
   ========================================== */
const CAROUSEL_AUTO_SPEED = 28;      // px par seconde (0 pour désactiver)
const CAROUSEL_PAUSE_MS = 5000;      // pause après un clic ou un geste
const CAROUSEL_RESUME_RAMP_MS = 800; // reprise progressive de la vitesse

function startCarouselAutoScroll(container) {
  if (!container || CAROUSEL_AUTO_SPEED <= 0) return;

  let pausedUntil = 0;
  let holding = false;              // un doigt est posé sur le carrousel
  let pos = container.scrollLeft;   // position en nombre décimal (scrollLeft est arrondi par le navigateur)
  let last = performance.now();

  const pause = () => { pausedUntil = performance.now() + CAROUSEL_PAUSE_MS; };
  const hold = () => { holding = true; pause(); };
  const release = () => { holding = false; pause(); };

  container.addEventListener('touchstart', hold, { passive: true });
  container.addEventListener('touchmove', pause, { passive: true });
  container.addEventListener('touchend', release, { passive: true });
  container.addEventListener('touchcancel', release, { passive: true });
  container.addEventListener('pointerdown', pause, { passive: true });
  container.addEventListener('mousedown', pause, { passive: true });
  container.addEventListener('wheel', pause, { passive: true });
  container.addEventListener('click', pause, { passive: true });

  const tick = (now) => {
    if (!container.isConnected) return; // l'accueil n'est plus affiché : la boucle s'arrête

    const dt = Math.min(now - last, 100);
    last = now;

    const blocked = holding || document.hidden || now < pausedUntil || document.querySelector('.modal:not(.hidden)');
    if (blocked) {
      pos = container.scrollLeft; // on suit le geste de l'utilisateur
    } else {
      // Recalage si la position a changé ailleurs (bouclage du carrousel infini, redimensionnement...)
      if (Math.abs(container.scrollLeft - pos) > 2) pos = container.scrollLeft;
      const ramp = Math.min(1, (now - pausedUntil) / CAROUSEL_RESUME_RAMP_MS);
      pos += CAROUSEL_AUTO_SPEED * ramp * dt / 1000;
      container.scrollLeft = pos;
    }

    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

/* 1. DASHBOARD */
function renderDashboard(pushState = true) {
  const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
  if (fa) fa.style.display = 'none';
    
  if (typeof clearPlannerHeaderInfo === 'function') clearPlannerHeaderInfo();

  currentMD = null;
  currentAlbum = null;
  currentGenreFilters.clear(); // Réinitialise les filtres multiples à l'arrivée sur le dashboard
  currentTypeFilter = null;
  if (backBtn) backBtn.classList.add('hidden');
  if (headerTitle) headerTitle.textContent = "MINIDISCS";
  setHeaderGenreInfo([]);

  if (typeof updateSearchVisibility === 'function') {
    updateSearchVisibility(false);
  }

  // Vérification et normalisation des données de la collection
  const sourceData = (catalogData && Array.isArray(catalogData.minidiscs))
    ? catalogData.minidiscs
    : (Array.isArray(catalogData) ? catalogData : (Array.isArray(window.mdData) ? window.mdData : []));

  if (!sourceData || sourceData.length === 0) {
    app.innerHTML = `<p style="text-align:center; padding: 40px; color: var(--text-sub, #aaa);">Chargement de la collection...</p>`;
    return;
  }

  if (featuredContainer) featuredContainer.classList.add('hidden');

  if (pushState && window.location.hash !== '#dashboard') {
    history.pushState({ view: 'dashboard' }, '', '#dashboard');
  }

  const totalMD = sourceData.length;
  // Nombre de MiniDiscs à enregistrer (un MD compte pour 1, même si plusieurs de ses albums sont à enregistrer)
  const toRecordCount = sourceData.filter(md =>
    md.toRecord || (md.albums && md.albums.some(a => a.toRecord))
  ).length;

  let recordSummaryHTML;
  if (toRecordCount === 0) {
    recordSummaryHTML = 'Tous les minidiscs sont enregistrés';
  } else {
    recordSummaryHTML = `Il reste <strong>${toRecordCount}</strong> minidisc${toRecordCount > 1 ? 's' : ''} à enregistrer`;
  }


  // Définition des 8 genres avec leurs images d'illustration dans /images
  const genreConfigs = [
    { name: "Alternative & Grunge 90s", image: "images/Grunge 2.jpg" },
    { name: "Rock & Blues", image: "images/Blues2.jpg" },
    { name: "Rap, Soul & Reggae", image: "images/Rap2.jpg" },
    { name: "Metal & Hard Rock", image: "images/Metal2.jpg" },
    { name: "Pop & Folk & Variety", image: "images/Pop2.jpg" },
    { name: "Talks & Humour", image: "images/Talks2.jpg" },
    { name: "Électro, Trip-Hop & Expérimental", image: "images/Electro2.jpg" },
    { name: "Ambient & Orchestral", image: "images/Ambient2.jpg" }
  ];

  const generateCards = (configsList) => {
    return configsList.map(item => {
      const genre = item.name;
      const imageUrl = item.image;
      const upperGenre = genre.toUpperCase().trim();
      const safeGenreUpper = upperGenre.replace(/'/g, "\\'");

      // Image bien visible : seul le bas est assombri (dégradé qui disparaît au milieu de la vignette)
      return `
        <div class="genre-carousel-card" style="background-image: linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 50%), url('${imageUrl}');" onclick="if(typeof selectGenreFilter === 'function'){ selectGenreFilter('${safeGenreUpper}'); } else { window.location.hash = '#minidiscs?genre=${encodeURIComponent(safeGenreUpper)}'; }">
          <div class="carousel-genre-name">${genre}</div>
        </div>
      `;
    }).join('');
  };

  const initialCards = generateCards(genreConfigs);
  const carouselCardsHTML = `
    <div class="carousel-track">
      ${initialCards}
      ${initialCards}
      ${initialCards}
    </div>
  `;

  app.innerHTML = `
    <div class="dashboard-container" style="padding-top: 16px; padding-bottom: 90px;">
      
      <div class="dashboard-card" style="margin-bottom: 32px;">
        <div class="dashboard-stat-main" style="padding: 4px 0 8px 0;">
         <span class="stat-label" style="font-size: 0.75rem;">Collections de</span>
         <span class="stat-number" style="font-size: 1.2rem; line-height: 1;">${totalMD}</span>
         <span class="stat-label" style="font-size: 0.75rem;">MiniDiscs</span>
        </div>
        <div class="record-summary" onclick="window.location.hash = '#minidiscs?record=toRecord'">${recordSummaryHTML}</div>
      </div>

      <div class="featured-container-inline">
        <div class="featured-header">
          <div class="featured-title">SÉLECTION DU JOUR</div>
        </div>
        <div class="featured-grid" id="featured-grid-inline"></div>
      </div>

      <button class="btn-primary btn-view-all" onclick="window.location.hash = '#minidiscs'">
        VOIR TOUS LES MINIDISCS &rarr;
      </button>

      <div class="dashboard-card genres-banner">
        <div class="dashboard-section-title">MINIDISCS PAR GENRES</div>
        <div class="genre-carousel-wrap">
          <span class="carousel-arrow carousel-arrow-left" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="15 4 7 12 15 20"/></svg></span>
          <div class="genre-carousel-container">
            ${carouselCardsHTML}
          </div>
          <span class="carousel-arrow carousel-arrow-right" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="9 4 17 12 9 20"/></svg></span>
        </div>
      </div>

      <div class="dashboard-actions-row">
        <button class="action-btn-wide action-btn-create" onclick="window.location.hash = '#planner'">
          Créer une compilation
        </button>
        <button class="action-btn-wide action-btn-add" onclick="openAdminModal()">
          ＋ Ajouter un MD
        </button>
      </div>
    </div>
  `;

  if (typeof renderFeatured === 'function') renderFeatured();

  const oldGrid = document.querySelector('.featured-grid:not(#featured-grid-inline)') || document.getElementById('featured-grid');
  const newGrid = document.getElementById('featured-grid-inline');
  if (oldGrid && newGrid) {
    newGrid.innerHTML = oldGrid.innerHTML;
  }

  // Écouteur pour le scroll infini manuel avec calage précis des vignettes
  // Taille des vignettes adaptée à la hauteur de l'écran (avant de positionner le carrousel)
  fitDashboardSize();
  fitDashboardSize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitDashboardSize);

  const carouselContainer = document.querySelector('.genre-carousel-container');

  if (carouselContainer && getCarouselSetWidth() > 0) {
    // Carrousel infini : 3 lots identiques, on reste toujours sur le lot du milieu
    carouselContainer.scrollLeft = getCarouselSetWidth();

    carouselContainer.addEventListener('scroll', () => {
      const setWidth = getCarouselSetWidth();
      if (carouselContainer.scrollLeft <= 10) {
        carouselContainer.scrollLeft += setWidth;
      } else if (carouselContainer.scrollLeft >= setWidth * 2 - 10) {
        carouselContainer.scrollLeft -= setWidth;
      }
    });

    startCarouselAutoScroll(carouselContainer);
  }

  window.scrollTo(0, 0);
}

/* 2. LISTE DES MINIDISCS */
function renderMDList(filters = {}, pushState = true) {
  if (catalogData === null) return;

  const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
  if (fa) fa.style.display = 'flex';

  // Mise à jour explicite des variables globales avec fallback
  currentGenreFilter = filters.genre !== undefined ? filters.genre : currentGenreFilter;
  currentTypeFilter = filters.type !== undefined ? filters.type : currentTypeFilter;
  currentRecordFilter = filters.record !== undefined ? filters.record : currentRecordFilter;

  const genre = currentGenreFilter;
  const type = currentTypeFilter;
  const record = currentRecordFilter;

  if (pushState) {
    window.location.hash = '#md-list';
  }
  
  currentMD = null;
  currentAlbum = null;

  if (backBtn) backBtn.classList.remove('hidden');

  updateSearchVisibility(true);
  if (headerTitle) headerTitle.textContent = "MINIDISCS";
  setHeaderGenreInfo(genre && genre !== 'ALL' ? [genre] : []);
  if (featuredContainer) featuredContainer.classList.add('hidden');

  let filteredCatalog = catalogData.map((md, originalIndex) => ({ md, originalIndex }));
  
if (genre && genre !== 'ALL') {
    const targetGenre = genre.trim().toLowerCase();
    filteredCatalog = filteredCatalog.filter(({ md }) => 
      getMDAllGenres(md).some(g => g.trim().toLowerCase() === targetGenre)
    );
  }
  if (type) {
    const targetType = type.trim().toLowerCase();
    filteredCatalog = filteredCatalog.filter(({ md }) => 
      getMDAllTypes(md).some(t => t.trim().toLowerCase() === targetType)
    );
  }

  if (record === 'toRecord') {
    filteredCatalog = filteredCatalog.filter(({ md }) => 
      md.toRecord || (md.albums && md.albums.some(a => a.toRecord))
    );
  } else if (record === 'recorded') {
    filteredCatalog = filteredCatalog.filter(({ md }) => {
      const isToRecord = md.toRecord || (md.albums && md.albums.some(a => a.toRecord));
      return !isToRecord;
    });
  }

  if (currentSearchQuery) {
    filteredCatalog = filteredCatalog.filter(({ md }) => mdMatchesSearch(md, currentSearchQuery));
  }

  const seedSuffix = genre ? `-genre-${genre}` : (type ? `-type-${type}` : '-all');
  const shuffledCatalog = dailyShuffle(filteredCatalog, seedSuffix);

  let html = '<div class="list-container" style="padding-bottom: 90px;">';
  
  if (shuffledCatalog.length === 0) {
    html += `<p style="text-align:center; padding: 40px; color: var(--text-sub);">Aucun MiniDisc trouvé.</p>`;
  } else {
    shuffledCatalog.forEach(({ md, originalIndex }) => {
      const allGenres = getMDAllGenres(md);
      const borderColor = getBorderColor(allGenres);
      
      let albumsContent = '';
      if (md.albums && md.albums.length > 0) {
        albumsContent = md.albums.map(album => `
          <div class="md-album-item">
            <div class="md-album-title">${album.title || ''}</div>
            <div class="md-album-artist">${album.artist || ''}</div>
          </div>
        `).join('');
      } else {
        albumsContent = `
          <div class="md-album-item">
            <div class="md-album-title">${md.title || 'MiniDisc sans titre'}</div>
            <div class="md-album-artist">${md.artist || ''}</div>
          </div>
        `;
      }

      const isToRecord = md.toRecord || (md.albums && md.albums.some(a => a.toRecord));
      const recordBadgeHTML = isToRecord 
        ? `<span class="badge-to-record badge-record-corner">💽 À enregistrer</span>` 
        : '';

      const listCover = md.md_cover || (md.albums && md.albums[0] ? md.albums[0].md_cover : '') || '';
      const coverHTML = createLoadingCoverHTML(listCover, 'md-thumb', '💽');

      html += `
        <div class="list-item" style="border-color: ${borderColor}; --glow: ${borderColor}; border-left-width: 6px; position: relative;" onclick="openMD(${originalIndex})">
          ${coverHTML}
          <div class="item-details">
            <div class="item-tag" style="font-size: inherit;">${genreListHTML(allGenres, 'inherit')}</div>
            <div class="md-albums-list">${albumsContent}</div>
          </div>
          ${recordBadgeHTML}
        </div>
      `;
    });
  }
  html += '</div>';
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/* 3. VUE D'UN MINIDISC */
function openMD(index, pushState = true) {
  const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
  if (fa) fa.style.display = 'none';
    
  if (!catalogData || !catalogData[index]) return;

  if (pushState) {
    history.pushState({ view: 'album', mdIndex: index }, '', `#md-${index}`);
  }

  currentMD = catalogData[index];
  currentAlbum = null;
  if (backBtn) backBtn.classList.remove('hidden');
  setHeaderGenreInfo([]);
  updateSearchVisibility(false);
  if (featuredContainer) featuredContainer.classList.add('hidden');

  const md = catalogData[index];
  const allMdGenres = getMDAllGenres(md);
  const borderColor = getBorderColor(allMdGenres);

/* ==========================================
   FAB HTML & GESTION VUE DÉTAIL MINIDISC
   ========================================== */

// FAB HTML restructuré avec titres de section et styles harmonisés
const fabHTML = `
  <div id="md-detail-floating-actions" class="fab-container">
    <div id="md-detail-fab-menu" class="fab-menu hidden">
      <!-- Section Options -->
      <div class="fab-section-title">Options</div>
      <button type="button" class="fab-item accent" onclick="openAdminModal(${index});">
        ✏️ Modifier
      </button>
      <button type="button" class="fab-item danger" onclick="deleteMD(${index});">
        🗑️ Supprimer
      </button>
    </div>
    
    <button type="button" id="md-detail-fab-main-btn" class="fab-main-btn" onclick="toggleMdDetailFabMenu();" title="Actions MiniDisc">
      <span class="fab-icon" aria-hidden="true"></span>
    </button>
  </div>
`;

// CAS 1 : MINIDISC SIMPLE / COMPILATION (SANS ALBUMS)
if (!md.albums || md.albums.length === 0) {
  if (headerTitle) headerTitle.textContent = "TITRES";

  let tracksHTML = '';
  if (md.tracks && md.tracks.length > 0) {
    md.tracks.forEach((track, i) => {
      const num = String(i + 1).padStart(2, '0');
      tracksHTML += `<li class="track-item"><strong class="track-num">${num}.</strong> ${track}</li>`;
    });
  } else {
    tracksHTML = `<li class="track-item">Aucune piste disponible.</li>`;
  }

  const badgeCompilHTML = md.toRecord 
    ? `<div class="badge-to-record-header">💽 À ENREGISTRER</div>` 
    : '';

  const coverHTML = createLoadingCoverHTML(md.md_cover, 'album-cover-large', '💽');
  const isKnownValue = (v) => v && String(v).trim() && String(v).trim().toLowerCase() !== 'unknow' && String(v).trim().toLowerCase() !== 'unknown';
  const metaLine = [md.release_year, md.duration].filter(isKnownValue).join(' · ');

  app.innerHTML = `
    <div class="track-container" style="padding-bottom: 90px;">
      <div class="album-header">
        ${coverHTML}
        <div class="album-header-info">
          ${badgeCompilHTML}
          <h2 style="font-size: 1.2rem; font-weight: 800;">${md.title || 'Compilation'}</h2>
          <p style="color: var(--text-sub); font-size: 0.95rem;">${md.artist || 'Artistes divers'}</p>
          <p style="color: ${borderColor}; font-size: 0.8rem; font-weight: 800;">${allMdGenres.join(' / ')}</p>
          ${metaLine ? `<p class="meta-line" style="font-size: 0.8rem;">${metaLine}</p>` : ''}
        </div>
      </div>
      <ul class="track-list">${tracksHTML}</ul>
      ${fabHTML}
    </div>
  `;
  window.scrollTo(0, 0);
  return;
}

// CAS 2 : SÉRIE D'ALBUMS
if (headerTitle) headerTitle.textContent = "ALBUMS";

let html = `<div class="list-container" style="padding-bottom: 90px;">`;
md.albums.forEach((album, aIndex) => {
  const albumGenres = getAlbumGenres(album, md);
  const albumColor = getBorderColor(albumGenres);
  
  const badgeAlbumHTML = album.toRecord 
    ? `<span class="badge-to-record badge-record-corner">💽 À enregistrer</span>` 
    : '';

  const coverHTML = createLoadingCoverHTML(album.md_cover, 'album-thumb', '🎵');

  html += `
    <div class="list-item" style="border-color: ${albumColor}; --glow: ${albumColor}; border-left-width: 6px; position: relative;" onclick="openAlbum(${index}, ${aIndex})">
      <div class="album-cover-container" style="margin-right: 15px; display: inline-block;">
        ${coverHTML}
      </div>
      <div class="item-details">
        <div class="item-tag" style="color: ${albumColor};">${albumGenres.join(' / ')}</div>
        <div class="item-title" style="font-weight: 700;">${album.title || 'Album sans titre'}</div>
        <div class="item-sub">${album.artist || 'Artiste inconnu'}</div>
        ${album.release_year ? `<div class="item-sub" style="font-size:0.78rem;">${album.release_year}</div>` : ''}
      </div>
      ${badgeAlbumHTML}
    </div>
  `;
});
html += `${fabHTML}</div>`;
app.innerHTML = html;
window.scrollTo(0, 0);
}

/* GESTION DU MENU FAB DÉTAIL MINIDISC */
function toggleMdDetailFabMenu() {
  const menu = document.getElementById('md-detail-fab-menu');
  const btn = document.getElementById('md-detail-fab-main-btn');
  if (!menu) return;

  const isOpening = menu.classList.contains('hidden');
  menu.classList.toggle('hidden');

  if (btn) {
    btn.classList.toggle('open', isOpening);
  }
}

// Fermeture du menu si clic en dehors (sécurisé)
document.addEventListener('click', (e) => {
  const container = document.getElementById('md-detail-floating-actions');
  const menu = document.getElementById('md-detail-fab-menu');
  if (container && menu && !container.contains(e.target)) {
    menu.classList.add('hidden');
    document.getElementById('md-detail-fab-main-btn')?.classList.remove('open');
  }
});

/* 4. VUE TRACKLIST ALBUM SPÉCIFIQUE */
function openAlbum(mdIndex, albumIndex, pushState = true) {
  const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
  if (fa) fa.style.display = 'none';
    
  if (!catalogData || !catalogData[mdIndex] || !catalogData[mdIndex].albums[albumIndex]) return;

  currentMD = mdIndex;
  currentAlbum = albumIndex;
  if (backBtn) backBtn.classList.remove('hidden');

  setHeaderGenreInfo([]);
  updateSearchVisibility(false);
  if (featuredContainer) featuredContainer.classList.add('hidden');

  const md = catalogData[mdIndex];
  const album = md.albums[albumIndex];
  const albumGenres = getAlbumGenres(album, md);
  const albumColor = getBorderColor(albumGenres);

  if (headerTitle) headerTitle.textContent = "TITRES";
  if (pushState) history.pushState({ view: 'tracklist', mdIndex, albumIndex }, '', `#md-${mdIndex}-album-${albumIndex}`);

  // La numérotation continue d'un album à l'autre, comme sur le MiniDisc physique :
  // si le 1er album a 13 pistes, la 1re piste du 2e album porte le numéro 14.
  const trackOffset = md.albums
    .slice(0, Number(albumIndex))
    .reduce((sum, a) => sum + ((a.tracks && a.tracks.length) || 0), 0);

  let tracksHTML = '';
  if (album.tracks && album.tracks.length > 0) {
    album.tracks.forEach((track, i) => {
      const num = String(trackOffset + i + 1).padStart(2, '0');
      tracksHTML += `<li class="track-item"><strong class="track-num">${num}.</strong> ${track}</li>`;
    });
  } else {
    tracksHTML = `<li class="track-item">Aucune piste disponible.</li>`;
  }

  const badgeAlbumHTML = album.toRecord 
    ? `<div class="badge-to-record-header">💽 À ENREGISTRER</div>` 
    : '';

  const coverHTML = createLoadingCoverHTML(album.md_cover, 'album-cover-large', '🎵');
  const isKnownAlbumValue = (v) => v && String(v).trim() && String(v).trim().toLowerCase() !== 'unknow' && String(v).trim().toLowerCase() !== 'unknown';
  const albumMetaLine = [album.release_year, album.duration].filter(isKnownAlbumValue).join(' · ');

  app.innerHTML = `
    <div class="track-container">
      <div class="album-header">
        ${coverHTML}
        <div class="album-header-info">
          ${badgeAlbumHTML}
          <h2 style="font-size: 1.2rem; font-weight: 800;">${album.title || 'Album sans titre'}</h2>
          <p style="color: var(--text-sub); font-size: 0.95rem;">${album.artist || 'Artiste inconnu'}</p>
          <p style="color: ${albumColor}; font-size: 0.8rem; font-weight: 800;">${albumGenres.join(' / ')}</p>
          ${albumMetaLine ? `<p class="meta-line" style="font-size: 0.8rem;">${albumMetaLine}</p>` : ''}
        </div>
      </div>
      <ul class="track-list">${tracksHTML}</ul>
    </div>
  `;
  window.scrollTo(0, 0);
}
/* ==========================================
   SUPPRESSION ET MODIFICATION
   ========================================== */
function deleteMD(index) {
  if (!catalogData || !catalogData[index]) return;
  
  const md = catalogData[index];
  const title = md.title || (md.albums ? md.albums.map(a => a.title).join(' / ') : 'ce MiniDisc');
  
  if (confirm(`Voulez-vous vraiment supprimer définitivement "${title}" ?`)) {
    catalogData.splice(index, 1);
    saveLocalBackup();
    showToast("🗑️ MiniDisc supprimé !");
    
    // Reste sur la vue catalogue au lieu d'aller à l'accueil
    if (typeof renderMDList === 'function') {
      renderMDList({ 
        genre: currentGenreFilter, 
        type: currentTypeFilter, 
        record: currentRecordFilter 
      }, false);
    } else if (typeof renderDashboard === 'function') {
      renderDashboard(false);
    }
  }
}

/* ==========================================
   GESTION DE LA MODALE ADMIN
   ========================================== */

/* ==========================================
   UTILITAIRE : SÉLECTION MULTIPLE PAR SUGGESTIONS
   ========================================== */
function setupMultiSelectContainer(inputId, datalistId) {
  const input = document.getElementById(inputId);
  const datalist = document.getElementById(datalistId);
  if (!input || !datalist) return;

  // Retirer l'attribut list pour empêcher le menu déroulant natif du navigateur de s'ouvrir au clic
  input.removeAttribute('list');

  // Éviter de réattacher le conteneur plusieurs fois
  let container = input.parentElement.querySelector('.tag-suggestions');
  if (!container) {
    container = document.createElement('div');
    container.className = 'tag-suggestions';
    container.style.cssText = "display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;";
    input.parentElement.appendChild(container);
  }

  // Fonction pour afficher les badges des options disponibles
  function renderBadges() {
    container.innerHTML = '';
    const currentValues = input.value.split(',').map(v => v.trim().toLowerCase());
    const options = Array.from(datalist.options).map(opt => opt.value);

    options.forEach(optValue => {
      // Si l'option n'est pas encore ajoutée dans le champ
      if (!currentValues.includes(optValue.toLowerCase())) {
        const badge = document.createElement('span');
        badge.textContent = `+ ${optValue}`;
        badge.style.cssText = "background: #e9ecef; color: #212529; border: 1px solid #ced4da; padding: 3px 8px; border-radius: 12px; font-size: 0.75rem; cursor: pointer; user-select: none;";
        
        badge.onclick = () => {
          const parts = input.value.split(',').map(p => p.trim()).filter(p => p !== '');
          parts.push(optValue);
          input.value = parts.join(', ') + ', ';
          renderBadges(); // Met à jour les puces restantes
          input.focus();
        };
        container.appendChild(badge);
      }
    });
  }

  // Mettre à jour si l'utilisateur retape du texte à la main
  input.oninput = renderBadges;
  
  renderBadges();
}

/* ==========================================
   LISTE FIXE DES 8 GENRES PRINCIPAUX
   ========================================== */
const MAIN_GENRES = [
  'Alternative & Grunge 90s',
  'Rock & Blues',
  'Rap, Soul & Reggae',
  'Metal & Hard Rock',
  'Pop & Folk & Variety',
  'Talks & Humour',
  'Électro, Trip-Hop & Expérimental',
  'Ambient & Orchestral',
];

function mainGenreOptionsHTML(selected = '') {
  let html = `<option value="">-- Choisir un genre --</option>`;
  MAIN_GENRES.forEach(g => {
    html += `<option value="${g}" ${g === selected ? 'selected' : ''}>${g}</option>`;
  });
  return html;
}

function openAdminModal(indexToEdit = null) {
  editingMDIndex = indexToEdit;
  const modalTitle = document.querySelector('#admin-modal h3');
  const albumsContainer = document.getElementById('albums-container');
  if (albumsContainer) albumsContainer.innerHTML = '';
  adminAlbumCount = 0;

  // Réinitialiser le champ fichier principal avec une chaîne vide
  const mdCoverInput = document.getElementById('md-cover');
  if (mdCoverInput) mdCoverInput.value = '';

  if (editingMDIndex !== null) {
    // ==========================================
    // MODE ÉDITION
    // ==========================================
    const md = catalogData[editingMDIndex];
    if (modalTitle) modalTitle.textContent = "✏️ Modifier le MiniDisc";

    const isCompil = !md.albums || md.albums.length === 0;

    const radioCompil = document.querySelector('input[name="md-type"][value="compil"]');
    const radioAlbums = document.querySelector('input[name="md-type"][value="albums"]') || document.querySelector('input[name="md-type"][value="album"]');
    
    if (isCompil && radioCompil) radioCompil.checked = true;
    if (!isCompil && radioAlbums) radioAlbums.checked = true;

    toggleAdminType(true);

    if (isCompil) {
      document.getElementById('compil-title').value = md.title || '';
      document.getElementById('compil-artist').value = md.artist || '';
      if (document.getElementById('compil-genre')) document.getElementById('compil-genre').value = md.main_genre || '';
      if (document.getElementById('compil-tags')) document.getElementById('compil-tags').value = (md.tags || []).join(', ');
      if (document.getElementById('compil-year')) document.getElementById('compil-year').value = md.release_year || '';
      if (document.getElementById('compil-duration')) document.getElementById('compil-duration').value = md.duration || '';
      document.getElementById('compil-tracks').value = md.tracks ? md.tracks.join('\n') : '';
      if (document.getElementById('compil-to-record')) {
        document.getElementById('compil-to-record').checked = !!md.toRecord;
      }
    } else {
      md.albums.forEach(album => {
        addAdminAlbumBlock();
        const block = albumsContainer.lastElementChild;
        block.querySelector('.album-title').value = album.title || '';
        block.querySelector('.album-artist').value = album.artist || '';
        block.querySelector('.album-genre').value = album.main_genre || '';
        block.querySelector('.album-tags').value = (album.tags || []).join(', ');
        block.querySelector('.album-year').value = album.release_year || '';
        if (block.querySelector('.album-duration')) block.querySelector('.album-duration').value = album.duration || '';
        block.querySelector('.album-tracks').value = album.tracks ? album.tracks.join('\n') : '';
        if (block.querySelector('.album-to-record')) {
          block.querySelector('.album-to-record').checked = !!album.toRecord;
        }
      });
    }

  } else {
    // ==========================================
    // MODE AJOUT (RÉINITIALISATION COMPLÈTE)
    // ==========================================
    if (modalTitle) modalTitle.textContent = "＋ Ajouter un MiniDisc";
    
    // Remise à zéro du formulaire HTML (admin-form)
    const form = document.getElementById('admin-form');
    if (form) form.reset();

    // Réinitialisation des champs spécifiques
    if (document.getElementById('compil-title')) document.getElementById('compil-title').value = '';
    if (document.getElementById('compil-artist')) document.getElementById('compil-artist').value = '';
    if (document.getElementById('compil-genre')) document.getElementById('compil-genre').value = '';
    if (document.getElementById('compil-tags')) document.getElementById('compil-tags').value = '';
    if (document.getElementById('compil-year')) document.getElementById('compil-year').value = '';
    if (document.getElementById('compil-duration')) document.getElementById('compil-duration').value = '';
    if (document.getElementById('compil-tracks')) document.getElementById('compil-tracks').value = '';
    
    if (document.getElementById('compil-to-record')) {
      document.getElementById('compil-to-record').checked = false;
    }

    // Cocher l'option compilation par défaut et basculer l'affichage
    const radioCompil = document.querySelector('input[name="md-type"][value="compil"]');
    if (radioCompil) radioCompil.checked = true;
    
    toggleAdminType(false);
  }

  // Affichage de la modale
  const modal = document.getElementById('admin-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeAdminModal() {
  const modal = document.getElementById('admin-modal');
  if (modal) modal.classList.add('hidden');
  editingMDIndex = null;
}

function toggleAdminType(isInit = false) {
  const checkedRadio = document.querySelector('input[name="md-type"]:checked');
  const isCompil = checkedRadio ? checkedRadio.value === 'compil' : true;
  
  const secCompil = document.getElementById('section-compil');
  const secAlbums = document.getElementById('section-albums');

  if (secCompil) secCompil.classList.toggle('hidden', !isCompil);
  if (secAlbums) secAlbums.classList.toggle('hidden', isCompil);

  const albumsContainer = document.getElementById('albums-container');
  if (!isCompil && !isInit && albumsContainer && albumsContainer.children.length === 0) {
    addAdminAlbumBlock();
  }
}

function addAdminAlbumBlock() {
  adminAlbumCount++;
  const container = document.getElementById('albums-container');
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'album-block';
  div.innerHTML = `
    <div class="album-block-header">
      <h4>Album</h4>
      <button type="button" class="btn-remove-album" onclick="removeAdminAlbumBlock(this)">🗑️ Supprimer l'album</button>
    </div>
    <div class="form-group"><input type="text" class="album-title" placeholder="Titre de l'album"></div>
    <div class="form-group"><input type="text" class="album-artist" placeholder="Artiste"></div>
    <div class="form-group">
      <label style="font-size: 0.85rem; font-weight: bold; display: block; margin-bottom: 4px;">Genre</label>
      <select class="album-genre">${mainGenreOptionsHTML()}</select>
    </div>
    <div class="form-group"><input type="text" class="album-tags" placeholder="Tags (optionnel, ex: Acoustic, Punk Rock)"></div>
    <div class="form-group"><input type="text" class="album-year" placeholder="Année de sortie (ex: 1998)"></div>
    <div class="form-group"><input type="text" class="album-duration" placeholder="Durée (ex: 45:30)"></div>
    <div class="form-group">
      <label style="font-size: 0.85rem; font-weight: bold; display: block; margin-bottom: 4px;">Pochette Album</label>
      <input type="file" class="album-cover" accept="image/*">
    </div>
    <div class="form-group"><textarea class="album-tracks" placeholder="Pistes de cet album (une par ligne, sans numéro)"></textarea></div>
    <div class="form-group" style="margin-top: 8px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold; font-size: 0.85rem;">
        <input type="checkbox" class="album-to-record" style="width: 16px; height: 16px;">
        🎙️ À enregistrer
      </label>
    </div>
  `;
  container.appendChild(div);
}

function removeAdminAlbumBlock(button) {
  const block = button.closest('.album-block');
  if (block) {
    block.remove();
  }
}

// Fusionne un MiniDisc "série" qui ne contient qu'un seul album : plus besoin de la
// couche "albums", ses champs viennent directement sur le MiniDisc (comme une compilation).
function flattenSingleAlbum(targetMD) {
  const alb = targetMD.albums[0];
  targetMD.md_cover = targetMD.md_cover && targetMD.md_cover !== 'images/default.jpg' ? targetMD.md_cover : (alb.md_cover || targetMD.md_cover);
  targetMD.title = alb.title;
  targetMD.artist = alb.artist;
  targetMD.main_genre = alb.main_genre;
  targetMD.tags = alb.tags;
  targetMD.release_year = alb.release_year;
  targetMD.duration = alb.duration;
  targetMD.tracks = alb.tracks;
  targetMD.toRecord = alb.toRecord;
  delete targetMD.albums;
}

async function submitNewMD(e) {
  if (e) e.preventDefault();
  if (catalogData === null) return;

  const checkedRadio = document.querySelector('input[name="md-type"]:checked');
  const typeFormat = checkedRadio ? checkedRadio.value : 'compil';

  const mdCoverInput = document.getElementById('md-cover');
  const existingMD = editingMDIndex !== null ? catalogData[editingMDIndex] : null;

  // Transforme "tag1, tag2" en tableau de tags (liste libre, secondaire au genre principal)
  function parseTagsInput(raw) {
    return (raw || '').split(',').map(t => t.trim()).filter(t => t !== '');
  }

  const targetMD = {
    id: (existingMD && existingMD.id) ? existingMD.id : ('md-' + Date.now()),
  };

  showToast("⏳ Traitement et envoi de l'image...");

  // Upload de la pochette du MiniDisc lui-même (s'applique aux compilations ET aux séries)
  let mdCoverPath = 'images/default.jpg';
  if (mdCoverInput && mdCoverInput.files && mdCoverInput.files.length > 0) {
    const uploadedPath = await handleImageUpload(mdCoverInput);
    if (uploadedPath) mdCoverPath = uploadedPath;
  } else if (existingMD && existingMD.md_cover) {
    mdCoverPath = existingMD.md_cover;
  }
  targetMD.md_cover = mdCoverPath;

  if (typeFormat === 'compil') {
    const compilGenreSelect = document.getElementById('compil-genre');
    const mainGenre = compilGenreSelect ? compilGenreSelect.value : '';
    if (!mainGenre) {
      showToast("⚠️ Veuillez choisir un genre");
      return;
    }

    targetMD.title = document.getElementById('compil-title').value.trim();
    targetMD.artist = document.getElementById('compil-artist').value.trim();
    if (!targetMD.title) {
      showToast("⚠️ Veuillez renseigner un titre");
      return;
    }
    targetMD.main_genre = mainGenre;
    targetMD.tags = parseTagsInput(document.getElementById('compil-tags') ? document.getElementById('compil-tags').value : '');
    targetMD.release_year = document.getElementById('compil-year') ? document.getElementById('compil-year').value.trim() : '';
    targetMD.duration = document.getElementById('compil-duration') ? document.getElementById('compil-duration').value.trim() : '';

    const rawTracks = document.getElementById('compil-tracks').value.split('\n');
    targetMD.tracks = rawTracks.map(t => t.trim()).filter(t => t !== '');

    const compilCheckbox = document.getElementById('compil-to-record');
    targetMD.toRecord = compilCheckbox ? compilCheckbox.checked : false;
  } else {
    // Série d'albums : le genre reste calculé à partir des albums (pas stocké au niveau du MD).
    targetMD.albums = [];
    const albumBlocks = document.querySelectorAll('.album-block');
    
    if (albumBlocks.length === 0) {
      showToast("⚠️ Veuillez ajouter au moins un album.");
      return;
    }

    // Boucle pour l'upload d'image et la création de chaque album
    for (let i = 0; i < albumBlocks.length; i++) {
      const block = albumBlocks[i];
      const rawTracks = block.querySelector('.album-tracks').value.split('\n');
      const formattedTracks = rawTracks.map(t => t.trim()).filter(t => t !== '');

      const albumTitle = block.querySelector('.album-title').value.trim();
      const albumArtist = block.querySelector('.album-artist').value.trim();
      const albumMainGenre = block.querySelector('.album-genre').value;
      const albumTags = parseTagsInput(block.querySelector('.album-tags') ? block.querySelector('.album-tags').value : '');
      if (!albumTitle || !albumArtist) {
        showToast("⚠️ Veuillez renseigner un titre et un artiste pour chaque album.");
        return;
      }
      if (!albumMainGenre) {
        showToast("⚠️ Veuillez choisir un genre pour chaque album.");
        return;
      }

      const existingAlbum = (existingMD && existingMD.albums && existingMD.albums[i]) ? existingMD.albums[i] : null;

      // Gestion de l'upload d'image pour l'album
      const albumCoverInput = block.querySelector('.album-cover');
      let albumCoverPath = 'images/default.jpg';
      
      if (albumCoverInput && albumCoverInput.files && albumCoverInput.files.length > 0) {
        const uploadedPath = await handleImageUpload(albumCoverInput);
        if (uploadedPath) {
          albumCoverPath = uploadedPath;
        }
      } else if (existingAlbum) {
        albumCoverPath = existingAlbum.md_cover || 'images/default.jpg';
      }

      const albumObj = {
        id: (existingAlbum && existingAlbum.id) ? existingAlbum.id : (targetMD.id + '-alb-' + (i + 1)),
        md_cover: albumCoverPath,
        title: albumTitle,
        artist: albumArtist,
        main_genre: albumMainGenre,
        tags: albumTags,
        release_year: block.querySelector('.album-year').value.trim(),
        duration: block.querySelector('.album-duration') ? block.querySelector('.album-duration').value.trim() : '',
        tracks: formattedTracks,
        toRecord: block.querySelector('.album-to-record') ? block.querySelector('.album-to-record').checked : false
      };

      targetMD.albums.push(albumObj);
    }

    // Le titre global du MiniDisc est calculé à partir des titres des albums
    targetMD.title = targetMD.albums.map(a => a.title).filter(Boolean).join(' / ');

    // S'il n'y a finalement qu'un seul album, pas besoin de la couche "albums" :
    // on aplatit directement ses infos sur le MiniDisc (comme une compilation).
    if (targetMD.albums.length === 1) {
      flattenSingleAlbum(targetMD);
    }
  }

  // Enregistrement dans catalogData
  if (editingMDIndex !== null) {
    catalogData[editingMDIndex] = targetMD;
    editingMDIndex = null;
    showToast("✅ MiniDisc modifié !");
  } else {
    catalogData.push(targetMD);
    showToast("✅ MiniDisc ajouté !");
  }

  if (typeof saveLocalBackup === 'function') saveLocalBackup();
  if (typeof closeAdminModal === 'function') closeAdminModal();

  // Rechargement de la vue Catalogue active
  if (typeof renderMDList === 'function') {
    renderMDList({ 
      genre: typeof currentGenreFilter !== 'undefined' ? currentGenreFilter : '', 
      type: typeof currentTypeFilter !== 'undefined' ? currentTypeFilter : '', 
      record: typeof currentRecordFilter !== 'undefined' ? currentRecordFilter : '' 
    }, false);
  } else if (typeof renderDashboard === 'function') {
    renderDashboard(false);
  }
}

/* ==========================================
   PLANIFICATEUR DE COMPILATION & IDÉES
   ========================================== */

function getIdeaList() {
  if (!catalogData) return [];
  if (!window.ideaAlbums) window.ideaAlbums = [];
  return window.ideaAlbums;
}

function parseTimeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.toString().trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;

  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0] * 60;
  return 0;
}

// Durée d'un album dans le planificateur : "1:03:29" à partir d'une heure, "36:25" en dessous
// (ex: "63:29" -> "1:03:29", "36:25" -> "36:25")
function formatPlannerDuration(timeStr) {
  const total = parseTimeToSeconds(timeStr);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function formatSecondsToDisplay(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = num => String(num).padStart(2, '0');

  return h > 0 
    ? `${h}h ${pad(m)}m ${pad(s)}s` 
    : `${m}m ${pad(s)}s`;
}

function updatePlannerHeader() {
  const durationTextEl = document.getElementById('planner-duration-text');
  const selectedListEl = document.getElementById('planner-selected-list');
  
  const ideas = getIdeaList();
  const maxSeconds = 148 * 60; // 2h 28m
  let totalSeconds = 0;

  if (typeof selectedIdeaIndices === 'undefined') window.selectedIdeaIndices = new Set();

  const selectedHTML = Array.from(selectedIdeaIndices)
    .filter(idx => ideas[idx])
    .map(idx => {
      const item = ideas[idx];
      totalSeconds += parseTimeToSeconds(item.duration);
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; gap: 8px;">
          <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-main); font-weight: 600;">
            🎵 <span style="color: var(--text-sub);">${item.artist || 'Artiste'}</span> - ${item.title || 'Titre'}
          </div>
          <div style="font-weight: 700; color: var(--text-cyan); white-space: nowrap;">⏱️ ${formatPlannerDuration(item.duration)}</div>
        </div>`;
    }).join('');

  if (selectedListEl) {
    const hasSelection = selectedIdeaIndices.size > 0;
    selectedListEl.innerHTML = hasSelection ? selectedHTML : '';
    selectedListEl.style.display = hasSelection ? 'block' : 'none';
  }

  if (durationTextEl) {
    durationTextEl.style.color = totalSeconds > maxSeconds ? '#e63946' : '#06d6a0';
    durationTextEl.textContent = `${formatSecondsToDisplay(totalSeconds)} / 2h 28m`;
  }

  const convertBtn = document.getElementById('planner-btn-convert');
  if (convertBtn) {
    convertBtn.disabled = selectedIdeaIndices.size === 0;
    convertBtn.textContent = `💾 Convertir (${selectedIdeaIndices.size})`;
  }

  const remainingSeconds = maxSeconds - totalSeconds;
  document.querySelectorAll('.idea-card').forEach(card => {
    const index = parseInt(card.getAttribute('data-index'), 10);
    const item = ideas[index];
    if (!item) return;

    const isSelected = selectedIdeaIndices.has(index);
    const itemSec = parseTimeToSeconds(item.duration);
    const isDisabled = !isSelected && itemSec > remainingSeconds;

    card.classList.toggle('disabled-card', isDisabled);
    card.style.opacity = isDisabled ? '0.4' : '1';
  });
}

function clearPlannerHeaderInfo() {
  document.getElementById('header-planner-badge')?.remove();
  document.getElementById('planner-genre-menu')?.remove();

  if (typeof isPlannerGenreDropdownOpen !== 'undefined') {
    isPlannerGenreDropdownOpen = false;
  }
}

function injectPlannerHeaderBadge() {
  const header = document.querySelector('header') || document.querySelector('.header');
  if (!header || document.getElementById('header-planner-badge')) return;

  const badge = document.createElement('div');
  badge.id = 'header-planner-badge';
  badge.style.cssText = `
    position: fixed; top: 150px; left: 50%; transform: translateX(-50%); z-index: 999;
    background: var(--card-sheen), var(--card-bg); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur);
    border: 2px solid #000000; border-radius: 16px; padding: 10px 16px;
    box-shadow: 4px 4px 0px #000000, var(--card-rim); display: flex; flex-direction: column; gap: 8px;
    width: calc(100% - 32px); max-width: 568px; box-sizing: border-box;
  `;
  
  badge.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
      <span style="font-size: 0.85rem; font-weight: bold; color: var(--text-main);">Durée sélectionnée :</span>
      <strong id="planner-duration-text" style="font-family: 'Righteous', cursive; font-size: 1.05rem; color: #06d6a0;">0m 00s / 2h 28m</strong>
    </div>
    <div id="planner-selected-list" style="display: none; border-top: 1.5px dashed rgba(255, 255, 255, 0.25); padding-top: 6px; max-height: 100px; overflow-y: auto; font-size: 0.78rem;"></div>
  `;

  header.after(badge);
}

function getItemGenresList(item) {
  if (typeof getMDAllGenres === 'function') return getMDAllGenres(item);
  if (!item || !item.genre) return [];
  if (Array.isArray(item.genre)) {
    return item.genre.map(g => String(g).trim().toUpperCase()).filter(Boolean);
  }
  return String(item.genre).split(',').map(g => g.trim().toUpperCase()).filter(Boolean);
}

/* RENDU DU PLANIFICATEUR */
function renderCompilPlanner(pushState = true) {
  try {
    window.isPlannerGenreDropdownOpen = false;
    if (typeof selectedIdeaIndices === 'undefined') window.selectedIdeaIndices = new Set();

    const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
    if (fa) {
      fa.style.display = 'flex';
      fa.classList.remove('hidden');
    }
      
    if (typeof currentMD !== 'undefined') window.currentMD = null;
    if (typeof currentAlbum !== 'undefined') window.currentAlbum = null;

    document.getElementById('back-btn')?.classList.remove('hidden');
    
    const headerTitle = document.getElementById('header-title') || document.querySelector('.header-title');
    if (headerTitle) headerTitle.textContent = "PLANIFICATEUR";
    setHeaderGenreInfo(Array.from(currentPlannerGenreFilters));

    document.getElementById('featured-container')?.classList.add('hidden');

    if (pushState && window.location.hash !== '#planner') {
      history.pushState({ view: 'planner' }, '', '#planner');
    }

    if (typeof updateSearchVisibility === 'function') updateSearchVisibility(false);
    injectPlannerHeaderBadge();

    const rawIdeas = typeof getIdeaList === 'function' ? getIdeaList() : [];
    let ideas = rawIdeas.map((item, originalIndex) => ({ ...item, originalIndex }));

    if (typeof currentPlannerGenreFilters !== 'undefined' && currentPlannerGenreFilters.size > 0) {
      ideas = ideas.filter(item => {
        const itemGenres = getItemGenresList(item);
        return Array.from(currentPlannerGenreFilters).some(g => itemGenres.includes(g));
      });
    }

    if (typeof dailyShuffle === 'function') ideas = dailyShuffle(ideas, '-planner');

    let cardsHTML = '';
    if (rawIdeas.length === 0) {
      cardsHTML = `<p style="text-align:center; grid-column: 1/-1; padding: 30px; color: #fff;">Aucun album dans votre liste d'idées.</p>`;
    } else if (ideas.length === 0) {
      cardsHTML = `<p style="text-align:center; grid-column: 1/-1; padding: 30px; color: #fff;">Aucun album ne correspond aux filtres.</p>`;
    } else {
      cardsHTML = ideas.map(item => {
        const index = item.originalIndex;
        const isSelected = selectedIdeaIndices.has(index);
        const coverSrc = (item.md_cover && item.md_cover !== 'images/' && item.md_cover !== 'images/default.jpg') ? item.md_cover : '';

        const coverHTML = coverSrc 
          ? createLoadingCoverHTML(coverSrc, 'idea-cover', '💡') 
          : `<div class="idea-cover" style="background:#333; display:flex; align-items:center; justify-content:center; color:#aaa; font-size:0.8rem;">Pas d'image</div>`;

        return `
          <div class="idea-card ${isSelected ? 'selected' : ''}" data-index="${index}">
            ${coverHTML}
            <div class="idea-info">
              <div class="idea-title">${item.title || 'Sans titre'}</div>
              <div class="idea-meta">
                <span class="idea-artist">${item.artist || 'Artiste inconnu'}</span>
                <span class="idea-duration">⏱️ ${formatPlannerDuration(item.duration)}</span>
              </div>
            </div>
            <button type="button" class="idea-delete-btn" data-delete="${index}">🗑️</button>
          </div>
        `;
      }).join('');
    }

    const activeGenreCount = typeof currentPlannerGenreFilters !== 'undefined' ? currentPlannerGenreFilters.size : 0;
    const countSelect = selectedIdeaIndices.size;
    const appContainer = document.getElementById('app') || document.body;
    
    appContainer.innerHTML = `
      <div style="padding-bottom: 110px; padding-top: 215px; max-width: 800px; margin: 0 auto;">
        <div class="ideas-grid" id="ideas-grid-container">
          ${cardsHTML}
        </div>

        <div id="planner-floating-actions" class="fab-container">
          <div id="planner-fab-menu" class="fab-menu hidden">
            <!-- Section Filtres -->
            <div class="fab-section-title">Filtres</div>
            <button type="button" id="planner-btn-genre-toggle" class="fab-item" onclick="if(typeof togglePlannerGenreDropdown==='function') togglePlannerGenreDropdown();">
              🎵 Genres ${activeGenreCount > 0 ? '(' + activeGenreCount + ')' : ''}
            </button>

            <!-- Section Recherche -->
            <hr class="fab-divider">
            <div class="fab-section-title">Recherche</div>
            <div style="padding: 2px 4px;">
              <input 
                type="search" 
                id="planner-search-input" 
                class="fab-search-input" 
                placeholder="Chercher une idée..." 
                oninput="handlePlannerSearch(this.value);" 
              />
            </div>

            <!-- Section Options -->
            <hr class="fab-divider">
            <div class="fab-section-title">Options</div>
            <button type="button" id="planner-btn-add" class="fab-item accent" onclick="if(typeof openIdeaModal==='function') openIdeaModal();">
              💽 Ajouter
            </button>
            <button type="button" id="planner-btn-convert" class="fab-item success" onclick="if(typeof convertSelectedToMD==='function') convertSelectedToMD(); else if(typeof convertIdeasToMD==='function') convertIdeasToMD();" ${countSelect === 0 ? 'disabled' : ''}>
              💾 Convertir (${countSelect})
            </button>
            <button type="button" id="planner-btn-reset" class="fab-item danger" onclick="if(typeof clearIdeaSelection==='function') clearIdeaSelection(); else if(typeof resetPlannerSelections==='function') resetPlannerSelections();">
              🔄 Réinitialiser
            </button>
          </div>
          
          <button type="button" id="planner-fab-main-btn" class="fab-main-btn" onclick="togglePlannerFabMenu();" title="Menu planificateur">
            <span class="fab-icon" aria-hidden="true"></span>
          </button>
        </div>
      </div>
    `;

    updatePlannerHeader();

    const gridContainer = document.getElementById('ideas-grid-container');
    if (gridContainer) {
      gridContainer.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('[data-delete]');
        if (deleteBtn) {
          e.stopPropagation();
          const index = parseInt(deleteBtn.getAttribute('data-delete'), 10);
          if (typeof deleteIdeaAlbum === 'function') deleteIdeaAlbum(index);
          return;
        }

        const card = e.target.closest('.idea-card');
        if (card) {
          const index = parseInt(card.getAttribute('data-index'), 10);
          if (typeof toggleIdeaSelection === 'function') toggleIdeaSelection(index);
        }
      });
    }

    window.scrollTo(0, 0);

  } catch (err) {
    console.error("Erreur dans renderCompilPlanner:", err);
  }
}

function togglePlannerFabMenu() {
  const menu = document.getElementById('planner-fab-menu');
  const btn = document.getElementById('planner-fab-main-btn');
  if (!menu) return;
  
  const isOpening = menu.classList.contains('hidden');
  menu.classList.toggle('hidden');

  // Animation de rotation du bouton
  if (btn) {
    btn.classList.toggle('open', isOpening);
  }

  if (!isOpening) {
    window.isPlannerGenreDropdownOpen = false;
    document.getElementById('planner-genre-submenu')?.remove();
  }
}

function toggleIdeaSelection(index) {
  if (typeof selectedIdeaIndices === 'undefined') window.selectedIdeaIndices = new Set();

  if (selectedIdeaIndices.has(index)) {
    selectedIdeaIndices.delete(index);
  } else {
    selectedIdeaIndices.add(index);
  }

  updatePlannerHeader();

  const card = document.querySelector(`.idea-card[data-index="${index}"]`);
  if (card) {
    card.classList.toggle('selected', selectedIdeaIndices.has(index));
  }
}

function togglePlannerGenreDropdown() {
  window.isPlannerGenreDropdownOpen = !Boolean(window.isPlannerGenreDropdownOpen);
  renderPlannerGenreFilter();
}

function renderPlannerGenreFilter(savedScrollTop = 0) {
  const fabMenu = document.getElementById('planner-fab-menu');
  if (!fabMenu) return;

  const existingScrollArea = document.getElementById('planner-genre-scroll-area');
  if (existingScrollArea && savedScrollTop === 0) {
    savedScrollTop = existingScrollArea.scrollTop;
  }

  document.getElementById('planner-genre-submenu')?.remove();
  if (!window.isPlannerGenreDropdownOpen) return;

  const genresSet = new Set();
  const ideas = getIdeaList();
  ideas.forEach(item => {
    getItemGenresList(item).forEach(g => genresSet.add(g));
  });

  const genres = Array.from(genresSet).sort();
  if (genres.length === 0) return;

  const subMenu = document.createElement('div');
  subMenu.id = 'planner-genre-submenu';
  subMenu.className = 'fab-submenu fab-genre-submenu';

  const activeFilters = typeof currentPlannerGenreFilters !== 'undefined' ? currentPlannerGenreFilters : new Set();

  const createGenreBtn = (text, isSelected, onClick) => {
    const btn = document.createElement('div');
    btn.className = `fab-genre-item ${isSelected ? 'active' : ''}`;
    btn.innerHTML = `<span>${text}</span>${isSelected ? '<span>✓</span>' : ''}`;
    btn.onclick = (e) => {
      e.stopPropagation();
      onClick(e);
    };
    return btn;
  };

  // 1. Bouton "Tous les genres" FIXE en haut du sous-menu
  const allBtn = createGenreBtn('TOUS', activeFilters.size === 0, () => {
    if (typeof clearPlannerGenreFilters === 'function') clearPlannerGenreFilters();
  });
  subMenu.appendChild(allBtn);

  // 2. Zone défilante pour le reste des genres
  const scrollArea = document.createElement('div');
  scrollArea.id = 'planner-genre-scroll-area';
  scrollArea.className = 'fab-scrollable-submenu fab-genre-list';

  genres.forEach(g => {
    scrollArea.appendChild(createGenreBtn(g, activeFilters.has(g), () => {
      if (typeof togglePlannerGenreFilter === 'function') togglePlannerGenreFilter(g);
    }));
  });

  subMenu.appendChild(scrollArea);
  
  // Insertion directe après le bouton de bascule de genre
  const genreToggleBtn = document.getElementById('planner-btn-genre-toggle');
  if (genreToggleBtn && genreToggleBtn.nextSibling) {
    fabMenu.insertBefore(subMenu, genreToggleBtn.nextSibling);
  } else {
    fabMenu.appendChild(subMenu);
  }

  if (savedScrollTop > 0) {
    scrollArea.scrollTop = savedScrollTop;
  }
}

function togglePlannerGenreFilter(genre) {
  const scrollArea = document.getElementById('planner-genre-scroll-area');
  const scrollTop = scrollArea ? scrollArea.scrollTop : 0;

  if (typeof currentPlannerGenreFilters === 'undefined') window.currentPlannerGenreFilters = new Set();

  if (currentPlannerGenreFilters.has(genre)) {
    currentPlannerGenreFilters.delete(genre);
  } else {
    currentPlannerGenreFilters.add(genre);
  }

  renderCompilPlanner(false);

  // On s'assure d'enlever le hidden au lieu d'injecter du display inline
  const menu = document.getElementById('planner-fab-menu');
  if (menu) menu.classList.remove('hidden');
  window.isPlannerGenreDropdownOpen = true;

  renderPlannerGenreFilter(scrollTop);
}

function clearPlannerGenreFilters() {
  if (typeof currentPlannerGenreFilters !== 'undefined') {
    currentPlannerGenreFilters.clear();
  }
  renderCompilPlanner(false);

  // On s'assure d'enlever le hidden au lieu d'injecter du display inline
  const menu = document.getElementById('planner-fab-menu');
  if (menu) menu.classList.remove('hidden');
  window.isPlannerGenreDropdownOpen = true;

  renderPlannerGenreFilter(0);
}

function deleteIdeaAlbum(index) {
  const ideas = getIdeaList();
  if (!ideas[index]) return;

  if (confirm(`Supprimer "${ideas[index].title}" de vos idées ?`)) {
    ideas.splice(index, 1);
    
    if (typeof selectedIdeaIndices !== 'undefined') {
      const updatedIndices = new Set();
      selectedIdeaIndices.forEach(i => {
        if (i > index) updatedIndices.add(i - 1);
        else if (i < index) updatedIndices.add(i);
      });
      selectedIdeaIndices = updatedIndices;
    }

    if (typeof saveLocalBackup === 'function') saveLocalBackup();
    if (typeof showToast === 'function') showToast("🗑️ Album supprimé des idées");
    renderCompilPlanner(false);
  }
}

function clearIdeaSelection() {
  if (typeof selectedIdeaIndices !== 'undefined') {
    selectedIdeaIndices.clear();
  }
  renderCompilPlanner(false);
}

/* ==========================================
   CORRESPONDANCE GENRE MUSICBRAINZ -> GENRE PRINCIPAL (8 genres fixes)
   ========================================== */
const ITUNES_GENRE_TO_MAIN = {
  'Alternative': 'Alternative & Grunge 90s',
  'Alternative Rock': 'Alternative & Grunge 90s',
  'Grunge': 'Alternative & Grunge 90s',
  'Rock': 'Rock & Blues',
  'Blues': 'Rock & Blues',
  'Blues Rock': 'Rock & Blues',
  'Punk': 'Rock & Blues',
  'Punk Rock': 'Rock & Blues',
  'Metal': 'Metal & Hard Rock',
  'Heavy Metal': 'Metal & Hard Rock',
  'Hard Rock': 'Metal & Hard Rock',
  'Hip-Hop/Rap': 'Rap, Soul & Reggae',
  'Hip Hop': 'Rap, Soul & Reggae',
  'Rap': 'Rap, Soul & Reggae',
  'R&B/Soul': 'Rap, Soul & Reggae',
  'Reggae': 'Rap, Soul & Reggae',
  'Funk': 'Rap, Soul & Reggae',
  'Pop': 'Pop & Folk & Variety',
  'Folk': 'Pop & Folk & Variety',
  'Singer/Songwriter': 'Pop & Folk & Variety',
  'Vocal': 'Pop & Folk & Variety',
  'Chanson': 'Pop & Folk & Variety',
  'Chanson française': 'Pop & Folk & Variety',
  'Comedy': 'Talks & Humour',
  'Spoken Word': 'Talks & Humour',
  'Electronic': 'Électro, Trip-Hop & Expérimental',
  'Electronica': 'Électro, Trip-Hop & Expérimental',
  'Dance': 'Électro, Trip-Hop & Expérimental',
  'Trip-Hop': 'Électro, Trip-Hop & Expérimental',
  'Ambient': 'Ambient & Orchestral',
  'Soundtrack': 'Ambient & Orchestral',
  'Classical': 'Ambient & Orchestral',
  'Orchestral': 'Ambient & Orchestral',
};

function guessMainGenreFromItunes(genreName) {
  if (!genreName) return '';
  if (ITUNES_GENRE_TO_MAIN[genreName]) return ITUNES_GENRE_TO_MAIN[genreName];
  
  // Recherche insensible à la casse
  const found = Object.keys(ITUNES_GENRE_TO_MAIN).find(
    k => k.toLowerCase() === genreName.toLowerCase()
  );
  return found ? ITUNES_GENRE_TO_MAIN[found] : '';
}

let pendingItunesCoverUrl = null; // Pochette choisie via MusicBrainz, en attente d'upload

function openIdeaModal() {
  const form = document.getElementById('idea-form');
  if (form) form.reset();
  const coverInput = document.getElementById('idea-cover');
  if (coverInput) coverInput.value = "";
  const preview = document.getElementById('idea-cover-preview');
  if (preview) preview.innerHTML = '';
  const results = document.getElementById('itunes-results');
  if (results) results.innerHTML = '';
  const searchInput = document.getElementById('itunes-search-input');
  if (searchInput) searchInput.value = '';
  pendingItunesCoverUrl = null;
  document.getElementById('idea-modal')?.classList.remove('hidden');
}

function closeIdeaModal() {
  document.getElementById('idea-modal')?.classList.add('hidden');
}

async function saveIdeaAlbum(e) {
  if (e) e.preventDefault();
  const title = document.getElementById('idea-title').value.trim();
  const artist = document.getElementById('idea-artist').value.trim();
  const main_genre = document.getElementById('idea-genre').value;
  const tags = (document.getElementById('idea-tags').value || '').split(',').map(t => t.trim()).filter(Boolean);
  const release_year = document.getElementById('idea-year').value.trim();
  const duration = document.getElementById('idea-duration').value.trim();
  const tracks = (document.getElementById('idea-tracks').value || '').split('\n').map(t => t.trim()).filter(Boolean);
  const coverInput = document.getElementById('idea-cover');

  if (!main_genre) {
    showToast("⚠️ Veuillez choisir un genre");
    return;
  }

  showToast("⏳ Traitement et envoi de l'image...");

  // Priorité : fichier choisi manuellement > pochette récupérée via MusicBrainz > pochette par défaut
  let coverPath = 'images/default.jpg';
  if (coverInput && coverInput.files && coverInput.files.length > 0) {
    const uploadedPath = await handleImageUpload(coverInput);
    if (uploadedPath) coverPath = uploadedPath;
  } else if (pendingItunesCoverUrl) {
    const uploadedPath = await handleRemoteImageUpload(pendingItunesCoverUrl);
    coverPath = uploadedPath || pendingItunesCoverUrl;
  }

  const newIdea = {
    id: 'idea-' + Date.now(),
    md_cover: coverPath,
    title,
    artist,
    main_genre,
    tags,
    release_year,
    duration,
    tracks,
    toRecord: false,
  };

  if (!window.ideaAlbums) window.ideaAlbums = [];
  window.ideaAlbums.push(newIdea);

  if (typeof saveLocalBackup === 'function') saveLocalBackup();
  closeIdeaModal();
  if (typeof showToast === 'function') showToast("💡 Album ajouté aux idées !");
  if (typeof renderCompilPlanner === 'function') renderCompilPlanner(false);
}

function convertSelectedToMD() {
  if (typeof selectedIdeaIndices === 'undefined' || selectedIdeaIndices.size === 0) return;

  const ideas = getIdeaList();
  const selectedAlbums = Array.from(selectedIdeaIndices).map(i => ideas[i]);

  const mdId = 'md-' + Date.now();
  const albums = selectedAlbums.map((a, i) => ({
    id: mdId + '-alb-' + (i + 1),
    md_cover: a.md_cover || 'images/default.jpg',
    title: a.title || '',
    artist: a.artist || '',
    main_genre: a.main_genre || '',
    tags: a.tags || [],
    release_year: a.release_year || '',
    duration: a.duration || '',
    tracks: a.tracks || [],
    toRecord: false,
  }));

  let newMD;
  if (albums.length === 1) {
    // Un seul album sélectionné : pas de couche "albums", tout est directement sur le MD.
    const alb = albums[0];
    newMD = { 
      id: mdId, 
      md_cover: alb.md_cover, 
      title: alb.title, 
      artist: alb.artist,
      main_genre: alb.main_genre, 
      tags: alb.tags, 
      release_year: alb.release_year,
      duration: alb.duration, 
      tracks: alb.tracks, 
      toRecord: alb.toRecord 
    };
  } else {
    newMD = {
      id: mdId,
      md_cover: albums[0].md_cover || 'images/default.jpg',
      title: albums.map(a => a.title).filter(Boolean).join(' / '),
      albums,
    };
  }

  if (Array.isArray(catalogData)) {
    catalogData.push(newMD);
  } else if (catalogData && Array.isArray(catalogData.minidiscs)) {
    catalogData.minidiscs.push(newMD);
  }

  window.ideaAlbums = ideas.filter((_, idx) => !selectedIdeaIndices.has(idx));
  selectedIdeaIndices.clear();

  clearPlannerHeaderInfo();
  if (typeof saveLocalBackup === 'function') saveLocalBackup();
  if (typeof showToast === 'function') showToast("🎉 Albums convertis en MiniDisc avec succès !");
  if (typeof renderDashboard === 'function') renderDashboard(true);
}

/* ==========================================
   RECHERCHE AUTOMATIQUE DE MÉTADONNÉES (MusicBrainz)
   ------------------------------------------
   Objectif : retrouver l'album d'origine (pas les rééditions, remixes, bootlegs, hommages...)
   sans noyer l'utilisateur sous des résultats sans rapport.

   1. Recherche stricte : chaque mot saisi doit se trouver dans l'artiste OU dans le titre,
      dans n'importe quel ordre ("daft punk discovery" comme "discovery daft punk").
   2. Si rien n'est trouvé : recherche tolérante (fautes de frappe, début de mot).
   3. Si rien encore : recherche large (au moins la moitié des mots).
   Chaque réponse est ensuite filtrée (hommages, reprises...), dédoublonnée (une seule version
   par album, la plus ancienne) et classée (albums studio d'abord, puis par date de sortie).
   ========================================== */
const MB_API = 'https://musicbrainz.org/ws/2';
const MB_HEADERS = { 'User-Agent': 'MiniDiscCatalogApp/1.0 (contact@example.com)' };
const MB_MAX_RESULTS = 12;
const MB_MIN_DELAY_MS = 1100; // MusicBrainz limite à environ 1 requête par seconde

// Mots ignorés dans la saisie (ils n'aident pas à identifier un album)
const MB_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'et', 'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une']);

// Hommages, reprises, karaoké... Mots entiers uniquement : "Discovery" ne doit pas être bloqué par "cover".
const MB_PARASITE_REGEX = /\b(tributes?|tributo|performs|performed by|covers?|cover versions?|lullab(?:y|ies)|played by|string quartet|karaoke|panpipes?|smooth jazz version|soundfont|made famous by|in the style of|originally performed|bootlegs?|unofficial|remix(?:es|ed)?)\b/i;

// Marqueurs de réédition : ces résultats passent après l'édition d'origine
const MB_REISSUE_REGEX = /\b(deluxe|remaster(?:ed)?|anniversary|expanded|re-?issue|special edition|collector'?s?|legacy edition|bonus (?:tracks?|disc|cd)|edition)\b/i;

let mbLastCallAt = 0;

async function mbFetchJson(url) {
  const wait = mbLastCallAt + MB_MIN_DELAY_MS - Date.now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  mbLastCallAt = Date.now();

  const response = await fetch(url, { headers: MB_HEADERS });
  if (response.status === 503 || response.status === 429) {
    const err = new Error("MusicBrainz limite le nombre de requêtes");
    err.rateLimited = true;
    throw err;
  }
  if (!response.ok) throw new Error(`Erreur réseau MusicBrainz (${response.status})`);
  return response.json();
}

// minuscules, sans accents ni ponctuation
function mbNormalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Mots utiles de la saisie (sans mots vides ni lettres isolées, sauf s'il ne reste rien)
function mbQueryTokens(rawTerm) {
  const all = mbNormalize(rawTerm).split(' ').filter(Boolean);
  const useful = all.filter(t => t.length > 1 && !MB_STOPWORDS.has(t));
  return useful.length > 0 ? useful : all;
}

function mbEditDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = temp;
    }
  }
  return prev[b.length];
}

// Le mot saisi se retrouve-t-il dans le texte (tolérance d'une ou deux fautes pour les mots longs) ?
function mbTokenMatches(token, hayWords, hayText) {
  if (token.length <= 2) return hayWords.includes(token);
  if (token.length > 3 && hayText.includes(token)) return true;
  if (token.length === 3 && hayWords.includes(token)) return true;
  const maxDistance = token.length >= 8 ? 2 : 1;
  return hayWords.some(w => Math.abs(w.length - token.length) <= maxDistance && mbEditDistance(w, token) <= maxDistance);
}

function mbBuildQuery(tokens, mode) {
  let core;
  if (mode === 'or') {
    const anyToken = tokens.join(' OR ');
    core = `(artist:(${anyToken}) OR releasegroup:(${anyToken}))`;
  } else {
    core = tokens.map(t => {
      const forms = (mode === 'fuzzy' && t.length >= 3) ? `${t}~ OR ${t}*` : t;
      return `(artist:(${forms}) OR releasegroup:(${forms}))`;
    }).join(' AND ');
  }

  // Albums et EP uniquement, hors remixes, DJ-mix, démos, livres audio et interviews.
  // Live / compilations / bandes originales restent autorisés (ils seront simplement classés après).
  return `${core} AND (primarytype:Album OR primarytype:EP)` +
    ` AND NOT (secondarytype:Remix OR secondarytype:"DJ-mix" OR secondarytype:Demo OR secondarytype:Audiobook OR secondarytype:"Audio drama" OR secondarytype:Interview)`;
}

async function mbSearchReleaseGroups(tokens, mode) {
  const query = mbBuildQuery(tokens, mode);
  const url = `${MB_API}/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=50`;
  const data = await mbFetchJson(url);
  return data['release-groups'] || [];
}

function mbArtistName(group, separator = ' ') {
  return group['artist-credit'] ? group['artist-credit'].map(a => a.name).join(separator) : '';
}

// Titre sans les mentions d'édition, pour reconnaître "Nevermind" et "Nevermind (Deluxe Edition)" comme un seul album
function mbBaseTitle(title) {
  return mbNormalize(
    String(title || '')
      .replace(/[(\[][^)\]]*(?:deluxe|remaster|anniversary|expanded|re-?issue|edition|bonus)[^)\]]*[)\]]/gi, ' ')
      .replace(/\s[-–:]\s.*(?:deluxe|remaster|anniversary|expanded|re-?issue|edition|bonus).*$/i, ' ')
  );
}

function mbTypeRank(group) {
  const secondary = (group['secondary-types'] || []).map(t => t.toLowerCase());
  let rank = 0;
  if (secondary.length > 0) rank = (secondary.includes('live') || secondary.includes('mixtape/street')) ? 2 : 1;
  if (group['primary-type'] === 'EP') rank += 1;
  return rank;
}

// Filtre, dédoublonne et classe les résultats bruts. minRatio = part des mots saisis qui doit être retrouvée.
function mbFilterAndRank(rawGroups, tokens, minRatio) {
  const candidates = [];

  rawGroups.forEach(g => {
    const title = g.title || '';
    const artist = mbArtistName(g);
    if (MB_PARASITE_REGEX.test(title) || MB_PARASITE_REGEX.test(artist)) return;

    const hayText = mbNormalize(`${artist} ${title}`);
    const hayWords = hayText.split(' ');
    const matched = tokens.filter(t => mbTokenMatches(t, hayWords, hayText)).length;
    const ratio = tokens.length > 0 ? matched / tokens.length : 1;
    if (ratio < minRatio) return;

    candidates.push({
      group: g,
      ratio,
      reissue: MB_REISSUE_REGEX.test(title) ? 1 : 0,
      rank: mbTypeRank(g),
      year: g['first-release-date'] ? (parseInt(g['first-release-date'].slice(0, 4), 10) || 9999) : 9999,
      score: g.score || 0,
      key: `${mbNormalize(artist)}|${mbBaseTitle(title)}`
    });
  });

  candidates.sort((a, b) =>
    (b.ratio - a.ratio) ||
    (a.reissue - b.reissue) ||
    (a.rank - b.rank) ||
    (a.year - b.year) ||
    (b.score - a.score)
  );

  // Une seule version par album : la première du classement (originale, la plus ancienne)
  const seen = new Set();
  const unique = candidates.filter(c => {
    if (seen.has(c.key)) return false;
    seen.add(c.key);
    return true;
  });

  return unique.slice(0, MB_MAX_RESULTS).map(c => c.group);
}

function mbEscapeHTML(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function searchItunes() {
  const input = document.getElementById('itunes-search-input');
  const resultsBox = document.getElementById('itunes-results');
  if (!input || !resultsBox) return;

  const rawTerm = input.value.trim();
  const tokens = mbQueryTokens(rawTerm);
  if (!rawTerm || tokens.length === 0) {
    showToast("⚠️ Tape un artiste et/ou un album à rechercher");
    return;
  }

  resultsBox.innerHTML = `<p style="font-size:0.8rem; color:var(--text-sub);">Recherche sur MusicBrainz...</p>`;

  try {
    // Du plus strict au plus souple : on ne passe au niveau suivant que s'il n'y a aucun résultat
    const attempts = [
      { mode: 'and', minRatio: 1, label: '' },
      { mode: 'fuzzy', minRatio: 1, label: 'Recherche élargie (fautes de frappe)...' },
      { mode: 'or', minRatio: 0.5, label: 'Recherche élargie (mots en moins)...' }
    ];

    let groups = [];
    for (const attempt of attempts) {
      if (attempt.label) resultsBox.innerHTML = `<p style="font-size:0.8rem; color:var(--text-sub);">${attempt.label}</p>`;
      const rawGroups = await mbSearchReleaseGroups(tokens, attempt.mode);
      groups = mbFilterAndRank(rawGroups, tokens, attempt.minRatio);
      if (groups.length > 0) break;
    }

    if (groups.length === 0) {
      resultsBox.innerHTML = `<p style="font-size:0.8rem; color:var(--text-sub);">Aucun résultat correspondant trouvé. Essaie avec moins de mots (ex : juste l'artiste).</p>`;
      return;
    }

    window.__itunesResults = groups;

    resultsBox.innerHTML = groups.map((g, i) => {
      const artist = mbArtistName(g, ', ') || 'Artiste inconnu';
      const year = g['first-release-date'] ? g['first-release-date'].slice(0, 4) : '';
      const secondary = (g['secondary-types'] || []).join(', ');
      const coverUrl = `https://coverartarchive.org/release-group/${g.id}/front-250`;
      const details = [year, secondary].filter(Boolean).join(' · ');

      return `
        <div class="itunes-result-item" data-index="${i}">
          <img src="${coverUrl}" 
               onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'40\\' height=\\'40\\' viewBox=\\'0 0 24 24\\'><rect width=\\'24\\' height=\\'24\\' fill=\\'%23eee\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-size=\\'12\\'>💿</text></svg>';" 
               style="width:40px; height:40px; border-radius:4px; object-fit:cover; background:#eee;">
          <div style="flex:1; font-size:0.8rem;">
            <div style="font-weight:700;">${mbEscapeHTML(g.title)}</div>
            <div style="color:var(--text-sub);">${mbEscapeHTML(artist)}${details ? ' · ' + mbEscapeHTML(details) : ''}</div>
          </div>
        </div>
      `;
    }).join('');

    resultsBox.querySelectorAll('.itunes-result-item').forEach(el => {
      el.addEventListener('click', () => applyItunesResult(parseInt(el.dataset.index, 10)));
    });
  } catch (err) {
    console.error(err);
    resultsBox.innerHTML = err.rateLimited
      ? `<p style="font-size:0.8rem; color:#e63946;">MusicBrainz limite le nombre de requêtes : réessaie dans quelques secondes.</p>`
      : `<p style="font-size:0.8rem; color:#e63946;">Erreur pendant la recherche MusicBrainz.</p>`;
  }
}

// Ordre de préférence des éditions d'un album pour récupérer la liste de pistes :
// officielle, sans mention de réédition, puis la plus ancienne.
function mbCompareReleases(a, b) {
  const official = r => (r.status === 'Official' ? 0 : 1);
  const reissue = r => (MB_REISSUE_REGEX.test(`${r.title || ''} ${r.disambiguation || ''}`) ? 1 : 0);
  const date = r => (r.date && r.date.length >= 4 ? r.date : '9999');
  return (official(a) - official(b)) || (reissue(a) - reissue(b)) || date(a).localeCompare(date(b));
}

async function applyItunesResult(index) {
  const g = window.__itunesResults && window.__itunesResults[index];
  if (!g) return;

  // --- FERMETURE DE LA LISTE DE RÉSULTATS ---
  const resultsBox = document.getElementById('itunes-results');
  if (resultsBox) {
    resultsBox.innerHTML = ''; // Vide la liste pour laisser voir le formulaire
  }

  const artistName = mbArtistName(g, ', ');

  document.getElementById('idea-title').value = g.title || '';
  document.getElementById('idea-artist').value = artistName;
  if (g['first-release-date']) {
    document.getElementById('idea-year').value = g['first-release-date'].slice(0, 4);
  }

  // --- GESTION MULTI-TAGS & GENRE PRINCIPAL ---
  if (g.tags && g.tags.length > 0) {
    const sortedTags = [...g.tags].sort((a, b) => (b.count || 0) - (a.count || 0));
    const tagNames = sortedTags.slice(0, 5).map(t => t.name);
    document.getElementById('idea-tags').value = tagNames.join(', ');

    let guessedGenre = '';
    for (const tag of tagNames) {
      guessedGenre = guessMainGenreFromItunes(tag);
      if (guessedGenre) break;
    }

    const genreSelect = document.getElementById('idea-genre');
    if (guessedGenre && genreSelect) {
      genreSelect.value = guessedGenre;
    }
  }

  // Pochette via le release-group
  const preview = document.getElementById('idea-cover-preview');
  pendingItunesCoverUrl = `https://coverartarchive.org/release-group/${g.id}/front-500`;
  
  if (preview) {
    preview.innerHTML = `
      <img src="${pendingItunesCoverUrl}" 
           onerror="this.onerror=null; this.parentElement.innerHTML='<div style=\\'font-size:0.7rem; color:#888;\\'>Pas de pochette disponible sur Cover Art Archive</div>';" 
           style="width:80px; height:80px; border-radius:6px; object-fit:cover;">
      <div style="font-size:0.7rem; color:var(--text-sub);">Pochette récupérée (transférée à l'enregistrement)</div>
    `;
  }

  showToast("⏳ Récupération des pistes et de la durée...");

  // --- RECHERCHE DES PISTES ET DURÉES ---
  try {
    const relUrl = `${MB_API}/release?release-group=${g.id}&inc=recordings+media&fmt=json&limit=25`;
    const relData = await mbFetchJson(relUrl);
    // Édition d'origine en premier : c'est sa liste de pistes et sa durée qu'on veut
    const releases = (relData.releases || []).slice().sort(mbCompareReleases);

    let tracks = [];
    
    for (const rel of releases) {
      if (rel.media && rel.media.length > 0) {
        for (const m of rel.media) {
          if (m.tracks && m.tracks.length > 0) {
            tracks = m.tracks;
            break;
          }
        }
      }
      if (tracks.length > 0) break;
    }

    if (tracks.length > 0) {
      document.getElementById('idea-tracks').value = tracks
        .map(t => t.title)
        .join('\n');

      const totalMs = tracks.reduce((sum, t) => {
        const length = t.length || (t.recording ? t.recording.length : 0) || 0;
        return sum + length;
      }, 0);

      if (totalMs > 0) {
        document.getElementById('idea-duration').value = formatMillisToDuration(totalMs);
      } else {
        document.getElementById('idea-duration').value = '';
      }
      showToast("✅ Infos et pistes récupérées !");
    } else {
      showToast("⚠️ Album trouvé, mais aucune liste de pistes renseignée.");
    }

  } catch (err) {
    console.error(err);
    showToast(err.rateLimited
      ? "⚠️ MusicBrainz est saturé : rouvre l'album dans quelques secondes."
      : "⚠️ Erreur lors de la récupération des pistes.");
  }
}

function formatMillisToDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Tente de transférer une image distante (URL iTunes) vers le dossier images/ du dépôt GitHub,
// comme pour une pochette uploadée manuellement. Si ça échoue (CORS, pas de token...), on
// renvoie null : l'appelant gardera alors le lien iTunes d'origine plutôt que de bloquer.
async function handleRemoteImageUpload(imageUrl) {
  const token = getGithubToken();
  if (!token) {
    console.warn("Pas de token GitHub disponible. La pochette iTunes restera un lien externe.");
    return null;
  }

  try {
    const imgResponse = await fetch(imageUrl);
    if (!imgResponse.ok) throw new Error("Téléchargement de l'image distante impossible.");
    const blob = await imgResponse.blob();

    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const extension = (blob.type && blob.type.includes('png')) ? 'png' : 'jpg';
    const fileName = `img_${Date.now()}.${extension}`;
    const filePath = `images/${fileName}`;

    const url = `${GITHUB_API_BASE}${filePath}`;

    const putResponse = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        message: `Ajout automatique de la pochette ${fileName} (iTunes)`,
        content: base64Data
      })
    });

    if (putResponse.ok) {
      localImageOverrides.set(filePath, URL.createObjectURL(blob)); // affichage immédiat, sans attendre GitHub Pages
      return filePath;
    }
    console.error("Erreur lors de l'envoi de la pochette iTunes sur GitHub :", await putResponse.json());
    return null;
  } catch (err) {
    console.warn("Transfert de la pochette iTunes impossible (probablement une restriction CORS) :", err);
    return null;
  }
}

/* ==========================================
   GESTION DE LA RECHERCHE PLANIFICATEUR VIA FAB
   ========================================== */
function handlePlannerSearch(query) {
  const searchTerm = query ? query.toLowerCase().trim() : '';
  
  // Sélectionne toutes les cartes d'idées générées par renderCompilPlanner (.idea-card)
  const ideaCards = document.querySelectorAll('#ideas-grid-container .idea-card');

  ideaCards.forEach(card => {
    // Récupère le titre et l'artiste présents dans la carte
    const title = card.querySelector('.idea-title')?.textContent.toLowerCase() || '';
    const artist = card.querySelector('.idea-artist')?.textContent.toLowerCase() || '';
    
    // Si la recherche correspond au titre ou à l'artiste, on affiche la carte
    if (title.includes(searchTerm) || artist.includes(searchTerm)) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });
}

/* ==========================================
   GESTION DU BOUTON RETOUR (ANCRAGE HASH)
   ========================================== */

window.addEventListener('popstate', () => {
  const hash = window.location.hash;

  if (hash.startsWith('#md-') && !hash.includes('list')) {
    const index = parseInt(hash.replace('#md-', ''), 10);
    if (!isNaN(index) && typeof openMD === 'function') {
      openMD(index, false);
      return;
    }
  }

  if (hash === '#md-list') {
    if (typeof clearPlannerHeaderInfo === 'function') clearPlannerHeaderInfo();
    if (typeof renderMDList === 'function') {
      renderMDList({ genre: currentGenreFilter, type: currentTypeFilter }, false);
      return;
    }
  }

  if (hash === '#planner') {
    if (typeof renderCompilPlanner === 'function') {
      renderCompilPlanner(false);
      return;
    }
  }

  // Si le hash est vide, #home ou inconnu -> Accueil
  if (typeof clearPlannerHeaderInfo === 'function') clearPlannerHeaderInfo();
  if (typeof renderDashboard === 'function') renderDashboard(false);
});

// Remplit dynamiquement les menus déroulants avec genres et types existants
function populateFormDatalists() {
  if (!catalogData || !Array.isArray(catalogData)) return;

  const genresSet = new Set();

  catalogData.forEach(md => {
    if (typeof getMDAllGenres === 'function') {
      getMDAllGenres(md).forEach(g => genresSet.add(g));
    }
  });

  const genresDatalist = document.getElementById('genres-list');

  if (genresDatalist) {
    genresDatalist.innerHTML = Array.from(genresSet)
      .filter(Boolean)
      .sort()
      .map(g => `<option value="${g}">`)
      .join('');
  }
}

/* =======================
   CONNEXION A GITHUB
   =======================*/
// Sauvegarder le token sur le téléphone
function saveGithubToken(token) {
  localStorage.setItem('github_token', token.trim());
  alert('Token GitHub enregistré avec succès !');
}

// Récupérer le token stocké
function getGithubToken() {
  return localStorage.getItem('github_token');
}

// Gestion du token GitHub dans app.js
function initGithubTokenForm() {
  const tokenInput = document.getElementById('gh-token-input');
  const saveBtn = document.getElementById('save-token-btn');

  if (!saveBtn || !tokenInput) return;

  tokenInput.value = getGithubToken() || '';

  saveBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const val = tokenInput.value;
    if (val) {
      saveGithubToken(val);
    } else {
      localStorage.removeItem('github_token');
      alert('Token supprimé.');
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGithubTokenForm);
} else {
  initGithubTokenForm();
}

async function handleImageUpload(fileInput) {
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    return null; // Aucun fichier sélectionné
  }

  const file = fileInput.files[0];
  const token = getGithubToken();

  if (!token) {
    console.warn("Pas de token GitHub disponible. Impossible d'envoyer l'image.");
    return null;
  }

  // Nom de fichier unique basé sur le horodatage pour éviter d'écraser des images existantes
  const extension = file.name.split('.').pop().toLowerCase();
  const fileName = `img_${Date.now()}.${extension}`;
  const filePath = `images/${fileName}`;

  const url = `${GITHUB_API_BASE}${filePath}`;

  try {
    // Lecture du fichier local en Base64
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });

    // Envoi à l'API GitHub
    const putResponse = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        message: `Ajout automatique de l'image ${fileName}`,
        content: base64Data
      })
    });

    if (putResponse.ok) {
      console.log(`Image envoyée sur GitHub : ${filePath}`);
      localImageOverrides.set(filePath, URL.createObjectURL(file)); // affichage immédiat, sans attendre GitHub Pages
      return filePath;
    } else {
      console.error("Erreur lors de l'envoi de l'image sur GitHub :", await putResponse.json());
      return null;
    }
  } catch (err) {
    console.error("Erreur réseau pendant le chargement de l'image :", err);
    return null;
  }
}

/* ==========================================
   HELPER D'AFFICHAGE DES IMAGES (NOW LOADING)
   ========================================== */
// Pochettes envoyées pendant cette session : on les affiche tout de suite depuis l'appareil,
// sans attendre que GitHub Pages ait publié le fichier (quelques dizaines de secondes).
const localImageOverrides = new Map();

function resolveImageSrc(path) {
  return localImageOverrides.get(path) || path;
}

function rawGithubUrl(path) {
  return `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/HEAD/${encodeURI(path)}`;
}

// Si l'image n'est pas (encore) publiée sur le site, on tente une fois de la lire directement
// dans le dépôt GitHub ; sinon on garde l'affichage "NOW LOADING...".
function handleCoverError(img) {
  const path = img.dataset.path || '';
  if (!img.dataset.rawTried && /^images\//.test(path)) {
    img.dataset.rawTried = '1';
    img.src = rawGithubUrl(path);
    return;
  }
  img.style.opacity = '0';
  const label = img.previousElementSibling;
  if (label) {
    label.style.display = 'block';
    label.textContent = 'NOW LOADING...';
  }
}

function createLoadingCoverHTML(srcPath, cssClass = '') {
  // S'il n'y a vraiment aucun chemin renseigné
  if (!srcPath || srcPath.trim() === '' || srcPath === 'images/' || srcPath === 'images/default.jpg') {
    return `
      <div class="cover-wrapper ${cssClass}" style="position: relative; background: #111; overflow: hidden; display: flex; align-items: center; justify-content: center; border: 1px solid #333;">
        <span style="color: #666; font-family: monospace; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1px; text-align: center; padding: 4px;">PAS D'IMAGE</span>
      </div>
    `;
  }

  // Si une image est renseignée, on affiche l'effet NOW LOADING...
  return `
    <div class="cover-wrapper ${cssClass}" style="position: relative; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center; border: 1px solid #333;">
      <span class="now-loading-text" style="color: #00ff66; font-family: monospace; font-size: 0.75rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; animation: pulseLoading 1.2s infinite; text-shadow: 0 0 5px rgba(0,255,102,0.6); pointer-events: none; text-align: center; padding: 4px;">NOW LOADING...</span>
      <img 
        src="${resolveImageSrc(srcPath)}" 
        data-path="${srcPath}"
        alt="Cover"
        onload="this.previousElementSibling.style.display='none'; this.style.opacity='1';"
        onerror="handleCoverError(this)"
        style="position: absolute; top:0; left:0; width:100%; height:100%; object-fit: cover; opacity: 0; transition: opacity 0.4s ease;"
      >
    </div>
  `;
}

/* ==========================================
   DÉMARRAGE
   ========================================== */
// Entrée : évite d'envoyer le formulaire "idée" par erreur, lance la recherche à la place
document.getElementById('itunes-search-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchItunes();
  }
});

initData();
