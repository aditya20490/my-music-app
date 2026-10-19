// Your own changes to songs (title, artist, cover...). They are saved inside the app only.
// The audio files themselves are never touched.
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
if (FS && typeof FS.copyAsync !== 'function') FS = null;

let ImagePicker = null;
try {
  ImagePicker = require('expo-image-picker');
} catch (e) {
  ImagePicker = null;
}

let AS = null;
try {
  const mod = require('@react-native-async-storage/async-storage');
  AS = mod.default || mod;
} catch (e) {
  AS = null;
}

export const PICKER_AVAILABLE = !!ImagePicker && !!FS;

const KEY = 'mm_edits_v1';
const edits = {}; // song id -> { title, artist, ..., lyrics, cover }

const EDIT_TEXT = ['title', 'artist', 'albumArtist', 'album', 'genre', 'composer'];
const EDIT_NUM = ['year', 'track', 'disc'];

function toNum(v) {
  const n = parseInt(String(v), 10);
  return isFinite(n) && n > 0 ? n : 0;
}

export async function loadEdits() {
  try {
    const raw = AS ? await AS.getItem(KEY) : null;
    if (raw) Object.assign(edits, JSON.parse(raw));
  } catch (e) {}
}

async function persist() {
  try {
    if (AS) await AS.setItem(KEY, JSON.stringify(edits));
  } catch (e) {}
}

async function deleteCoverFile(uri) {
  try {
    if (FS && uri && String(uri).indexOf('/covers/custom_') >= 0) {
      await FS.deleteAsync(uri, { idempotent: true });
    }
  } catch (e) {}
}

// undefined = no change (use the original cover), null = cover removed, string = your own cover file
export function getEditCover(id) {
  const e = edits[id];
  if (!e || e.cover === undefined) return undefined;
  return e.cover === '' ? null : e.cover;
}

// Puts your changes on top of a song.
export function withEdit(song) {
  const e = edits[song.id];
  if (!e) return song;
  const out = { ...song, edited: true };
  EDIT_TEXT.forEach((k) => {
    if (e[k] !== undefined) out[k] = k === 'title' && !e[k] ? song.fileTitle : e[k];
  });
  EDIT_NUM.forEach((k) => {
    if (e[k] !== undefined) out[k] = toNum(e[k]);
  });
  if (e.lyrics !== undefined) out.lyricsEdit = e.lyrics;
  if (e.cover !== undefined) out.coverKey = e.cover || 'none';
  return out;
}

// patch: { field: value }. A value of null removes that change (goes back to the original).
export async function saveEdit(id, patch) {
  const cur = { ...(edits[id] || {}) };
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (k === 'cover') {
      const old = cur.cover;
      if (v === null) delete cur.cover;
      else cur.cover = v;
      if (typeof old === 'string' && old && old !== cur.cover) await deleteCoverFile(old);
    } else if (v === null) {
      delete cur[k];
    } else {
      cur[k] = v;
    }
  }
  if (Object.keys(cur).length === 0) delete edits[id];
  else edits[id] = cur;
  await persist();
}

export async function clearEdit(id) {
  const e = edits[id];
  if (e && typeof e.cover === 'string') await deleteCoverFile(e.cover);
  delete edits[id];
  await persist();
}

// Opens the gallery, copies the chosen picture into the app and returns its path.
// Returns { uri } or { cancelled: true } or { error }.
export async function pickCoverFile(id) {
  if (!ImagePicker) return { error: 'The picture picker is not part of this build.' };
  if (!FS) return { error: 'File access is not part of this build.' };
  try {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    });
    if (res.canceled || !res.assets || !res.assets[0]) return { cancelled: true };
    const dir = (FS.documentDirectory || FS.cacheDirectory) + 'covers/';
    try {
      await FS.makeDirectoryAsync(dir, { intermediates: true });
    } catch (e) {}
    const safe = String(id).replace(/[^A-Za-z0-9_-]/g, '_');
    const dest = dir + 'custom_' + safe + '_' + Date.now() + '.jpg';
    await FS.copyAsync({ from: res.assets[0].uri, to: dest });
    return { uri: dest };
  } catch (e) {
    return { error: e && e.message ? String(e.message).slice(0, 160) : 'Could not read that picture.' };
  }
}
