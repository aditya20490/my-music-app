// Saves your favorites, hidden albums and your own albums inside the app only.
// Nothing here touches the songs on the phone.
let AS = null;
try {
  const mod = require('@react-native-async-storage/async-storage');
  AS = mod.default || mod;
} catch (e) {
  AS = null;
}

const FAV_KEY = 'mm_favs_v1';
const HIDDEN_KEY = 'mm_hidden_albums_v2'; // v2 keeps the album names too
const OLD_HIDDEN_KEY = 'mm_hidden_albums_v1'; // from the older build, thrown away
const ALBUMS_KEY = 'mm_custom_albums_v1';

let storageError = '';

export function getStorageInfo() {
  return { storageOk: !!AS && !storageError, storageError: AS ? storageError : 'storage library missing' };
}

async function readJSON(key, fallback) {
  try {
    const raw = AS ? await AS.getItem(key) : null;
    if (raw) return JSON.parse(raw);
  } catch (e) {
    storageError = e && e.message ? String(e.message).slice(0, 120) : 'read failed';
  }
  return fallback;
}

async function writeJSON(key, value) {
  try {
    if (!AS) {
      storageError = 'storage library missing';
      return;
    }
    await AS.setItem(key, JSON.stringify(value));
    storageError = '';
  } catch (e) {
    storageError = e && e.message ? String(e.message).slice(0, 120) : 'save failed';
  }
}

export async function loadCollections() {
  const favs = await readJSON(FAV_KEY, []);
  const hiddenRaw = await readJSON(HIDDEN_KEY, {});
  const albums = await readJSON(ALBUMS_KEY, []);
  try {
    if (AS) await AS.removeItem(OLD_HIDDEN_KEY);
  } catch (e) {}
  return {
    favs: new Set(Array.isArray(favs) ? favs : []),
    hidden: hiddenRaw && typeof hiddenRaw === 'object' && !Array.isArray(hiddenRaw) ? hiddenRaw : {},
    customAlbums: Array.isArray(albums) ? albums : [],
  };
}

export function saveFavs(set) {
  return writeJSON(FAV_KEY, Array.from(set));
}

// hidden: { albumKey: { title, sub } }
export function saveHidden(hiddenObj) {
  return writeJSON(HIDDEN_KEY, hiddenObj);
}

// albums: [{ id, name, songIds: [] }]
export function saveCustomAlbums(list) {
  return writeJSON(ALBUMS_KEY, list);
}
