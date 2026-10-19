// Finds out how big each song file is, so "Largest first / Smallest first" works.
// It works in the background and remembers the sizes inside the app.
let FS = null;
try {
  FS = require('expo-file-system/legacy');
} catch (e) {
  try {
    FS = require('expo-file-system');
  } catch (e2) {
    FS = null;
  }
}
if (FS && typeof FS.getInfoAsync !== 'function') FS = null;

let AS = null;
try {
  const mod = require('@react-native-async-storage/async-storage');
  AS = mod.default || mod;
} catch (e) {
  AS = null;
}

const KEY = 'mm_sizes_v1';
let cache = {}; // song id -> size in bytes

export async function loadSizes() {
  try {
    const raw = AS ? await AS.getItem(KEY) : null;
    if (raw) cache = JSON.parse(raw) || {};
  } catch (e) {
    cache = {};
  }
  return { ...cache };
}

async function persist() {
  try {
    if (AS) await AS.setItem(KEY, JSON.stringify(cache));
  } catch (e) {}
}

// Reads the size of every song that is not known yet. Calls onUpdate now and then with all known sizes.
export async function fillSizes(list, isCancelled, onUpdate) {
  if (!FS) return;
  const todo = list.filter((x) => cache[x.id] === undefined);
  if (todo.length === 0) return;
  const BATCH = 12;
  let rounds = 0;
  for (let p = 0; p < todo.length; p += BATCH) {
    if (isCancelled()) break;
    const part = todo.slice(p, p + BATCH);
    await Promise.all(
      part.map(async (sg) => {
        try {
          const info = await FS.getInfoAsync(sg.uri);
          if (info && info.exists) cache[sg.id] = info.size > 0 ? info.size : 0;
        } catch (e) {}
      })
    );
    rounds++;
    if (rounds % 10 === 0 && onUpdate) onUpdate({ ...cache });
  }
  await persist();
  if (onUpdate) onUpdate({ ...cache });
}
