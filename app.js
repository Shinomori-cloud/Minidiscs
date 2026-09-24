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
  if (JSON.stringify(buildPayload()) !== before) refreshCurrentPage();
}

async function initData() {
  const backup = readLocalBackup();

  // 1) Des modifications locales attendent encore leur envoi : elles font foi.
  //    On les affiche tout de suite et on relance l'envoi.
  if (backup && getGithubToken() && readSyncMeta().pending) {
    processLoadedData(backup);
    bootRoute();
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
      bootRoute();
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
    bootRoute();
    return;
  }

  // 3) GitHub injoignable : copie locale, ou message d'erreur si on n'a rien.
  if (backup) {
    processLoadedData(backup);
    bootRoute();
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

/* ==========================================
   NAVIGATION : HIÉRARCHIE FIXE, PILE INTERNE, MÉMOIRE DE DÉFILEMENT
   ------------------------------------------
   Chaque page a un seul parent, toujours le même quel que soit le chemin emprunté pour y arriver
   (Titres -> Albums -> Minidiscs -> Accueil ; Planificateur -> Créer -> Accueil ; etc.). Le bouton
   retour de l'appli ET celui du téléphone appellent tous les deux goBack(), qui calcule ce parent
   puis y navigue : le retour amène donc toujours au même endroit, peu importe comment on est arrivé
   sur la page actuelle.

   La profondeur réelle de navigation n'est suivie qu'en mémoire (currentPage) : l'adresse affichée est
   mise à jour avec history.replaceState (jamais pushState), et une unique entrée "sentinelle" est ajoutée
   après le chargement pour intercepter le bouton retour. La pile d'historique du navigateur ne grandit
   donc jamais vraiment : un appui sur retour ne peut jamais tomber à court d'entrées et fermer
   l'application par erreur tant qu'il reste une page entre l'écran actuel et l'accueil - ce qui est la
   cause du bug où les premiers appuis sur retour fermaient l'application.
   ========================================== */

let currentPage = { key: 'dashboard' };
const pageScrollMemory = new Map(); // clé de page -> défilement vertical à restaurer en y revenant

function pageScrollKey(page) {
  switch (page.key) {
    case 'md': return 'md-' + page.mdIndex;
    case 'track': return 'track-' + page.mdIndex + '-' + page.albumIndex;
    case 'discover-disco': return 'discover-disco-' + mbNormalize(page.artist || '');
    default: return page.key;
  }
}

function rememberScrollForCurrentPage() {
  pageScrollMemory.set(pageScrollKey(currentPage), window.scrollY);
}

// Programmé après le rendu de la page cible : le contenu (donc sa hauteur) doit d'abord être en place
function restoreScrollFor(page) {
  const y = pageScrollMemory.get(pageScrollKey(page)) || 0;
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
}

// Adresse affichée pour une page (cosmétique : ce texte n'est jamais relu pour calculer un retour)
function pageHash(page) {
  const q = page.params && [...page.params].length ? '?' + page.params.toString() : '';
  switch (page.key) {
    case 'list': return '#minidiscs' + q;
    case 'md': return `#md-${page.mdIndex}`;
    case 'track': return `#md-${page.mdIndex}-album-${page.albumIndex}`;
    case 'create': return '#create';
    case 'planner': return '#planner';
    case 'discover-results': return '#discover' + q;
    case 'discover-disco': return '#discover';
    default: return '#dashboard';
  }
}

// Parent FIXE de chaque page : c'est ici, et ici seulement, qu'est décrite la hiérarchie de l'appli
function parentOfPage(page) {
  switch (page.key) {
    case 'list': return { key: 'dashboard' };
    case 'md': return { key: 'list' };
    case 'track': return { key: 'md', mdIndex: page.mdIndex };
    case 'planner': return { key: 'create' };
    case 'discover-results': return page.parent || { key: 'create' };
    case 'discover-disco': return page.direct ? (page.parent || { key: 'create' }) : { key: 'discover-results' };
    case 'create': return { key: 'dashboard' };
    default: return { key: 'dashboard' };
  }
}

// Affiche une page en centralisant tout ce qui ne doit être fait qu'à cet unique endroit :
// mémoriser le défilement de la page quittée, mettre à jour l'adresse affichée, rendre la nouvelle
// page, puis restaurer son défilement si on y revient (jamais lors d'une navigation vers l'avant).
function navigateTo(page, { isBack = false } = {}) {
  rememberScrollForCurrentPage();
  currentPage = page;
  ensureBackSentinel();
  history.replaceState({ sentinel: true }, '', pageHash(page));
  renderForPage(page);
  if (isBack) restoreScrollFor(page);
}

// Garantit qu'on se trouve bien sur l'entrée sentinelle avant de la mettre à jour (replaceState) :
// sans ce garde-fou, une navigation qui suit immédiatement un retour resté à la racine réécrirait
// l'entrée de tout premier chargement au lieu de la sentinelle, et le retour suivant fermerait l'appli.
function ensureBackSentinel() {
  if (!(history.state && history.state.sentinel)) {
    history.pushState({ sentinel: true }, '', location.href);
  }
}

// Un modal ouvert doit se fermer avant de naviguer, plutôt que de rester affiché au-dessus d'une
// autre page qui aurait changé en dessous de lui
function closeOpenModal() {
  const admin = document.getElementById('admin-modal');
  const idea = document.getElementById('idea-modal');
  if (admin && !admin.classList.contains('hidden')) { closeAdminModal(); return true; }
  if (idea && !idea.classList.contains('hidden')) { closeIdeaModal(); return true; }
  return false;
}

function goBack() {
  if (closeOpenModal()) return;
  if (currentPage.key === 'dashboard') return; // à la racine : comportement natif (quitter / mettre en arrière-plan)
  navigateTo(parentOfPage(currentPage), { isBack: true });
}

// Retour matériel (bouton du téléphone) ou navigateur : on ignore la page vers laquelle le navigateur
// vient nativement de basculer, et on lui superpose systématiquement le parent calculé selon notre
// propre hiérarchie - ainsi le résultat est identique, quel que soit le chemin réellement parcouru.
window.addEventListener('popstate', () => { goBack(); });

// Affiche la page demandée en appelant la fonction de rendu existante correspondante
function renderForPage(page) {
  switch (page.key) {
    case 'list': {
      const params = page.params || new URLSearchParams();
      const genre = params.get('genre');
      const type = params.get('type');
      const record = params.get('record');
      renderMDList({
        genre: genre !== null ? genre : currentGenreFilter,
        type: type !== null ? type : currentTypeFilter,
        record: record !== null ? record : currentRecordFilter,
      }, false);
      break;
    }
    case 'md': openMD(page.mdIndex, false); break;
    case 'track': openAlbum(page.mdIndex, page.albumIndex, false); break;
    case 'create': renderCreateHub(); break;
    case 'planner': renderCompilPlanner(false); break;
    case 'discover-results': renderDiscover(page.params || new URLSearchParams()); break;
    case 'discover-disco':
      // Le cadre de la page Découverte doit exister avant d'y afficher le chargement de la discographie
      renderDiscover(new URLSearchParams());
      discoverShowDiscography(page.artist, page.mbid || '', { direct: !!page.direct });
      break;
    default: renderDashboard(false);
  }
}

// Points d'entrée utilisés par les templates (onclick) : chacun exprime clairement son intention plutôt
// que de dépendre d'un état global implicite, pour que le résultat ne dépende jamais du chemin parcouru
function goToDashboard() { navigateTo({ key: 'dashboard' }); }
function goToCreateHub() { navigateTo({ key: 'create' }); }
function goToPlanner() { navigateTo({ key: 'planner' }); }
function goToMD(mdIndex) { navigateTo({ key: 'md', mdIndex }); }
function goToAlbum(mdIndex, albumIndex) { navigateTo({ key: 'track', mdIndex, albumIndex }); }

function goToAllMinidiscs() {
  currentGenreFilter = '';
  currentTypeFilter = '';
  currentRecordFilter = '';
  navigateTo({ key: 'list' });
}

function goToMinidiscsByGenre(genre) {
  currentTypeFilter = '';
  currentRecordFilter = '';
  navigateTo({ key: 'list', params: new URLSearchParams({ genre }) });
}

function goToMinidiscsToRecord() {
  currentGenreFilter = '';
  currentTypeFilter = '';
  navigateTo({ key: 'list', params: new URLSearchParams({ record: 'toRecord' }) });
}

function goToDiscoverResults(params) { navigateTo({ key: 'discover-results', params: params || new URLSearchParams(), parent: currentPage }); }
function goToArtistDiscography(artist, mbid) { navigateTo({ key: 'discover-disco', artist, mbid, direct: true, parent: currentPage }); }
function goToArtistDiscographyFromResults(artist, mbid) { navigateTo({ key: 'discover-disco', artist, mbid, direct: false }); }

// Lit l'adresse initiale (lien profond ou rechargement de la page) une fois les données chargées
function parsePageFromHash(hash) {
  hash = hash || '#dashboard';
  const [rawHash, query] = hash.split('?');
  const params = new URLSearchParams(query || '');
  const albumMatch = rawHash.match(/^#md-(\d+)-album-(\d+)$/);

  if (rawHash.startsWith('#create')) return { key: 'create' };
  if (rawHash.startsWith('#discover')) return { key: 'discover-results', params };
  if (albumMatch && catalogData && catalogData[+albumMatch[1]] && catalogData[+albumMatch[1]].albums && catalogData[+albumMatch[1]].albums[+albumMatch[2]]) {
    return { key: 'track', mdIndex: +albumMatch[1], albumIndex: +albumMatch[2] };
  }
  if (rawHash.startsWith('#planner')) return { key: 'planner' };
  if (rawHash.startsWith('#minidiscs')) return { key: 'list', params };
  if (rawHash.startsWith('#md-')) {
    const mdIndex = parseInt(rawHash.replace('#md-', ''), 10);
    if (!isNaN(mdIndex) && catalogData && catalogData[mdIndex]) return { key: 'md', mdIndex };
  }
  return { key: 'dashboard' };
}

// Premier affichage, une fois les données chargées (lien profond ou rechargement de la page)
function bootRoute() {
  navigateTo(parsePageFromHash(window.location.hash), { isBack: false });
}

// Redessine la page actuellement affichée sans naviguer (ex : arrivée tardive des données GitHub)
function refreshCurrentPage() {
  renderForPage(currentPage);
}

if (backBtn) {
  backBtn.addEventListener('click', goBack);
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
// Un MiniDisc est "à enregistrer" si lui-même ou l'un de ses albums l'est
function isMDToRecord(md) {
  return !!(md.toRecord || (md.albums && md.albums.some(a => a.toRecord)));
}

function renderFeatured() {
  if (!catalogData || catalogData.length === 0) return;
  const featuredGrid = document.getElementById('featured-grid');
  if (!featuredGrid) return;

  // Les MiniDiscs pas encore enregistrés ne sont pas écoutables : ils ne sont pas proposés
  const playable = catalogData.filter(md => !isMDToRecord(md));
  const shuffled = dailyShuffle(playable, '-featured');
  const selected = shuffled.slice(0, 3);

  let html = '';
  selected.forEach(md => {
    const originalIndex = catalogData.indexOf(md);
    const mdCover = md.md_cover || (md.albums && md.albums[0] ? md.albums[0].md_cover : '') || '';
    html += `
      <div class="featured-item" onclick="goToMD(${originalIndex})">
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
  const toRecordCount = sourceData.filter(isMDToRecord).length;

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
        <div class="genre-carousel-card" style="background-image: linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 50%), url('${imageUrl}');" onclick="goToMinidiscsByGenre('${safeGenreUpper}')">
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
        <div class="record-summary" onclick="goToMinidiscsToRecord()">${recordSummaryHTML}</div>
      </div>

      <div class="featured-container-inline">
        <div class="featured-header">
          <div class="featured-title">SÉLECTION DU JOUR</div>
        </div>
        <div class="featured-grid" id="featured-grid-inline"></div>
      </div>

      <button class="btn-primary btn-view-all" onclick="goToAllMinidiscs()">
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
        <button class="action-btn-wide action-btn-create" onclick="goToCreateHub()">
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
        <div class="list-item" style="border-color: ${borderColor}; --glow: ${borderColor}; border-left-width: 6px; position: relative;" onclick="goToMD(${originalIndex})">
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
    ? `<div class="badge-to-record-header">💽 À enregistrer</div>` 
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
    </div>
    ${fabHTML}
    ${titlesActionsHTML(index, null, true)}
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
    <div class="list-item" style="border-color: ${albumColor}; --glow: ${albumColor}; border-left-width: 6px; position: relative;" onclick="goToAlbum(${index}, ${aIndex})">
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
    ? `<div class="badge-to-record-header">💽 À enregistrer</div>` 
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
    ${titlesActionsHTML(mdIndex, albumIndex, false)}
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

    <div class="form-divider form-divider-sm"><span>Classement</span></div>
    <div class="form-group">
      <label>Genre</label>
      <select class="album-genre">${mainGenreOptionsHTML()}</select>
    </div>
    <div class="form-group"><input type="text" class="album-tags" placeholder="Tags (optionnel, ex: Acoustic, Punk Rock)"></div>
    <div class="form-row-2">
      <div class="form-group"><input type="text" class="album-year" placeholder="Année (ex: 1998)"></div>
      <div class="form-group"><input type="text" class="album-duration" placeholder="Durée (ex: 45:30)"></div>
    </div>

    <div class="form-divider form-divider-sm"><span>Pistes et pochette</span></div>
    <div class="form-group"><textarea class="album-tracks" placeholder="Pistes de cet album (une par ligne, sans numéro)"></textarea></div>
    <div class="form-group">
      <label>Pochette Album</label>
      <input type="file" class="album-cover" accept="image/*">
    </div>
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

        <button type="button" class="random-compil-btn" onclick="createRandomCompilation()">🎲 Création Aléatoire</button>
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

/* ==========================================
   CRÉATION ALÉATOIRE
   ------------------------------------------
   Propose une compilation d'idées d'un SEUL genre dont la durée remplit au maximum un MiniDisc (2h 28m).
   Chaque appui tire une nouvelle proposition : parmi les combinaisons qui remplissent presque au maximum
   (à RANDOM_COMPIL_TOLERANCE secondes du meilleur remplissage), une est choisie au hasard.
   ========================================== */
const PLANNER_MAX_SECONDS = 148 * 60;   // capacité d'un MiniDisc
const RANDOM_COMPIL_TOLERANCE = 120;    // secondes sous le meilleur remplissage encore acceptées
const RANDOM_COMPIL_MIN_FILL = 0.81;    // un genre n'est proposé que s'il peut remplir au moins 81 % d'un MiniDisc
let lastRandomCompil = { genre: '', key: '' };

function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Sommes de durées atteignables (sans dépasser la capacité), avec de quoi retrouver la combinaison
function plannerSubsetSums(pool, capacity) {
  const order = shuffleInPlace(pool.slice()); // l'ordre aléatoire varie les combinaisons trouvées
  const parent = new Int32Array(capacity + 1).fill(-2);
  parent[0] = -1;
  order.forEach((item, i) => {
    for (let sum = capacity; sum >= item.sec; sum--) {
      if (parent[sum] === -2 && parent[sum - item.sec] !== -2) parent[sum] = i;
    }
  });
  let best = 0;
  for (let sum = capacity; sum > 0; sum--) {
    if (parent[sum] !== -2) { best = sum; break; }
  }
  return { order, parent, best };
}

function createRandomCompilation() {
  const ideas = getIdeaList();
  const items = ideas
    .map((item, index) => ({ index, sec: parseTimeToSeconds(item.duration), genres: getItemGenresList(item) }))
    .filter(x => x.sec > 0 && x.sec <= PLANNER_MAX_SECONDS && x.genres.length > 0);

  if (items.length === 0) {
    showToast("⚠️ Aucune idée avec une durée renseignée");
    return;
  }

  // Idées regroupées par genre (une idée de plusieurs genres figure dans chacun)
  const byGenre = new Map();
  items.forEach(x => x.genres.forEach(g => {
    if (!byGenre.has(g)) byGenre.set(g, []);
    byGenre.get(g).push(x);
  }));

  // Genres capables de bien remplir un MiniDisc (au moins 81 % ; sinon les meilleurs disponibles)
  const scored = Array.from(byGenre.entries()).map(([genre, pool]) => ({ genre, pool, best: plannerSubsetSums(pool, PLANNER_MAX_SECONDS).best }));
  const overall = Math.max(...scored.map(g => g.best));
  const good = scored.filter(g => g.best >= RANDOM_COMPIL_MIN_FILL * PLANNER_MAX_SECONDS);
  let choices = good.length > 0 ? good : scored.filter(g => g.best >= 0.9 * overall);
  const others = choices.filter(g => g.genre !== lastRandomCompil.genre); // variété d'un appui à l'autre
  if (others.length > 0) choices = others;
  const picked = choices[Math.floor(Math.random() * choices.length)];

  // Combinaison au hasard parmi celles qui remplissent presque au maximum (différente de la précédente si possible)
  let chosen = [];
  let total = 0;
  let key = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    const { order, parent, best } = plannerSubsetSums(picked.pool, PLANNER_MAX_SECONDS);
    const targets = [];
    for (let sum = Math.max(1, best - RANDOM_COMPIL_TOLERANCE); sum <= best; sum++) {
      if (parent[sum] !== -2) targets.push(sum);
    }
    total = targets[Math.floor(Math.random() * targets.length)];
    chosen = [];
    for (let sum = total; sum > 0; sum -= order[parent[sum]].sec) chosen.push(order[parent[sum]]);
    key = chosen.map(x => x.index).sort((a, b) => a - b).join(',');
    if (key !== lastRandomCompil.key || attempt === 7) break;
  }

  lastRandomCompil = { genre: picked.genre, key };
  selectedIdeaIndices = new Set(chosen.map(x => x.index));
  currentPlannerGenreFilters.clear();
  currentPlannerGenreFilters.add(picked.genre); // on n'affiche que les idées du genre tiré
  renderCompilPlanner(false);
  showToast(`🎲 ${picked.genre} · ${formatSecondsToDisplay(total)} / 2h 28m · ${chosen.length} album${chosen.length > 1 ? 's' : ''}`, 4500);
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
  if (document.getElementById('discover-page')) {
    renderDiscoverResults(); // on reste sur la page Découverte
  } else if (typeof renderCompilPlanner === 'function') {
    renderCompilPlanner(false);
  }
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
    toRecord: true, // un MiniDisc créé depuis des idées reste à enregistrer
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
// Mots qui signalent une édition spéciale plutôt qu'un autre album
const MB_EDITION_BRACKET_REGEX = /[(\[][^)\]]*\b(?:deluxe|dlx|remaster(?:ed|s)?|anniversary|expanded|re-?issue|edition|version|bonus|special|limited|collector'?s?|legacy|super|explicit|clean|digital|mono|stereo|extended|international|japan(?:ese)?|import|platinum|reloaded|cd\s?\d|disc\s?\d|\d+(?:st|nd|rd|th)|xx)\b[^)\]]*[)\]]/gi;
const MB_EDITION_TRAIL_REGEX = /(?:\s*[-–—:]\s*|\s+)(?:\d+(?:st|nd|rd|th)|deluxe|special|expanded|limited|collector'?s?|legacy|anniversary|super|remaster(?:ed)?(?:\s+\d{4})?|re-?issue|edition|version|bonus|tracks?|explicit|digital|mono|stereo|dlx)\s*$/i;

// "Nevermind", "Nevermind (Remastered)", "Nevermind - 20th Anniversary Deluxe Edition" -> même clé
function mbBaseTitle(title) {
  let t = String(title || '').replace(MB_EDITION_BRACKET_REGEX, ' ');
  t = t.replace(/\s[-–:]\s.*(?:deluxe|remaster|anniversary|expanded|re-?issue|edition|bonus).*$/i, ' ');
  for (let i = 0; i < 6 && MB_EDITION_TRAIL_REGEX.test(t.trim()); i++) t = t.trim().replace(MB_EDITION_TRAIL_REGEX, '');
  return mbNormalize(t);
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
           onerror="this.onerror=null; if (this.parentElement) this.parentElement.innerHTML='<div style=\\'font-size:0.7rem; color:#888;\\'>Pas de pochette disponible sur Cover Art Archive</div>';" 
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
   DÉCOUVERTE : « Si tu as aimé X, tu aimeras Y »
   ------------------------------------------
   Les résultats sont des ARTISTES, tous issus de Last.fm :
   - avec un artiste de départ : ses artistes similaires (avec un pourcentage de similarité)
   - sans artiste de départ    : les artistes les plus écoutés du genre / tag choisi
   Chaque artiste est évalué (auditeurs, tags), puis toute la liste est classée d'un seul coup : la popularité est donc
   "absolue" et « Voir plus » ne fait que révéler la suite, sans jamais faire remonter un artiste dans la partie déjà lue.
   MusicBrainz n'intervient que pour dater les albums dans la discographie et, si une période est demandée,
   pour vérifier les années d'activité des artistes.
   ========================================== */
const LASTFM_API_KEY = '';   // (facultatif) clé en dur ici ; sinon elle se saisit dans la page et reste sur l'appareil
const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';
const LASTFM_KEY_STORAGE = 'lastfm_api_key';
const LASTFM_MIN_DELAY_MS = 230;          // Last.fm tolère environ 5 requêtes par seconde
const LASTFM_PLACEHOLDER_HASH = '2a96cbd8b46e442fc41c2b86b821562f'; // image "vide" de Last.fm

const DISCOVER_POOL_SIZE = 40;            // artistes candidats évalués par recherche
const DISCOVER_PAGE_SIZE = 10;            // artistes révélés à chaque « Voir plus »
const DISCOVER_INFO_CONCURRENCY = 4;
// Qualité minimale pour figurer dans la liste principale : les artistes en dessous ne sont proposés que
// s'il n'y a pas assez de résultats (ou sur demande, en fin de liste)
const DISCOVER_MIN_MATCH = 0.35;          // similarité minimale (35 %)
const DISCOVER_MIN_LISTENERS = 500000;    // auditeurs Last.fm minimum
// Classement "Recommandés" : poids de la popularité et de la similarité (mesurées en rang, de 0 à 1)
const DISCOVER_WEIGHT_POP = 0.6;
const DISCOVER_WEIGHT_SIM = 0.4;
const DISCOVER_MB_EXCLUDED = 'secondarytype:Remix OR secondarytype:"DJ-mix" OR secondarytype:Demo OR secondarytype:Audiobook OR secondarytype:"Audio drama" OR secondarytype:Interview';

// Tags Last.fm correspondant à chacun des 8 genres de l'appli
const DISCOVER_GENRE_TAGS = {
  'Alternative & Grunge 90s': ['grunge', 'alternative rock', 'alternative'],
  'Rock & Blues': ['rock', 'blues', 'blues rock', 'punk rock'],
  'Rap, Soul & Reggae': ['hip-hop', 'rap', 'soul', 'reggae', 'funk'],
  'Metal & Hard Rock': ['metal', 'hard rock', 'heavy metal'],
  'Pop & Folk & Variety': ['pop', 'folk', 'singer-songwriter', 'chanson'],
  'Talks & Humour': ['comedy', 'spoken word'],
  'Électro, Trip-Hop & Expérimental': ['electronic', 'trip-hop', 'electronica', 'experimental'],
  'Ambient & Orchestral': ['ambient', 'soundtrack', 'classical', 'orchestral'],
};

const VARIOUS_ARTISTS_REGEX = /^(divers|various|various artists|artistes? divers|va|compilation)$/i;

const DISCOVER_DEFAULTS = { artist: '', genre: '', tag: '', yearFrom: '', yearTo: '', sort: 'recommended', hideOwned: true };

const discoverState = {
  criteria: { ...DISCOVER_DEFAULTS },
  chips: [],            // autres artistes du MiniDisc d'origine (raccourcis)
  candidates: [],       // tous les artistes évalués par la dernière recherche
  shown: 0,             // nombre d'artistes actuellement révélés dans la liste classée
  extraShown: false,    // les artistes moins proches / moins connus ont été demandés
  mode: null,           // 'similar' | 'tag'
  started: false,
  running: false,
  runId: 0,
  status: '',
  lifespanNote: '',
  showKeyCard: false,
  pendingAuto: false,
  pendingDisco: '',     // artiste dont la discographie s'ouvrira dès que la clé Last.fm sera enregistrée
  startArtist: '',
  formOpen: true,       // le formulaire se replie une fois la recherche lancée
  view: 'results',      // 'results' | 'disco' (discographie complète d'un artiste)
  disco: null,          // { artist, mbid, items, showOthers, loading, status }
};
const discoverCache = new Map();

/* ---------- Utilitaires ---------- */
const asArray = v => (v == null ? [] : (Array.isArray(v) ? v : [v]));
const discoverWait = ms => new Promise(resolve => setTimeout(resolve, ms));

function fmtCount(n) {
  try {
    return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch (err) {
    return String(n);
  }
}

function matchMainGenre(value) {
  const v = String(value || '').trim().toLowerCase();
  return MAIN_GENRES.find(g => g.toLowerCase() === v) || '';
}

function isRealArtist(name) {
  const n = String(name || '').trim();
  return !!n && !VARIOUS_ARTISTS_REGEX.test(n);
}

function getLastfmKey() {
  return (localStorage.getItem(LASTFM_KEY_STORAGE) || LASTFM_API_KEY || '').trim();
}

/* Appels Last.fm : file d'attente (jamais plus de ~4 requêtes par seconde) */
let lfmChain = Promise.resolve();
function lfmSlot() {
  const slot = lfmChain.then(() => discoverWait(LASTFM_MIN_DELAY_MS));
  lfmChain = slot;
  return slot;
}

async function lastfmCall(method, params = {}) {
  const key = getLastfmKey();
  if (!key) {
    const err = new Error('Clé Last.fm manquante');
    err.code = 'nokey';
    throw err;
  }

  const query = new URLSearchParams({ method, api_key: key, format: 'json', autocorrect: '1', ...params });
  const url = `${LASTFM_API_URL}?${query}`;
  if (discoverCache.has(url)) return discoverCache.get(url);

  await lfmSlot();
  const response = await fetch(url);
  let data = null;
  try { data = await response.json(); } catch (err) { /* réponse non JSON */ }

  if (data && data.error) {
    const err = new Error(data.message || 'Erreur Last.fm');
    err.code = data.error;
    throw err;
  }
  if (!response.ok || !data) throw new Error(`Last.fm : HTTP ${response.status}`);

  discoverCache.set(url, data);
  return data;
}

// Échec réseau (hors ligne, requête bloquée...) : les erreurs de code, elles, restent visibles telles quelles
function isNetworkError(err) {
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message || '');
}

// Erreurs qui doivent interrompre la recherche (clé invalide, quota, réseau...)
function isFatalDiscoverError(err) {
  return isNetworkError(err) || err.rateLimited === true || err.code === 'nokey' || [4, 9, 10, 13, 16, 26, 29].includes(err.code);
}

function lfmImage(images) {
  const list = asArray(images);
  for (const size of ['extralarge', 'large', 'medium']) {
    const img = list.find(i => i.size === size);
    const url = img && img['#text'];
    if (url && !url.includes(LASTFM_PLACEHOLDER_HASH)) return url;
  }
  return '';
}

async function discoverMbArtistGroups(artist, maxPages = 1) {
  const cacheKey = `mb:${artist.mbid || mbNormalize(artist.name)}:${maxPages}`;
  if (discoverCache.has(cacheKey)) return discoverCache.get(cacheKey);

  // Mêmes exclusions que la recherche : albums et EP, sans remix, DJ-mix, démos, livres audio, interviews
  const who = artist.mbid ? `arid:${artist.mbid}` : `artist:"${String(artist.name).replace(/["\\]/g, ' ')}"`;
  const query = `${who} AND (primarytype:Album OR primarytype:EP) AND NOT (${DISCOVER_MB_EXCLUDED})`;

  let result;
  try {
    let groups = [];
    for (let page = 0; page < maxPages; page++) {
      const url = `${MB_API}/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=100&offset=${page * 100}`;
      const data = await mbFetchJson(url);
      groups = groups.concat(data['release-groups'] || []);
      if (groups.length >= (data.count || 0)) break;
    }
    if (!artist.mbid) {
      // Recherche par nom : on écarte les homonymes approximatifs
      const wanted = mbNormalize(artist.name);
      groups = groups.filter(g => mbNormalize(mbArtistName(g)).includes(wanted));
    }
    result = { ok: true, groups };
  } catch (err) {
    result = { ok: false, groups: [] };
  }
  if (result.ok) discoverCache.set(cacheKey, result);
  return result;
}

// Une entrée par album : l'édition d'origine (sans mention de réédition, la plus ancienne)
function discoverIndexGroups(groups) {
  const index = new Map();
  groups.forEach(g => {
    const key = mbBaseTitle(g.title);
    const reissue = MB_REISSUE_REGEX.test(g.title || '') ? 1 : 0;
    const date = g['first-release-date'] || '9999';
    const current = index.get(key);
    if (!current || reissue < current.reissue || (reissue === current.reissue && date < current.date)) {
      index.set(key, { g, reissue, date });
    }
  });
  return index;
}

function discoverArtistMbid(group) {
  const credit = group && group['artist-credit'] && group['artist-credit'][0];
  return (credit && credit.artist && credit.artist.id) || '';
}

function discoverYearOf(group) {
  const date = group && group['first-release-date'];
  return date ? (parseInt(date.slice(0, 4), 10) || null) : null;
}

function discoverGroupTags(group) {
  return asArray(group && group.tags)
    .slice()
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 5)
    .map(t => t.name);
}

function discoverRequiredTags(criteria) {
  if (criteria.tag && criteria.tag.trim()) return [criteria.tag.trim().toLowerCase()];
  if (criteria.genre && DISCOVER_GENRE_TAGS[criteria.genre]) return DISCOVER_GENRE_TAGS[criteria.genre];
  return [];
}

function discoverTagsMatch(tags, required) {
  if (required.length === 0) return true;
  return tags.some(t => required.some(r => t === r || t.includes(r)));
}

function discoverGuessGenre(tags) {
  for (const tag of tags) {
    const guessed = guessMainGenreFromItunes(tag);
    if (guessed) return guessed;
  }
  return '';
}

function discoverCoverError(img) {
  const fallback = img.dataset.fallback;
  if (fallback && !img.dataset.tried) {
    img.dataset.tried = '1';
    img.src = fallback;
    return;
  }
  img.style.display = 'none';
}

async function discoverAddToIdeas(listName, idx) {
  const list = listName === 'd' ? (discoverState.disco ? discoverState.disco.items : []) : discoverState.results;
  const r = list[idx];
  if (!r) return;

  openIdeaModal();
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };

  set('idea-title', r.title);
  set('idea-artist', r.artist);
  set('idea-year', r.year || '');
  set('idea-tags', (r.tags || []).slice(0, 5).join(', '));
  const genre = r.mainGenre || discoverState.criteria.genre;
  if (genre) set('idea-genre', genre);

  // Pochette : Cover Art Archive si on connaît l'album MusicBrainz, sinon l'image Last.fm
  pendingItunesCoverUrl = r.mbid ? `https://coverartarchive.org/release-group/${r.mbid}/front-500` : (r.image || null);
  const preview = document.getElementById('idea-cover-preview');
  if (preview && pendingItunesCoverUrl) {
    preview.innerHTML = `<img src="${mbEscapeHTML(pendingItunesCoverUrl)}" style="width:80px; height:80px; border-radius:6px; object-fit:cover;"
      onerror="this.onerror=null; if (this.parentElement) this.parentElement.innerHTML='<div style=\\'font-size:0.7rem; color:var(--text-sub);\\'>Pochette indisponible</div>';">`;
  }

  // Pistes et durée : depuis MusicBrainz (on retrouve l'album si besoin)
  showToast("⏳ Récupération des pistes et de la durée...");
  let group = r.mbGroup || null;
  try {
    if (!group) {
      const tokens = mbQueryTokens(`${r.artist} ${r.title}`);
      const raw = await mbSearchReleaseGroups(tokens, 'and');
      group = mbFilterAndRank(raw, tokens, 1)[0] || null;
    }
  } catch (err) {
    console.warn(err);
  }

  if (group) {
    window.__itunesResults = [group];
    await applyItunesResult(0);
    if (genre && !document.getElementById('idea-genre').value) set('idea-genre', genre);
  } else {
    showToast("⚠️ Album introuvable sur MusicBrainz : complète la durée et les pistes à la main.");
  }
}

function prepareSubPage(title) {
  const fa = document.getElementById('floating-actions') || document.querySelector('.floating-actions-bar');
  if (fa) fa.style.display = 'none';
  if (typeof clearPlannerHeaderInfo === 'function') clearPlannerHeaderInfo();

  currentMD = null;
  currentAlbum = null;
  if (backBtn) backBtn.classList.remove('hidden');
  if (headerTitle) headerTitle.textContent = title;
  setHeaderGenreInfo([]);
  updateSearchVisibility(false);
  if (featuredContainer) featuredContainer.classList.add('hidden');
  window.scrollTo(0, 0);
}

function renderCreateHub() {
  prepareSubPage('CRÉER');
  app.innerHTML = `
    <div id="create-page" class="create-page">
      <button type="button" class="create-tile create-tile-find" onclick="goToDiscoverResults()">
        <span class="create-tile-text">
          <span class="create-tile-title">Trouver de nouvelles idées</span>
          <span class="create-tile-desc">Artistes et albums similaires, par genre, période ou popularité.</span>
        </span>
      </button>
      <button type="button" class="create-tile create-tile-new" onclick="goToPlanner()">
        <span class="create-tile-text">
          <span class="create-tile-title">Créer un nouveau minidisc</span>
          <span class="create-tile-desc">Composer un MiniDisc à partir de tes idées d'albums.</span>
        </span>
      </button>
    </div>
  `;
}

function saveLastfmKeyFromInput() {
  const input = document.getElementById('dc-key-input');
  const key = input ? input.value.trim() : '';
  if (!/^[0-9a-fA-F]{32}$/.test(key)) {
    showToast("⚠️ Une clé Last.fm compte 32 caractères (chiffres et lettres a-f)");
    return;
  }
  localStorage.setItem(LASTFM_KEY_STORAGE, key);
  discoverCache.clear();
  const s = discoverState;
  s.showKeyCard = false;
  s.status = '';
  showToast("🔑 Clé Last.fm enregistrée");
  refreshDiscoverPage();
  if (s.pendingAuto) startDiscoverSearch();
  else if (s.pendingDisco) {
    const artist = s.pendingDisco;
    s.pendingDisco = '';
    discoverShowDiscography(artist, '', { direct: true });
  }
}

function discoverChangeKey() {
  discoverState.showKeyCard = true;
  refreshDiscoverPage();
  document.getElementById('dc-key-input')?.focus();
}

function openSimilarSearch(mdIndex, albumIndex) {
  const md = catalogData && catalogData[mdIndex];
  if (!md) return;

  const hasAlbum = albumIndex !== null && albumIndex !== undefined && md.albums && md.albums[albumIndex];
  const albums = hasAlbum ? [md.albums[albumIndex]] : (md.albums && md.albums.length ? md.albums : [md]);
  const artists = Array.from(new Set(albums.map(a => (a.artist || '').trim()).filter(isRealArtist)));
  const ref = albums[0];

  const params = new URLSearchParams();
  if (artists[0]) params.set('artist', artists[0]);
  if (artists.length > 1) params.set('artists', artists.join('|'));
  const genre = ref.main_genre || md.main_genre || '';
  if (genre) params.set('genre', genre);
  const year = parseInt(ref.release_year, 10);
  if (year) params.set('year', String(year));
  params.set('auto', '1');

  goToDiscoverResults(params);
}

// Artiste concerné par une page Titres (album d'une série, ou MiniDisc compilation) : vide si c'est "Divers"
function titlesArtist(mdIndex, albumIndex) {
  const md = catalogData && catalogData[mdIndex];
  if (!md) return '';
  const hasAlbum = albumIndex !== null && albumIndex !== undefined && md.albums && md.albums[albumIndex];
  const artist = String((hasAlbum ? md.albums[albumIndex].artist : md.artist) || '').trim();
  return isRealArtist(artist) ? artist : '';
}

// Discographie de l'artiste concerné, ouverte directement
function openArtistDiscography(mdIndex, albumIndex) {
  const artist = titlesArtist(mdIndex, albumIndex);
  if (!artist) return;
  goToArtistDiscography(artist, '');
}

// Boutons en bas des pages Titres : « Discographie » à gauche de « Trouver des artistes similaires »
// (hasFab : la page a déjà un bouton flottant en bas à droite, les boutons se placent à sa gauche)
function titlesActionsHTML(mdIndex, albumIndex, hasFab) {
  const albumArg = albumIndex === null || albumIndex === undefined ? 'null' : albumIndex;
  requestAnimationFrame(() => requestAnimationFrame(fitTitlesActions)); // une fois la page affichée
  const disco = titlesArtist(mdIndex, albumIndex)
    ? `<button type="button" class="titles-disco-btn" onclick="openArtistDiscography(${mdIndex}, ${albumArg})">📀 Discographie</button>`
    : '';
  return `<div class="titles-actions ${hasFab ? 'has-fab' : ''}">${disco}<button type="button" class="similar-fab" onclick="openSimilarSearch(${mdIndex}, ${albumArg})">🔎 Artistes similaires</button></div>`;
}

// Les boutons sont centrés en bas ; s'ils touchent le bouton flottant de droite (compilation), ils passent au-dessus
function fitTitlesActions() {
  const box = document.querySelector('.titles-actions');
  if (!box) return;
  box.classList.remove('above-fab');
  const fab = document.querySelector('#md-detail-floating-actions .fab-main-btn');
  if (!fab) return;
  const b = box.getBoundingClientRect();
  const f = fab.getBoundingClientRect();
  if (b.right > f.left - 6 && b.bottom > f.top - 6) box.classList.add('above-fab');
}
window.addEventListener('resize', fitTitlesActions);

/* ---------- Ce que je possède déjà ---------- */
function discoverOwnedArtists() {
  const owned = new Set();
  const add = name => {
    if (isRealArtist(name)) owned.add(mbNormalize(name));
  };
  (catalogData || []).forEach(md => {
    add(md.artist);
    (md.albums || []).forEach(a => add(a.artist));
  });
  (window.ideaAlbums || []).forEach(i => add(i.artist));
  return owned;
}

function discoverOwnedAlbumKeys() {
  const owned = new Set();
  const ideas = new Set();
  const add = (set, artist, title) => {
    if (artist && title) set.add(`${mbNormalize(artist)}|${mbBaseTitle(title)}`);
  };
  (catalogData || []).forEach(md => {
    add(owned, md.artist, md.title);
    (md.albums || []).forEach(a => add(owned, a.artist, a.title));
  });
  (window.ideaAlbums || []).forEach(i => add(ideas, i.artist, i.title));
  return { owned, ideas };
}

function discoverArtistNames() {
  const names = new Set();
  (catalogData || []).forEach(md => {
    if (isRealArtist(md.artist)) names.add(md.artist.trim());
    (md.albums || []).forEach(a => { if (isRealArtist(a.artist)) names.add(a.artist.trim()); });
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/* ---------- Suggestions d'artistes (liste maison, placée SOUS le champ) ---------- */
function discoverSuggest() {
  const input = document.getElementById('dc-artist');
  const box = document.getElementById('dc-suggest');
  if (!input || !box) return;

  const query = mbNormalize(input.value);
  const names = discoverArtistNames()
    .filter(n => mbNormalize(n) !== query && (!query || mbNormalize(n).includes(query)))
    .slice(0, 6);

  if (names.length === 0) {
    box.classList.add('hidden');
    return;
  }
  box.innerHTML = names.map(n =>
    `<button type="button" class="dc-suggest-item" data-name="${mbEscapeHTML(n)}" onpointerdown="event.preventDefault(); discoverPickSuggestion(this.dataset.name)">${mbEscapeHTML(n)}</button>`
  ).join('');
  box.classList.remove('hidden');
}

function discoverHideSuggestSoon() {
  setTimeout(() => {
    const box = document.getElementById('dc-suggest');
    if (box) box.classList.add('hidden');
  }, 150);
}

function discoverPickSuggestion(name) {
  const input = document.getElementById('dc-artist');
  const box = document.getElementById('dc-suggest');
  if (input) input.value = name;
  if (box) box.classList.add('hidden');
}

/* ---------- Lancement d'une recherche ---------- */
function discoverAlive(runId) {
  return runId === discoverState.runId && !!document.getElementById('discover-page');
}

function readDiscoverCriteria() {
  const val = id => {
    const el = document.getElementById(id);
    return el ? el.value : '';
  };
  const c = discoverState.criteria;
  c.artist = val('dc-artist').trim();
  c.genre = val('dc-genre');
  c.tag = val('dc-tag').trim();
  c.yearFrom = val('dc-year-from').trim();
  c.yearTo = val('dc-year-to').trim();
  readDiscoverViewOptions();
}

function readDiscoverViewOptions() {
  const c = discoverState.criteria;
  const sort = document.getElementById('dc-sort');
  const hide = document.getElementById('dc-hide-owned');
  if (sort) c.sort = sort.value;
  if (hide) c.hideOwned = hide.checked;
}

function discoverResetResults() {
  const s = discoverState;
  s.candidates = [];
  s.shown = 0;
  s.extraShown = false;
  s.lifespanNote = '';
  s.status = '';
  s.view = 'results';
  s.disco = null;
}

async function startDiscoverSearch() {
  const s = discoverState;
  readDiscoverCriteria();
  const c = s.criteria;

  if (!getLastfmKey()) {
    s.showKeyCard = true;
    s.formOpen = true;
    s.status = '<span class="dc-warn">🔑 Ajoute d\'abord ta clé API Last.fm ci-dessus.</span>';
    s.pendingAuto = true;
    refreshDiscoverPage();
    return;
  }
  if (!c.artist && !c.genre && !c.tag.trim()) {
    showToast("⚠️ Indique un artiste, un genre ou un tag");
    return;
  }

  s.runId++;
  const runId = s.runId;
  discoverStopPreview();
  discoverResetResults();
  s.started = true;
  s.running = true;
  s.pendingAuto = false;
  s.formOpen = false; // le formulaire se replie : il ne reste que le bandeau « Nouvelle recherche »
  s.mode = c.artist ? 'similar' : 'tag';
  refreshDiscoverPage();
  window.scrollTo({ top: 0 });

  try {
    const pool = s.mode === 'similar' ? await discoverPoolSimilar() : await discoverPoolTag();
    if (!discoverAlive(runId)) return;
    if (pool.length > 0) {
      await discoverEvaluatePool(pool, runId);
      if (!discoverAlive(runId)) return;
      await discoverApplyLifespan(runId);
      if (!discoverAlive(runId)) return;
      await discoverRevealMore(runId); // 1re page : les couvertures sont chargées avant l'affichage
    }
  } catch (err) {
    if (runId === s.runId) discoverHandleError(err);
  } finally {
    if (runId === s.runId) {
      s.running = false;
      discoverFinishStatus(s.candidates.length === 0);
      renderDiscoverResults();
    }
  }
}

// « Voir plus » : révèle la page suivante de la liste (déjà classée en entier au moment de la recherche)
async function discoverLoadMore() {
  const s = discoverState;
  if (s.running) return;
  s.running = true;
  const runId = s.runId;
  renderDiscoverResults();
  try {
    await discoverRevealMore(runId);
  } catch (err) {
    if (runId === s.runId) discoverHandleError(err);
  } finally {
    if (runId === s.runId) {
      s.running = false;
      renderDiscoverResults();
    }
  }
}

function discoverHandleError(err) {
  const s = discoverState;
  console.error(err);
  let message;
  if (err.code === 'nokey' || err.code === 10 || err.code === 26) {
    s.showKeyCard = true;
    s.formOpen = true;
    message = '🔑 Clé API Last.fm absente, invalide ou refusée. Vérifie-la ci-dessus.';
  } else if (err.code === 29 || err.rateLimited) {
    message = '⏳ Le service limite le nombre de requêtes : réessaie dans une minute.';
  } else if (err.code === 6) {
    s.formOpen = true;
    message = `Artiste « ${mbEscapeHTML(s.criteria.artist)} » introuvable sur Last.fm : vérifie l'orthographe.`;
  } else if (isNetworkError(err)) {
    message = '📡 Impossible de joindre Last.fm (connexion coupée ou requête bloquée par le navigateur).';
  } else {
    message = `⚠️ Une erreur est survenue (${mbEscapeHTML(err.message || 'inconnue')}).`;
  }
  s.status = `<span class="dc-warn">${message}</span>`;
  refreshDiscoverPage();
}

// Message de fin de recherche
function discoverFinishStatus(noCandidates) {
  const s = discoverState;
  if (s.status && s.status.includes('dc-warn')) return;
  if (noCandidates) {
    const c = s.criteria;
    const relaxable = c.genre || c.tag || c.yearFrom || c.yearTo;
    s.status = `<span class="dc-warn">Aucun résultat avec ces critères.</span>` +
      (relaxable ? ` <button type="button" class="dc-link-btn" onclick="discoverRelax()">Relancer sans genre ni période</button>` : '');
    s.formOpen = true;
    refreshDiscoverPage();
  } else {
    s.status = '';
  }
}

function discoverRelax() {
  const c = discoverState.criteria;
  c.genre = '';
  c.tag = '';
  c.yearFrom = '';
  c.yearTo = '';
  if (!c.artist) {
    showToast("⚠️ Indique un artiste pour élargir la recherche");
    refreshDiscoverPage();
    return;
  }
  refreshDiscoverPage();
  startDiscoverSearch();
}

/* ---------- Étape 1 : la liste d'artistes candidats (Last.fm uniquement) ---------- */
async function discoverPoolSimilar() {
  const s = discoverState;
  const data = await lastfmCall('artist.getSimilar', { artist: s.criteria.artist, limit: DISCOVER_POOL_SIZE + 5 });
  const block = data.similarartists || {};
  s.startArtist = (block['@attr'] && block['@attr'].artist) || s.criteria.artist;
  const startNorm = mbNormalize(s.startArtist);

  return asArray(block.artist)
    .filter(a => mbNormalize(a.name) !== startNorm)
    .slice(0, DISCOVER_POOL_SIZE)
    .map(a => ({ name: a.name, mbid: a.mbid || '', match: parseFloat(a.match) || 0, url: a.url || '' }));
}

// Sans artiste de départ : les artistes les plus écoutés du ou des tags (genre), en alternant les tags
async function discoverPoolTag() {
  const tags = discoverRequiredTags(discoverState.criteria).slice(0, 3);
  const lists = [];
  for (const tag of tags) {
    const data = await lastfmCall('tag.getTopArtists', { tag, limit: DISCOVER_POOL_SIZE });
    lists.push(asArray(data.topartists && data.topartists.artist));
  }

  const seen = new Set();
  const pool = [];
  for (let i = 0; i < DISCOVER_POOL_SIZE && pool.length < DISCOVER_POOL_SIZE; i++) {
    lists.forEach(list => {
      const a = list[i];
      if (!a || pool.length >= DISCOVER_POOL_SIZE) return;
      const key = mbNormalize(a.name);
      if (seen.has(key)) return;
      seen.add(key);
      pool.push({ name: a.name, mbid: a.mbid || '', match: null, url: a.url || '' });
    });
  }
  return pool;
}

/* ---------- Étape 2 : popularité et tags de chaque candidat (Last.fm) ---------- */
async function discoverEvaluatePool(pool, runId) {
  const s = discoverState;
  const required = s.mode === 'similar' ? discoverRequiredTags(s.criteria) : [];

  for (let i = 0; i < pool.length; i += DISCOVER_INFO_CONCURRENCY) {
    if (!discoverAlive(runId)) return;
    const chunk = pool.slice(i, i + DISCOVER_INFO_CONCURRENCY);

    const infos = await Promise.all(chunk.map(a =>
      lastfmCall('artist.getInfo', { artist: a.name }).catch(err => {
        if (isFatalDiscoverError(err)) throw err;
        return null;
      })
    ));
    if (!discoverAlive(runId)) return;

    chunk.forEach((a, k) => {
      const info = infos[k] && infos[k].artist;
      if (!info) return;
      const tags = asArray(info.tags && info.tags.tag).map(t => String(t.name).toLowerCase());
      if (!discoverTagsMatch(tags, required)) return; // genre / tag demandé

      const stats = info.stats || {};
      s.candidates.push({
        idx: s.candidates.length,
        key: mbNormalize(info.name || a.name),
        artist: info.name || a.name,
        mbid: info.mbid || a.mbid,
        match: a.match,
        listeners: parseInt(stats.listeners, 10) || 0,
        playcount: parseInt(stats.playcount, 10) || 0,
        tags,
        mainGenre: discoverGuessGenre(tags) || s.criteria.genre || '',
        lastfmUrl: info.url || a.url || '',
        topAlbum: null,
        topLoaded: false,
      });
    });
  }
}

/* ---------- Étape 3 (si une période est demandée) : années d'activité, en une seule requête MusicBrainz ---------- */
async function discoverApplyLifespan(runId) {
  const s = discoverState;
  const c = s.criteria;
  const from = parseInt(c.yearFrom, 10);
  const to = parseInt(c.yearTo, 10);
  s.lifespanNote = '';
  if (!from && !to) return;

  const withId = s.candidates.filter(a => a.mbid);
  if (withId.length === 0) return;

  const spans = new Map();
  try {
    const query = `arid:(${withId.map(a => a.mbid).join(' OR ')})`;
    const data = await mbFetchJson(`${MB_API}/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=100`);
    asArray(data.artists).forEach(x => spans.set(x.id, x['life-span'] || {}));
  } catch (err) {
    s.lifespanNote = "Période non vérifiée (MusicBrainz n'a pas répondu).";
    return;
  }
  if (!discoverAlive(runId)) return;

  // On garde les artistes dont la période d'activité recoupe [from, to] (et ceux dont les dates sont inconnues)
  const nowYear = new Date().getFullYear();
  s.candidates = s.candidates.filter(a => {
    const span = spans.get(a.mbid);
    if (!span) return true;
    const begin = parseInt(String(span.begin || '').slice(0, 4), 10);
    if (!begin) return true;
    const end = span.ended ? (parseInt(String(span.end || '').slice(0, 4), 10) || nowYear) : nowYear;
    return (!to || begin <= to) && (!from || end >= from);
  });
  s.candidates.forEach((a, i) => { a.idx = i; });
}

/* ---------- Classement GLOBAL : calculé une fois sur tous les candidats, la pagination ne fait que révéler la suite ---------- */
function discoverPercentile(values) {
  const n = values.length;
  return v => {
    if (n <= 1) return 1;
    const below = values.filter(x => x < v).length;
    const equal = values.filter(x => x === v).length;
    return (below + (equal - 1) / 2) / (n - 1);
  };
}

function discoverComputeOrder() {
  const s = discoverState;
  const c = s.criteria;
  const owned = c.hideOwned ? discoverOwnedArtists() : new Set();
  const all = s.candidates.filter(a => !owned.has(a.key));
  const hiddenOwned = s.candidates.length - all.length;

  // Popularité et similarité mesurées en rang (0 à 1) pour peser autant l'une que l'autre, sans qu'une échelle écrase l'autre
  const popRank = discoverPercentile(all.map(a => a.listeners));
  const simRank = discoverPercentile(all.filter(a => a.match != null).map(a => a.match));
  all.forEach(a => {
    a.lowTier = false;
    a.score = a.match == null
      ? popRank(a.listeners)
      : DISCOVER_WEIGHT_POP * popRank(a.listeners) + DISCOVER_WEIGHT_SIM * simRank(a.match);
    a.qualified = (a.match == null || a.match >= DISCOVER_MIN_MATCH) && a.listeners >= DISCOVER_MIN_LISTENERS;
  });

  const compare = c.sort === 'popularity'
    ? (a, b) => b.listeners - a.listeners
    : c.sort === 'similarity'
      ? (a, b) => ((b.match || 0) - (a.match || 0)) || (b.listeners - a.listeners)
      : (a, b) => (b.score - a.score) || (b.listeners - a.listeners);

  let main = all.filter(a => a.qualified).sort(compare);
  const extra = all.filter(a => !a.qualified).sort(compare);

  // Pas assez de résultats "de qualité" : on complète avec les meilleurs des autres, et seulement ce qu'il faut
  const missing = DISCOVER_PAGE_SIZE - main.length;
  if (missing > 0 && extra.length > 0) {
    const filler = extra.splice(0, missing);
    filler.forEach(a => { a.lowTier = true; });
    main = main.concat(filler);
  }
  if (s.extraShown) extra.forEach(a => { a.lowTier = true; });

  return { list: s.extraShown ? main.concat(extra) : main, main, extra, hiddenOwned };
}

// Couverture = pochette de l'album le plus écouté de l'artiste (Last.fm)
async function discoverFillTopAlbums(items) {
  const todo = items.filter(a => !a.topLoaded);
  await Promise.all(todo.map(async a => {
    try {
      const data = await lastfmCall('artist.getTopAlbums', { artist: a.artist, limit: 4 });
      const albums = asArray(data.topalbums && data.topalbums.album)
        .filter(x => x.name && x.name !== '(null)' && !MB_PARASITE_REGEX.test(x.name));
      const best = albums.find(x => lfmImage(x.image)) || albums[0];
      if (best) a.topAlbum = { title: best.name, image: lfmImage(best.image) };
    } catch (err) {
      if (isFatalDiscoverError(err)) throw err;
    }
    a.topLoaded = true;
  }));
}

// Révèle la page suivante (ou, quand tout est affiché, les artistes moins proches / moins connus)
async function discoverRevealMore(runId) {
  const s = discoverState;
  let order = discoverComputeOrder();
  if (s.shown >= order.list.length && !s.extraShown && order.extra.length > 0) {
    s.extraShown = true;
    order = discoverComputeOrder();
  }
  const nextCount = Math.min(order.list.length, s.shown + DISCOVER_PAGE_SIZE);
  await discoverFillTopAlbums(order.list.slice(s.shown, nextCount));
  if (!discoverAlive(runId)) return;
  s.shown = nextCount;
}

/* ---------- Affichage ---------- */
function discoverCoverHTML(image, placeholder = '🎤', extra = '') {
  const img = image
    ? `<img src="${mbEscapeHTML(image)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : '';
  return `<div class="dc-cover"><span class="dc-cover-ph">${placeholder}</span>${img}${extra}</div>`;
}

function discoverLastfmLink(url) {
  return url ? `<a class="dc-lastfm" href="${mbEscapeHTML(url)}" target="_blank" rel="noopener">Last.fm ↗</a>` : '';
}

function discoverArtistHTML(a) {
  const color = getSingleGenreColor(a.mainGenre ? a.mainGenre.toUpperCase() : 'AUTRE');
  const genreLabel = a.mainGenre ? `<div class="dc-genre" style="color:${color}">${mbEscapeHTML(a.mainGenre)}</div>` : '';

  const facts = [];
  if (a.listeners > 0) facts.push(`👥 ${fmtCount(a.listeners)} auditeurs`);
  if (a.match != null) facts.push(`≈ ${Math.round(a.match * 100)} % similaire`);

  return `
    <div class="list-item dc-item" style="border-color:${color}; --glow:${color}; border-left-width:6px;">
      ${discoverLastfmLink(a.lastfmUrl)}
      ${discoverPlayButton('artist', a.artist, '', 'dc-play-side')}
      ${discoverCoverHTML(a.topAlbum && a.topAlbum.image, '🎤')}
      <div class="dc-info">
        ${genreLabel}
        <div class="dc-title">${mbEscapeHTML(a.artist)}</div>
        ${facts.length ? `<div class="dc-facts">${facts.join('<br>')}</div>` : ''}
        ${discoverNowPlaying(discoverPreviewKey('artist', a.artist, ''))}
        <div class="dc-actions">
          <button type="button" class="dc-disco-link" data-artist="${mbEscapeHTML(a.artist)}" data-mbid="${mbEscapeHTML(a.mbid || '')}" onclick="goToArtistDiscographyFromResults(this.dataset.artist, this.dataset.mbid)">📀 Discographie</button>
        </div>
      </div>
    </div>`;
}

function discoverAlbumHTML(r) {
  const color = getSingleGenreColor(r.mainGenre ? r.mainGenre.toUpperCase() : 'AUTRE');
  const caa = r.mbid ? `https://coverartarchive.org/release-group/${r.mbid}/front-250` : '';

  const labels = [];
  if (r.year) labels.push(r.year);
  if (r.primary === 'EP') labels.push('EP');
  r.secondary.forEach(t => labels.push(t));

  let action;
  if (r.isOwned) action = `<span class="dc-owned">✔ Dans ma collection</span>`;
  else if (r.isIdea) action = `<span class="dc-owned">💡 Déjà dans mes idées</span>`;
  else action = `<button type="button" class="dc-add" onclick="discoverAddToIdeas('d', ${r.idx})">＋ Ajouter aux idées</button>`;

  const cover = (r.image || caa)
    ? `<div class="dc-cover"><span class="dc-cover-ph">💿</span><img src="${mbEscapeHTML(r.image || caa)}" data-fallback="${mbEscapeHTML(r.image ? caa : '')}" alt="" loading="lazy" onerror="discoverCoverError(this)"></div>`
    : `<div class="dc-cover"><span class="dc-cover-ph">💿</span></div>`;

  return `
    <div class="list-item dc-item" style="border-color:${color}; --glow:${color}; border-left-width:6px;">
      ${discoverLastfmLink(r.lastfmUrl)}
      ${discoverPlayButton('album', r.artist, r.title, 'dc-play-side dc-play-up')}
      ${cover}
      <div class="dc-info">
        <div class="dc-title">${mbEscapeHTML(r.title)}</div>
        ${labels.length ? `<div class="dc-meta">${labels.map(mbEscapeHTML).join(' · ')}</div>` : ''}
        ${discoverNowPlaying(discoverPreviewKey('album', r.artist, r.title))}
        <div class="dc-actions">${action}</div>
      </div>
    </div>`;
}

function discoverSeparatorHTML(label) {
  return `<div class="dc-separator"><span>${mbEscapeHTML(label)}</span></div>`;
}

function renderDiscoverResults() {
  const s = discoverState;
  const box = document.getElementById('dc-results');
  const statusEl = document.getElementById('dc-status');
  const discoBar = document.getElementById('dc-disco-bar');
  const moreEl = document.getElementById('dc-more');
  if (!box || !statusEl || !moreEl || !discoBar) return;

  // ----- Vue « discographie complète d'un artiste » -----
  if (s.view === 'disco' && s.disco) {
    const d = s.disco;
    const { owned, ideas } = discoverOwnedAlbumKeys();
    const mark = r => ({ ...r, isOwned: owned.has(r.key), isIdea: ideas.has(r.key) });

    // Barre fixe : bouton retour bien visible + titre
    discoBar.innerHTML = `
      <button type="button" class="dc-back-results" onclick="goBack()">${d.direct ? '← Retour' : '← Retour aux résultats'}</button>
      <div class="dc-disco-title">📀 Discographie de <span class="dc-disco-artist">${mbEscapeHTML(d.artist)}</span></div>`;
    discoBar.classList.remove('hidden');

    let html = '';
    html += d.items.filter(r => r.official).map(r => discoverAlbumHTML(mark(r))).join('');

    const others = d.items.filter(r => !r.official);
    if (others.length > 0) {
      html += discoverSeparatorHTML('Autres sorties');
      html += `<button type="button" class="btn-secondary dc-others-toggle" onclick="discoverToggleOthers()">${d.showOthers ? 'Masquer' : 'Afficher'} les autres sorties (${others.length}) · live, compilations, EP…</button>`;
      if (d.showOthers) html += others.map(r => discoverAlbumHTML(mark(r))).join('');
    }
    box.innerHTML = html;

    statusEl.classList.remove('dc-status-running');
    statusEl.innerHTML = d.status || '';
    statusEl.classList.toggle('hidden', !d.status);
    moreEl.classList.add('hidden');
    return;
  }

  // ----- Recherche en cours : rien de nouveau n'est affiché, seul l'indicateur change -----
  discoBar.classList.add('hidden');
  statusEl.classList.toggle('dc-status-running', s.running);
  moreEl.classList.toggle('dc-more-running', s.running);
  moreEl.disabled = s.running;
  if (s.running) {
    if (s.shown > 0) {
      // « Voir plus » : la liste reste figée et le bouton lui-même indique que ça travaille
      moreEl.textContent = '⏳ Recherche en cours…';
      moreEl.classList.remove('hidden');
      statusEl.classList.add('hidden');
    } else {
      statusEl.textContent = '⏳ Recherche en cours…';
      statusEl.classList.remove('hidden');
      moreEl.classList.add('hidden');
    }
    return;
  }

  // ----- Liste d'artistes -----
  const order = discoverComputeOrder();
  const visible = order.list.slice(0, s.shown);

  let html = '';
  let previousLow = false;
  visible.forEach(a => {
    if (a.lowTier && !previousLow) html += discoverSeparatorHTML('Moins proches ou moins connus');
    previousLow = a.lowTier;
    html += discoverArtistHTML(a);
  });
  box.innerHTML = html;

  let status = s.status || '';
  if (s.started && visible.length > 0) {
    const parts = [`<strong>${visible.length}</strong> sur ${order.list.length} artiste${order.list.length > 1 ? 's' : ''}`];
    if (order.hiddenOwned > 0) parts.push(`<span class="dc-muted">(${order.hiddenOwned} déjà dans ta collection ou tes idées, masqué${order.hiddenOwned > 1 ? 's' : ''})</span>`);
    if (s.lifespanNote) parts.push(`<span class="dc-muted">${mbEscapeHTML(s.lifespanNote)}</span>`);
    status = parts.join(' ') + (status ? `<br>${status}` : '');
  } else if (s.started && s.candidates.length > 0 && visible.length === 0 && !status) {
    status = 'Tous les artistes trouvés sont déjà dans ta collection ou tes idées : décoche « Masquer » pour les voir.';
  }
  statusEl.innerHTML = status;
  statusEl.classList.toggle('hidden', !status);

  const remaining = order.list.length - visible.length;
  let moreLabel = '';
  if (s.started && remaining > 0) moreLabel = `Voir plus (${remaining} restant${remaining > 1 ? 's' : ''})`;
  else if (s.started && !s.extraShown && order.extra.length > 0) moreLabel = `Afficher des artistes moins proches ou moins connus (${order.extra.length})`;
  moreEl.classList.toggle('hidden', !moreLabel);
  if (moreLabel) moreEl.textContent = moreLabel;

  // Les couvertures des artistes affichés qui n'en ont pas encore (après un changement de tri, par exemple)
  const missing = visible.filter(a => !a.topLoaded);
  if (missing.length > 0) {
    discoverFillTopAlbums(missing).then(() => {
      if (!s.running && s.view === 'results') renderDiscoverResults();
    }).catch(err => console.warn(err));
  }
}

/* ---------- Discographie complète d'un artiste (Last.fm d'abord, MusicBrainz pour les dates) ---------- */
function discoverScrollToResults() {
  const target = document.getElementById('dc-banner') || document.getElementById('dc-results');
  if (target) window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - 175), behavior: 'smooth' });
}

function discoverToggleOthers() {
  if (!discoverState.disco) return;
  discoverState.disco.showOthers = !discoverState.disco.showOthers;
  renderDiscoverResults();
}

// Bouton du formulaire : discographie de l'artiste saisi dans « Similaire à »
function discoverShowDiscographyFromForm() {
  readDiscoverCriteria();
  const name = discoverState.criteria.artist;
  if (!name) {
    showToast("⚠️ Indique d'abord un artiste dans « Similaire à »");
    return;
  }
  goToArtistDiscographyFromResults(name, '');
}

async function discoverShowDiscography(name, mbid, options = {}) {
  const s = discoverState;
  if (!name) return;
  const direct = !!options.direct; // ouverte depuis une page Titres (bouton dédié) : le retour va vers cette page-là, pas vers les résultats
  if (!getLastfmKey()) {
    s.showKeyCard = true;
    s.formOpen = true;
    if (direct) s.pendingDisco = name; // pour ouvrir directement cette discographie une fois la clé enregistrée
    s.status = '<span class="dc-warn">🔑 Ajoute d\'abord ta clé API Last.fm ci-dessus.</span>';
    refreshDiscoverPage();
    return;
  }

  // Une recherche en cours est abandonnée (les résultats déjà classés sont conservés)
  s.runId++;
  s.running = false;
  const runId = s.runId;

  s.formOpen = false;
  s.view = 'disco';
  s.disco = { artist: name, mbid: mbid || '', items: [], showOthers: false, loading: true, direct, status: `Chargement de la discographie de <strong>${mbEscapeHTML(name)}</strong>…` };
  refreshDiscoverPage();
  discoverScrollToResults();

  try {
    // Nom exact et identifiant MusicBrainz de l'artiste (via Last.fm) pour une recherche précise
    const artist = { name, mbid: mbid || '' };
    if (!artist.mbid) {
      try {
        const info = await lastfmCall('artist.getInfo', { artist: name });
        if (info.artist) {
          artist.name = info.artist.name || name;
          artist.mbid = info.artist.mbid || '';
        }
      } catch (err) {
        if (isFatalDiscoverError(err)) throw err;
      }
    }
    if (!discoverAlive(runId)) return;
    s.disco.artist = artist.name;

    const [mb, top] = await Promise.all([
      discoverMbArtistGroups(artist, 2),
      lastfmCall('artist.getTopAlbums', { artist: artist.name, limit: 100 }),
    ]);
    if (!discoverAlive(runId)) return;

    // Albums connus de Last.fm (sans hommages ni reprises). Last.fm liste chaque édition à part : on les regroupe plus bas.
    const lfmAlbums = [];
    asArray(top && top.topalbums && top.topalbums.album).forEach(album => {
      const title = album.name;
      if (!title || title === '(null)' || MB_PARASITE_REGEX.test(title)) return;
      lfmAlbums.push({ title, key: mbBaseTitle(title), playcount: parseInt(album.playcount, 10) || 0, image: lfmImage(album.image), url: album.url || '' });
    });

    const items = [];
    const make = (title, group, pop, official) => {
      const tags = discoverGroupTags(group);
      return {
        key: `${mbNormalize(artist.name)}|${mbBaseTitle(title)}`,
        artist: artist.name,
        title,
        year: discoverYearOf(group),
        date: group ? (group['first-release-date'] || '') : '',
        mbGroup: group,
        mbid: group ? group.id : '',
        primary: group ? group['primary-type'] : '',
        secondary: group ? asArray(group['secondary-types']) : [],
        playcount: pop ? pop.playcount : 0,
        image: pop ? pop.image : '',
        lastfmUrl: pop ? pop.url : '',
        tags,
        mainGenre: discoverGuessGenre(tags),
        official,
      };
    };

    if (!mb.ok) {
      // MusicBrainz n'a pas répondu : albums Last.fm regroupés par titre de base, sans dates
      const byKey = new Map();
      lfmAlbums.forEach(a => {
        const cur = byKey.get(a.key);
        if (!cur || a.title.length < cur.title.length) byKey.set(a.key, { ...a, playcount: (cur ? cur.playcount : 0) + a.playcount });
        else cur.playcount += a.playcount;
      });
      byKey.forEach(pop => items.push(make(pop.title, null, pop, true)));
      items.sort((a, b) => b.playcount - a.playcount);
      s.disco.status = `<span class="dc-muted">MusicBrainz n'a pas répondu : les dates ne sont pas disponibles.</span>`;
    } else {
      const isStudio = g => asArray(g['secondary-types']).length === 0 && g['primary-type'] === 'Album';
      // Une fin de titre qui ressemble à une suite ("II", "Vol. 2", "Part 3"...) désigne un autre album, pas une réédition
      const isSequelTail = tail => /^(?:\d|[ivx]+\b|vol|volume|part|pt)/i.test(tail.trim());

      // 1. Albums MusicBrainz : une seule entrée par titre de base (l'originale, la plus ancienne)
      const entries = Array.from(discoverIndexGroups(mb.groups).entries())
        .filter(([, e]) => !MB_PARASITE_REGEX.test(e.g.title || ''))
        .map(([key, e]) => ({ key, g: e.g, year: discoverYearOf(e.g), studio: isStudio(e.g), lfm: [] }));

      // 2. Les rééditions au titre rallongé ("OK Computer OKNOTOK 1997 2017") sont écartées au profit de l'original
      const kept = entries.filter(a => {
        if (!a.studio) return true;
        return !entries.some(b =>
          b !== a && b.studio && b.key.length >= 5 && a.key.startsWith(b.key + ' ') &&
          !isSequelTail(a.key.slice(b.key.length)) && (!b.year || !a.year || b.year <= a.year)
        );
      });

      // 3. Chaque album Last.fm est rattaché à l'album MusicBrainz d'origine (titre identique ou édition rallongée)
      const unmatched = [];
      lfmAlbums.forEach(a => {
        let target = kept.find(e => e.key === a.key);
        if (!target) target = kept.find(e => e.key.length >= 5 && a.key.startsWith(e.key + ' ') && !isSequelTail(a.key.slice(e.key.length)));
        if (target) target.lfm.push(a);
        else unmatched.push(a);
      });

      // 4. Albums officiels = albums studio connus de Last.fm ; le reste passera sous le trait de séparation
      kept.forEach(e => {
        const best = e.lfm.slice().sort((x, y) => y.playcount - x.playcount)[0];
        const pop = best ? { playcount: e.lfm.reduce((n, x) => n + x.playcount, 0), image: best.image, url: best.url } : null;
        items.push(make(e.g.title, e.g, pop, e.studio && e.lfm.length > 0));
      });
      // Albums Last.fm inconnus de MusicBrainz : une seule ligne par titre de base
      const seenUnmatched = new Set();
      unmatched.forEach(a => {
        if (seenUnmatched.has(a.key)) return;
        seenUnmatched.add(a.key);
        items.push(make(a.title, null, a, false));
      });

      const byYear = (a, b) => (a.year || 9999) - (b.year || 9999) || b.playcount - a.playcount;
      items.sort((a, b) => (b.official - a.official) || byYear(a, b));
    }

    items.forEach((r, i) => { r.idx = i; });
    s.disco.items = items;
    s.disco.loading = false;
    if (items.length === 0) s.disco.status = '<span class="dc-warn">Aucun album trouvé pour cet artiste.</span>';
    else if (mb.ok) s.disco.status = '';
    renderDiscoverResults();
  } catch (err) {
    if (runId !== s.runId) return;
    s.view = 'results';
    s.disco = null;
    discoverHandleError(err);
  }
}

/* ==========================================
   EXTRAITS AUDIO (30 secondes, API publique iTunes)
   ------------------------------------------
   Un seul lecteur pour toute la page : lancer un extrait arrête le précédent.
   - Artiste : le titre le plus écouté (Last.fm) est recherché sur iTunes ; à défaut, le premier titre de l'artiste.
   - Album   : le 1er titre de l'album (iTunes), retrouvé par artiste + titre d'album.
   ========================================== */
const ITUNES_API = 'https://itunes.apple.com/';
const ITUNES_COUNTRY = 'FR';
// Fichier audio vide : jouer ce fichier au moment de l'appui "débloque" le lecteur sur Android, même si l'extrait
// n'est trouvé qu'une ou deux secondes plus tard
const SILENT_AUDIO = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const discoverPlayer = { audio: null, key: '', state: 'idle', title: '', token: 0 };

function itunesUrl(path, params) {
  return `${ITUNES_API}${path}?${new URLSearchParams({ country: ITUNES_COUNTRY, ...params })}`;
}

// Certains navigateurs bloquent la lecture directe de l'API : on retombe alors sur la méthode JSONP (balise script)
function itunesJsonp(url) {
  return new Promise((resolve, reject) => {
    const callback = `__itunes_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const script = document.createElement('script');
    const cleanup = () => { clearTimeout(timer); delete window[callback]; script.remove(); };
    const timer = setTimeout(() => { cleanup(); reject(new TypeError('iTunes : délai dépassé (network)')); }, 8000);
    window[callback] = data => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new TypeError('iTunes : requête bloquée (network)')); };
    script.src = `${url}&callback=${callback}`;
    document.head.appendChild(script);
  });
}

async function itunesFetch(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`iTunes : HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    return itunesJsonp(url);
  }
}

// Le nom d'artiste iTunes correspond-il à celui recherché ? ("Muse" ou "Muse & Autre" / "Muse feat. Autre")
function itunesArtistMatches(rawName, wanted) {
  const full = mbNormalize(rawName);
  if (full === wanted) return true;
  const first = String(rawName || '').split(/\s*(?:&|,|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\band\b)\s*/i)[0];
  return mbNormalize(first) === wanted;
}

function itunesTitleKey(title) {
  return mbNormalize(String(title || '').replace(/[(\[][^)\]]*[)\]]/g, ' ').replace(/\s[-–]\s.*$/, ''));
}

// Extrait d'un artiste : ses titres les plus écoutés (Last.fm) d'abord, puis son premier titre iTunes
async function discoverFindArtistPreview(artistName) {
  const cacheKey = `pv:a:${mbNormalize(artistName)}`;
  if (discoverCache.has(cacheKey)) return discoverCache.get(cacheKey);
  const wanted = mbNormalize(artistName);

  let topTracks = [];
  try {
    const data = await lastfmCall('artist.getTopTracks', { artist: artistName, limit: 5 });
    topTracks = asArray(data.toptracks && data.toptracks.track).map(t => t.name).filter(Boolean).slice(0, 3);
  } catch (err) {
    if (err instanceof TypeError && !isNetworkError(err)) throw err; // vraie erreur de code
    // Last.fm indisponible : on se contente d'iTunes
  }

  const pick = (results, trackName) => (results || []).find(r =>
    r.previewUrl && itunesArtistMatches(r.artistName, wanted) &&
    (!trackName || itunesTitleKey(r.trackName) === itunesTitleKey(trackName))
  );
  const toResult = r => ({ url: r.previewUrl, title: r.trackName, artist: r.artistName });

  let found = null;
  for (const track of topTracks) {
    const data = await itunesFetch(itunesUrl('search', { term: `${artistName} ${track}`, entity: 'song', limit: 10 }));
    const hit = pick(data.results, track);
    if (hit) { found = toResult(hit); break; }
  }
  if (!found) {
    const data = await itunesFetch(itunesUrl('search', { term: artistName, entity: 'song', attribute: 'artistTerm', limit: 25 }));
    const hit = pick(data.results, '');
    if (hit) found = toResult(hit);
  }
  if (found) discoverCache.set(cacheKey, found);
  return found;
}

// Extrait d'un album : son premier titre, retrouvé via la fiche album iTunes
async function discoverFindAlbumPreview(artistName, albumTitle) {
  const cacheKey = `pv:b:${mbNormalize(artistName)}|${mbBaseTitle(albumTitle)}`;
  if (discoverCache.has(cacheKey)) return discoverCache.get(cacheKey);
  const wanted = mbNormalize(artistName);
  const wantedTitle = mbBaseTitle(albumTitle);

  const search = await itunesFetch(itunesUrl('search', { term: `${artistName} ${albumTitle}`, entity: 'album', limit: 10 }));
  const albums = (search.results || [])
    .filter(r => r.collectionId && itunesArtistMatches(r.artistName, wanted))
    .filter(r => { const t = mbBaseTitle(r.collectionName); return t === wantedTitle || (t.length >= 4 && wantedTitle.length >= 4 && (t.startsWith(wantedTitle) || wantedTitle.startsWith(t))); })
    .sort((a, b) => String(a.collectionName).length - String(b.collectionName).length);
  if (albums.length === 0) return null;

  const lookup = await itunesFetch(itunesUrl('lookup', { id: albums[0].collectionId, entity: 'song' }));
  const tracks = (lookup.results || [])
    .filter(r => r.wrapperType === 'track' && r.previewUrl)
    .sort((a, b) => ((a.discNumber || 1) - (b.discNumber || 1)) || ((a.trackNumber || 99) - (b.trackNumber || 99)));
  if (tracks.length === 0) return null;

  const found = { url: tracks[0].previewUrl, title: tracks[0].trackName, artist: tracks[0].artistName };
  discoverCache.set(cacheKey, found);
  return found;
}

/* ---------- Lecteur ---------- */
function discoverPreviewKey(kind, artist, title) {
  return kind === 'artist' ? `a:${mbNormalize(artist)}` : `b:${mbNormalize(artist)}|${mbBaseTitle(title)}`;
}

function discoverPlayClass(key) {
  const p = discoverPlayer;
  if (p.key !== key) return '';
  return p.state === 'loading' ? 'is-loading' : (p.state === 'playing' ? 'is-playing' : '');
}

function discoverPlayButton(kind, artist, title, extraClass = '') {
  const key = discoverPreviewKey(kind, artist, title);
  return `<button type="button" class="dc-play ${extraClass} ${discoverPlayClass(key)}" data-key="${mbEscapeHTML(key)}" data-kind="${kind}" data-artist="${mbEscapeHTML(artist)}" data-title="${mbEscapeHTML(title || '')}" aria-label="Écouter un extrait" onclick="event.stopPropagation(); discoverTogglePreview(this)">` +
    `<svg class="i-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>` +
    `<svg class="i-pause" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>` +
    `<span class="i-spin"></span></button>`;
}

// Titre en cours de lecture, affiché discrètement sous le nom
function discoverNowPlaying(key) {
  const p = discoverPlayer;
  const on = p.key === key && p.state === 'playing';
  return `<div class="dc-nowplaying ${on ? '' : 'hidden'}" data-key="${mbEscapeHTML(key)}">${on ? '♪ ' + mbEscapeHTML(p.title) : ''}</div>`;
}

function discoverUpdatePlayButtons() {
  const p = discoverPlayer;
  document.querySelectorAll('.dc-play').forEach(btn => {
    const mine = btn.dataset.key === p.key;
    btn.classList.toggle('is-loading', mine && p.state === 'loading');
    btn.classList.toggle('is-playing', mine && p.state === 'playing');
  });
  document.querySelectorAll('.dc-nowplaying').forEach(el => {
    const on = el.dataset.key === p.key && p.state === 'playing';
    el.classList.toggle('hidden', !on);
    el.textContent = on ? `♪ ${p.title}` : '';
  });
}

function discoverAudio() {
  const p = discoverPlayer;
  if (!p.audio) {
    const audio = new Audio();
    audio.preload = 'none';
    audio.addEventListener('ended', () => {
      if (audio.src.startsWith('data:')) return; // fin du fichier vide de déblocage : on attend le vrai extrait
      discoverStopPreview();
    });
    audio.addEventListener('error', () => {
      if (audio.src.startsWith('data:')) return; // le fichier vide de déblocage
      if (p.state === 'playing' || p.state === 'loading') {
        discoverStopPreview();
        showToast("⚠️ Lecture impossible pour cet extrait");
      }
    });
    p.audio = audio;
  }
  return p.audio;
}

function discoverStopPreview() {
  const p = discoverPlayer;
  p.token++;
  p.key = '';
  p.state = 'idle';
  p.title = '';
  if (p.audio) {
    p.audio.pause();
    p.audio.removeAttribute('src');
    p.audio.load();
  }
  discoverUpdatePlayButtons();
}

async function discoverTogglePreview(btn) {
  const p = discoverPlayer;
  const key = btn.dataset.key;
  const kind = btn.dataset.kind;

  // Un second appui sur le même bouton arrête la lecture
  if (p.key === key && (p.state === 'playing' || p.state === 'loading')) {
    discoverStopPreview();
    return;
  }

  discoverStopPreview();
  const audio = discoverAudio();
  audio.src = SILENT_AUDIO;               // déblocage de la lecture pendant le geste
  audio.play().catch(() => {});

  p.key = key;
  p.state = 'loading';
  discoverUpdatePlayButtons();
  const token = ++p.token;

  try {
    const found = kind === 'artist'
      ? await discoverFindArtistPreview(btn.dataset.artist)
      : await discoverFindAlbumPreview(btn.dataset.artist, btn.dataset.title);
    if (token !== p.token) return;

    if (!found) {
      discoverStopPreview();
      showToast("🎧 Aucun extrait disponible sur iTunes pour celui-ci");
      return;
    }
    audio.src = found.url;
    await audio.play();
    if (token !== p.token) return;
    p.state = 'playing';
    p.title = found.title;
    discoverUpdatePlayButtons();
  } catch (err) {
    if (token !== p.token) return;
    console.error(err);
    discoverStopPreview();
    showToast(isNetworkError(err) ? "📡 Impossible de joindre iTunes" : "⚠️ Lecture impossible : appuie à nouveau sur ▶");
  }
}

// La lecture s'arrête quand on quitte la page Découverte
['hashchange', 'popstate'].forEach(evt => window.addEventListener(evt, () => {
  setTimeout(() => {
    if (discoverPlayer.state !== 'idle' && !document.getElementById('discover-page')) discoverStopPreview();
  }, 0);
}));

/* ---------- Pages : « Découverte » ---------- */
function discoverSummaryText() {
  const c = discoverState.criteria;
  const parts = [];
  if (c.artist) parts.push(`Similaire à ${c.artist}`);
  if (c.genre) parts.push(c.genre);
  if (c.tag) parts.push(`#${c.tag}`);
  if (c.yearFrom || c.yearTo) parts.push(`${c.yearFrom || '…'}–${c.yearTo || '…'}`);
  return parts.join(' · ') || 'Aucun critère';
}

function discoverPageHTML() {
  const s = discoverState;
  const c = s.criteria;
  const hasKey = !!getLastfmKey();

  const genreOptions = `<option value="">Tous les genres</option>` +
    MAIN_GENRES.map(g => `<option value="${mbEscapeHTML(g)}" ${g === c.genre ? 'selected' : ''}>${mbEscapeHTML(g)}</option>`).join('');
  const sel = (value, current) => (value === current ? 'selected' : '');

  const keyCard = (!hasKey || s.showKeyCard) ? `
    <div class="dc-card dc-key-card">
      <div class="dc-card-title">🔑 Clé API Last.fm</div>
      <p class="dc-help">Last.fm fournit les artistes similaires et la popularité. Crée une clé gratuite sur
        <a href="https://www.last.fm/api/account/create" target="_blank" rel="noopener">last.fm/api/account/create</a>
        (nom de l'application au choix), puis colle-la ici. Elle reste enregistrée uniquement sur cet appareil.</p>
      <div class="dc-row dc-row-key">
        <input type="text" id="dc-key-input" placeholder="Clé API (32 caractères)" autocomplete="off" autocapitalize="off" spellcheck="false" value="${mbEscapeHTML(getLastfmKey())}">
        <button type="button" class="btn-primary" onclick="saveLastfmKeyFromInput()">Enregistrer</button>
      </div>
    </div>` : '';

  const chips = s.chips.length > 1 ? `
    <div class="dc-chips-row">
      <span class="dc-chips-label">Artistes de ce minidisc :</span>
      ${s.chips.map(n => `<button type="button" class="dc-chip-btn ${n === c.artist ? 'active' : ''}" onclick="discoverPickArtist(this.dataset.name)" data-name="${mbEscapeHTML(n)}">${mbEscapeHTML(n)}</button>`).join('')}
    </div>` : '';

  const enter = `onkeydown="if(event.key==='Enter'){event.preventDefault(); startDiscoverSearch();}"`;

  return `
    <div id="discover-page" class="discover-page">
      ${keyCard}

      <div id="dc-form" class="dc-card ${s.formOpen ? '' : 'hidden'}">
        <div class="dc-card-title">🔎 Mes critères</div>

        <div class="form-group">
          <label>Similaire à (artiste)</label>
          <div class="dc-autocomplete">
            <input type="text" id="dc-artist" placeholder="ex: Radiohead" value="${mbEscapeHTML(c.artist)}" autocomplete="off"
              oninput="discoverSuggest()" onfocus="discoverSuggest()" onblur="discoverHideSuggestSoon()" ${enter}>
            <div id="dc-suggest" class="dc-suggest hidden"></div>
          </div>
        </div>
        ${chips}

        <div class="dc-row">
          <div class="form-group">
            <label>Genre</label>
            <select id="dc-genre">${genreOptions}</select>
          </div>
          <div class="form-group">
            <label>Tag libre</label>
            <input type="text" id="dc-tag" placeholder="ex: shoegaze" value="${mbEscapeHTML(c.tag)}" autocomplete="off" ${enter}>
          </div>
        </div>

        <div class="dc-row">
          <div class="form-group">
            <label>Actif à partir de</label>
            <input type="number" id="dc-year-from" inputmode="numeric" min="1900" max="2100" placeholder="1990" value="${mbEscapeHTML(c.yearFrom)}" ${enter}>
          </div>
          <div class="form-group">
            <label>Jusqu'à</label>
            <input type="number" id="dc-year-to" inputmode="numeric" min="1900" max="2100" placeholder="1999" value="${mbEscapeHTML(c.yearTo)}" ${enter}>
          </div>
        </div>

        <div class="dc-row">
          <div class="form-group">
            <label>Trier par</label>
            <select id="dc-sort" onchange="discoverViewChanged()">
              <option value="recommended" ${sel('recommended', c.sort)}>Recommandés</option>
              <option value="popularity" ${sel('popularity', c.sort)}>Popularité ↓</option>
              <option value="similarity" ${sel('similarity', c.sort)}>Similarité ↓</option>
            </select>
          </div>
          <div class="form-group">
            <label>&nbsp;</label>
            <button type="button" class="btn-secondary dc-disco-btn" onclick="discoverShowDiscographyFromForm()">📀 Voir la discographie</button>
          </div>
        </div>

        <div class="form-group">
          <label class="dc-check"><input type="checkbox" id="dc-hide-owned" ${c.hideOwned ? 'checked' : ''} onchange="discoverViewChanged()"><span>Masquer les artistes que j'ai déjà (collection et idées)</span></label>
        </div>

        <div class="dc-buttons">
          <button type="button" class="btn-primary" onclick="startDiscoverSearch()">Lancer la recherche</button>
          <button type="button" class="btn-secondary" onclick="discoverReset()">Effacer</button>
        </div>
      </div>

      <!-- Ces deux tuiles restent affichées en haut de l'écran pendant qu'on fait défiler les résultats -->
      <div id="dc-sticky" class="dc-sticky">
        <button type="button" id="dc-banner" class="dc-banner ${s.formOpen ? 'hidden' : ''}" onclick="discoverToggleForm(true)">
          <span class="dc-banner-title">🔎 Nouvelle recherche</span>
          <span class="dc-banner-sub">${mbEscapeHTML(discoverSummaryText())}</span>
        </button>
        <div id="dc-status" class="dc-status hidden"></div>
        <div id="dc-disco-bar" class="dc-disco-head hidden"></div>
      </div>
      <div id="dc-results" class="dc-results"></div>
      <button type="button" id="dc-more" class="btn-secondary dc-more hidden" onclick="discoverLoadMore()">Voir plus</button>

      <div class="dc-credits">
        Données : <a href="https://www.last.fm" target="_blank" rel="noopener">Last.fm</a> et
        <a href="https://musicbrainz.org" target="_blank" rel="noopener">MusicBrainz</a> ·
        Extraits : <a href="https://www.apple.com/fr/itunes/" target="_blank" rel="noopener">Apple</a>
        ${hasKey ? ' · <a href="#" onclick="discoverChangeKey(); return false;">Changer la clé Last.fm</a>' : ''}
      </div>
    </div>
  `;
}

function refreshDiscoverPage() {
  if (!document.getElementById('discover-page')) return;
  app.innerHTML = discoverPageHTML();
  renderDiscoverResults();
}

// Ouvre / referme le formulaire (fermé, il ne reste que le bandeau « Nouvelle recherche »)
function discoverToggleForm(open) {
  discoverState.formOpen = open;
  const form = document.getElementById('dc-form');
  const banner = document.getElementById('dc-banner');
  if (form) form.classList.toggle('hidden', !open);
  if (banner) banner.classList.toggle('hidden', open);
  if (open) window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Point d'entrée de la page (params : critères pré-remplis quand on arrive depuis un album)
function renderDiscover(params) {
  const s = discoverState;
  prepareSubPage('DÉCOUVERTE');
  s.view = 'results';
  s.disco = null;

  let autoStart = false;
  if (params && ['artist', 'genre', 'year', 'artists'].some(k => params.get(k))) {
    const year = parseInt(params.get('year'), 10);
    const nowYear = new Date().getFullYear();
    s.runId++; // annule une éventuelle recherche précédente
    s.criteria = {
      ...DISCOVER_DEFAULTS,
      artist: params.get('artist') || '',
      genre: matchMainGenre(params.get('genre')),
      yearFrom: year ? String(year - 5) : '',
      yearTo: year ? String(Math.min(year + 5, nowYear)) : '',
    };
    s.chips = (params.get('artists') || '').split('|').filter(Boolean);
    discoverResetResults();
    s.started = false;
    s.running = false;
    s.formOpen = true;
    autoStart = params.get('auto') === '1';
  }

  app.innerHTML = discoverPageHTML();
  renderDiscoverResults();

  if (autoStart) {
    if (getLastfmKey()) startDiscoverSearch();
    else s.pendingAuto = true;
  }
}

function discoverViewChanged() {
  readDiscoverViewOptions();
  if (discoverState.running) return;
  renderDiscoverResults();
}

function discoverPickArtist(name) {
  const input = document.getElementById('dc-artist');
  if (input) input.value = name;
  startDiscoverSearch();
}

function discoverReset() {
  const s = discoverState;
  discoverStopPreview();
  s.runId++;
  s.criteria = { ...DISCOVER_DEFAULTS };
  s.chips = [];
  discoverResetResults();
  s.started = false;
  s.running = false;
  s.formOpen = true;
  refreshDiscoverPage();
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
