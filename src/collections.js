// Saves your favorites and your hidden albums inside the app only.
// Nothing here touches the songs on the phone.
let AS = null;
try {
  const mod = require('@react-native-async-storage/async-storage');
  AS = mod.default || mod;
} catch (e) {
  AS = null;
}

const FAV_KEY = 'mm_favs_v1';
const HIDDEN_KEY = 'mm_hidden_albums_v1';

async function readList(key) {
  try {
    const raw = AS ? await AS.getItem(key) : null;
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) {}
  return [];
}

async function writeList(key, set) {
  try {
    if (AS) await AS.setItem(key, JSON.stringify(Array.from(set)));
  } catch (e) {}
}

export async function loadCollections() {
  const favs = await readList(FAV_KEY);
  const hidden = await readList(HIDDEN_KEY);
  return { favs: new Set(favs), hidden: new Set(hidden) };
}

export function saveFavs(set) {
  return writeList(FAV_KEY, set);
}

export function saveHidden(set) {
  return writeList(HIDDEN_KEY, set);
}
