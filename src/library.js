// Everything that talks to the phone: finding songs, reading song info, cover art, lyrics, saved settings.
import { Platform, PermissionsAndroid, NativeModules } from 'react-native';
import { cleanTitle } from './utils';
import { extractEmbeddedArt, EMBEDDED_ART_AVAILABLE } from './embeddedArt';
import { readTagsJs, TAG_READER_AVAILABLE } from './tagReader';
import { loadEdits, withEdit, getEditCover } from './edits';

// The newest Expo keeps the song-scanning functions in "expo-media-library/legacy".
let MediaLibrary = null;
try {
  MediaLibrary = require('expo-media-library/legacy');
} catch (e) {
  try {
    MediaLibrary = require('expo-media-library');
  } catch (e2) {
    MediaLibrary = null;
  }
}

// Reads artist, album, cover art and lyrics from the song files.
let Meta = null;
let metaLoadError = '';
try {
  Meta = require('@missingcore/react-native-metadata-retriever');
} catch (e) {
  Meta = null;
  metaLoadError = e && e.message ? String(e.message).slice(0, 160) : 'unknown';
}

// Saves small things (settings, song info) on the phone.
let AS = null;
try {
  const mod = require('@react-native-async-storage/async-storage');
  AS = mod.default || mod;
} catch (e) {
  AS = null;
}

// Songs shorter than this (in seconds) are hidden, so ringtones don't show up.
const MIN_SECONDS = 30;

export const META_AVAILABLE = !!Meta;

// ---------- Diagnostics (shown in Options > Library, helps us find problems) ----------
const diag = {
  metaLoaded: !!Meta,
  metaLoadError: metaLoadError,
  metaFunctions: Meta ? Object.keys(Meta).join(', ') : '',
  metaOk: 0,
  metaJs: 0,
  metaNone: 0,
  metaFail: 0,
  tagReader: TAG_READER_AVAILABLE,
  lastError: '',
  artSaved: 0,
  artNone: 0,
  artFail: 0,
  artJs: 0,
  backupReader: EMBEDDED_ART_AVAILABLE,
  lastArtError: '',
};

export function getDiagnostics() {
  return { ...diag };
}

function errText(e) {
  return e && e.message ? String(e.message).slice(0, 200) : String(e).slice(0, 200);
}

// ---------- Simple storage ----------
const mem = {};

async function getJSON(key, fallback) {
  try {
    const raw = AS ? await AS.getItem(key) : mem[key];
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return fallback;
}

async function setJSON(key, value) {
  try {
    const raw = JSON.stringify(value);
    if (AS) {
      await AS.setItem(key, raw);
    } else {
      mem[key] = raw;
    }
  } catch (e) {}
}

async function removeKey(key) {
  try {
    if (AS) {
      await AS.removeItem(key);
    } else {
      delete mem[key];
    }
  } catch (e) {}
}

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  view: 'list', // list | grid3
  sort: 'title',
  dir: 'asc',
  shuffle: false,
  repeat: 'off',
};

export async function loadSettings() {
  const saved = await getJSON('mm_settings_v1', {});
  const merged = { ...DEFAULT_SETTINGS, ...saved };
  if (merged.view !== 'list') merged.view = 'grid3'; // the old 2-grid option is gone
  return merged;
}

export function saveSettings(settings) {
  return setJSON('mm_settings_v1', settings);
}

// ---------- Permissions ----------
export async function ensureMediaPermission() {
  let perm = await MediaLibrary.getPermissionsAsync(false, ['audio']);
  if (!perm.granted) {
    perm = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
  }
  return !!perm.granted;
}

export async function requestNotificationPermission() {
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    try {
      await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
    } catch (e) {}
  }
}

// ---------- Song info cache ----------
// record = [title, artist, albumArtist, album, genre, year, track, disc, composer]
let metaCache = {};
const artMap = new Map(); // song id -> saved cover file uri, or null when the song has no cover
let metaSaveTimer = null;
let artSaveTimer = null;
const artSoft = new Set(); // ids whose cover failed with an error (not saved as "no cover")
const skipLib = new Set(); // ids where the library's cover file was broken, use backup reader

export async function loadCaches() {
  metaCache = await getJSON('mm_meta_v3', {});
  await removeKey('mm_meta_v2'); // old cache could hold empty details
  await loadEdits();
  await removeKey('mm_art_v1'); // old cache could hold "no cover" from builds that failed
  const art = await getJSON('mm_art_v2', {});
  for (const id of Object.keys(art)) {
    artMap.set(id, art[id] === 0 ? null : art[id]);
  }
}

function persistMetaSoon() {
  if (metaSaveTimer) return;
  metaSaveTimer = setTimeout(() => {
    metaSaveTimer = null;
    setJSON('mm_meta_v3', metaCache);
  }, 1500);
}

function persistArtSoon() {
  if (artSaveTimer) return;
  artSaveTimer = setTimeout(() => {
    artSaveTimer = null;
    const obj = {};
    artMap.forEach((v, k) => {
      if (artSoft.has(k)) return;
      obj[k] = v === null ? 0 : v;
    });
    setJSON('mm_art_v2', obj);
  }, 2500);
}

// Rescan: forgets what was read from the files. Your own edits are kept.
export async function clearCaches() {
  metaCache = {};
  artMap.clear();
  await removeKey('mm_meta_v2');
  await removeKey('mm_meta_v3');
  await removeKey('mm_art_v1');
  await removeKey('mm_art_v2');
}

function str(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function num(v) {
  const n = parseInt(String(v), 10);
  return isFinite(n) && n > 0 ? n : 0;
}

function makeRecord(d) {
  return [
    str(d.title),
    str(d.artist),
    str(d.albumArtist),
    str(d.albumTitle),
    str(d.genre),
    num(d.year),
    num(d.trackNumber),
    num(d.discNumber),
    str(d.composer),
  ];
}

function applyRecord(song, rec) {
  return {
    ...song,
    title: rec[0] || song.fileTitle,
    artist: rec[1],
    albumArtist: rec[2],
    album: rec[3],
    genre: rec[4],
    year: rec[5],
    track: rec[6],
    disc: rec[7],
    composer: rec[8],
    hasMeta: true,
  };
}

// ---------- MKA bundles (one file holding an original song and its remixes / edits) ----------
const Mka = NativeModules ? NativeModules.Mka : null;

function mkaFilePath(uri) {
  const p = String(uri).replace(/^file:\/\//, '');
  try {
    return decodeURI(p);
  } catch (e) {
    return p;
  }
}

// Turns one .mka file into one song per version, so every version shows up in the normal song list.
async function mkaVersions(a) {
  const out = [];
  if (!Mka || typeof Mka.list !== 'function') return out;
  try {
    const info = JSON.parse(await Mka.list(mkaFilePath(a.uri)));
    const bundleTitle = str(info.title) || cleanTitle(a.filename);
    const tracks = info.tracks || [];
    for (const tr of tracks) {
      const name = str(tr.name) || 'Version ' + tr.number;
      const title = bundleTitle + ' - ' + name;
      out.push({
        id: 'mka_' + String(a.id) + '_' + tr.number,
        uri: a.uri,
        filename: a.filename || '',
        fileTitle: title,
        title: title,
        artist: '',
        albumArtist: '',
        album: bundleTitle,
        genre: '',
        year: 0,
        track: tr.number,
        disc: 0,
        composer: '',
        duration: (info.durationMs || 0) / 1000,
        added: a.creationTime || a.modificationTime || 0,
        hasMeta: true,
        mka: { path: mkaFilePath(a.uri), track: tr.number },
      });
    }
  } catch (e) {}
  return out;
}

// ---------- Finding songs ----------
export async function scanSongs() {
  const list = [];
  let after = undefined;
  let hasNext = true;
  while (hasNext) {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.audio,
      first: 1000,
      after: after,
    });
    for (const a of page.assets) {
      if (/\.mka$/i.test(a.filename || '')) {
        const versions = await mkaVersions(a);
        for (const v of versions) list.push(withEdit(v));
        continue;
      }
      if (!(a.duration > 0) || a.duration >= MIN_SECONDS) {
        const fileTitle = cleanTitle(a.filename);
        const base = {
          id: String(a.id),
          uri: a.uri,
          filename: a.filename || '',
          fileTitle: fileTitle,
          title: fileTitle,
          artist: '',
          albumArtist: '',
          album: '',
          genre: '',
          year: 0,
          track: 0,
          disc: 0,
          composer: '',
          duration: a.duration || 0,
          added: a.creationTime || a.modificationTime || 0,
          hasMeta: false,
        };
        const rec = metaCache[base.id];
        list.push(withEdit(rec ? applyRecord(base, rec) : base));
      }
    }
    hasNext = page.hasNextPage;
    after = page.endCursor;
  }
  return list;
}

// ---------- Reading song info (artist, album, ...) ----------
const FIELDS = [
  'title',
  'artist',
  'albumArtist',
  'albumTitle',
  'genre',
  'year',
  'trackNumber',
  'discNumber',
  'composer',
];

async function readMany(uris) {
  const map = new Map();
  if (typeof Meta.getBulkMetadata === 'function') {
    const res = await Meta.getBulkMetadata(uris, FIELDS);
    const results = res && res.results ? res.results : [];
    const errors = res && res.errors ? res.errors : [];
    results.forEach((r) => {
      if (r && r.uri) map.set(r.uri, r.data || {});
    });
    if (errors.length > 0) {
      const first = errors[0] && errors[0].data ? errors[0].data : null;
      diag.lastError = first ? str(first.name) + ': ' + str(first.message) : 'unknown error';
    }
    if (map.size === 0 && results.length === uris.length) {
      results.forEach((r, i) => map.set(uris[i], (r && r.data) || {}));
    }
    return map;
  }
  for (const u of uris) {
    try {
      map.set(u, await Meta.getMetadata(u, FIELDS));
    } catch (e) {
      diag.lastError = errText(e);
    }
  }
  return map;
}

function hasContent(rec) {
  return !!(rec[0] || rec[1] || rec[2] || rec[3] || rec[4] || rec[5]);
}

// Puts the original details back on a song, then puts your own changes on top.
export function refreshSong(song) {
  if (song.mka) return song; // bundle versions keep the details stored inside the bundle
  const rec = metaCache[song.id];
  let base = { ...song, edited: false, coverKey: undefined, lyricsEdit: undefined };
  if (rec) {
    base = applyRecord(base, rec);
  } else {
    base = {
      ...base,
      title: song.fileTitle,
      artist: '',
      albumArtist: '',
      album: '',
      genre: '',
      year: 0,
      track: 0,
      disc: 0,
      composer: '',
    };
  }
  return withEdit(base);
}

// Reads info for songs that are not in the cache yet. Calls onUpdate now and then with the newest list.
// First the song details library is asked. Songs it could not read are read by the backup reader.
export async function enrichSongs(list, isCancelled, onUpdate) {
  if (!Meta && !TAG_READER_AVAILABLE) return list;
  const todo = [];
  list.forEach((s, i) => {
    if (!s.hasMeta) todo.push(i);
  });
  const out = list.slice();
  if (todo.length === 0) return out;

  const CHUNK = 40;
  let chunkNo = 0;
  for (let p = 0; p < todo.length; p += CHUNK) {
    if (isCancelled()) return out;
    const idxs = todo.slice(p, p + CHUNK);
    const uris = idxs.map((i) => out[i].uri);
    const recs = new Array(idxs.length).fill(null);
    const checked = new Array(idxs.length).fill(false); // true when some reader really looked at the file

    if (Meta) {
      try {
        const map = await readMany(uris);
        idxs.forEach((i, k) => {
          const d = map.get(uris[k]);
          if (d) {
            checked[k] = true;
            const rec = makeRecord(d);
            if (hasContent(rec)) {
              recs[k] = rec;
              diag.metaOk++;
            }
          }
        });
      } catch (e) {
        diag.lastError = errText(e);
      }
    }

    if (TAG_READER_AVAILABLE) {
      const need = [];
      recs.forEach((r, k) => {
        if (!r) need.push(k);
      });
      let cursor = 0;
      const worker = async () => {
        while (cursor < need.length) {
          const k = need[cursor++];
          try {
            const d = await readTagsJs(out[idxs[k]]);
            checked[k] = true;
            if (d) {
              const rec = makeRecord(d);
              if (hasContent(rec)) {
                recs[k] = rec;
                diag.metaJs++;
              }
            }
          } catch (e) {
            diag.lastError = 'backup: ' + errText(e);
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    }

    idxs.forEach((i, k) => {
      let rec = recs[k];
      if (!rec && checked[k]) {
        rec = makeRecord({}); // the file really has no tags
        diag.metaNone++;
      }
      if (rec) {
        metaCache[out[i].id] = rec;
        out[i] = withEdit(applyRecord(out[i], rec));
      } else {
        diag.metaFail++;
      }
    });
    chunkNo++;
    if (chunkNo % 3 === 0) {
      persistMetaSoon();
      if (onUpdate) onUpdate(out.slice(), Math.min(p + CHUNK, todo.length), todo.length);
    }
  }
  persistMetaSoon();
  return out;
}

// ---------- Cover art ----------
export function getCachedArt(song) {
  const ec = getEditCover(song.id); // your own cover (or "no cover") wins
  if (ec !== undefined) return ec;
  return artMap.has(song.id) ? artMap.get(song.id) : undefined;
}

export function invalidateArt(id) {
  artMap.delete(id);
  artSoft.delete(id);
  skipLib.add(id);
}

const artListeners = new Map(); // id -> Set of callbacks
const artJobs = new Map(); // id -> song
const artStack = []; // waiting ids, newest on top
const artRunning = new Set();

function fileUri(u) {
  if (!u) return null;
  return String(u).indexOf('://') >= 0 ? String(u) : 'file://' + u;
}

async function runArtJob(id) {
  const song = artJobs.get(id);
  let result = null;
  let hadError = false;
  if (song) {
    // 1) the song details library
    if (Meta && typeof Meta.saveArtwork === 'function' && !skipLib.has(id)) {
      try {
        const opts = { compress: 0.85 };
        if (Meta.SaveFormat && Meta.SaveFormat.JPEG) opts.format = Meta.SaveFormat.JPEG;
        const saved = await Meta.saveArtwork(song.uri, opts);
        result = fileUri(saved);
      } catch (e) {
        hadError = true;
        diag.lastArtError = errText(e);
      }
    }
    // 2) backup: read the picture straight from the file
    if (!result && EMBEDDED_ART_AVAILABLE) {
      try {
        const r = await extractEmbeddedArt(song);
        if (r) {
          result = r;
          diag.artJs++;
        }
      } catch (e) {
        hadError = true;
        diag.lastArtError = 'backup: ' + errText(e);
      }
    }
    if (result) diag.artSaved++;
    else if (hadError) diag.artFail++;
    else diag.artNone++;
  }
  if (!result && hadError) artSoft.add(id);
  artMap.set(id, result);
  persistArtSoon();
  const set = artListeners.get(id);
  artListeners.delete(id);
  artJobs.delete(id);
  artRunning.delete(id);
  if (set) {
    set.forEach((cb) => {
      try {
        cb(result);
      } catch (e) {}
    });
  }
  pumpArt();
}

function pumpArt() {
  while (artRunning.size < 3 && artStack.length > 0) {
    const id = artStack.pop();
    if (!artJobs.has(id)) continue;
    artRunning.add(id);
    runArtJob(id);
  }
}

// Asks for a song's cover. Calls cb(uri or null) when ready. Returns a function that cancels.
export function loadArt(song, cb) {
  if (song.mka) {
    cb(null);
    return () => {};
  }
  const ec = getEditCover(song.id);
  if (ec !== undefined) {
    cb(ec);
    return () => {};
  }
  if (artMap.has(song.id)) {
    cb(artMap.get(song.id));
    return () => {};
  }
  if ((!Meta || typeof Meta.saveArtwork !== 'function') && !EMBEDDED_ART_AVAILABLE) {
    cb(null);
    return () => {};
  }
  let set = artListeners.get(song.id);
  if (!set) {
    set = new Set();
    artListeners.set(song.id, set);
    artJobs.set(song.id, song);
    artStack.push(song.id);
  } else if (!artRunning.has(song.id)) {
    const at = artStack.indexOf(song.id);
    if (at >= 0) artStack.splice(at, 1);
    artStack.push(song.id);
  }
  set.add(cb);
  pumpArt();
  return () => {
    const current = artListeners.get(song.id);
    if (!current) return;
    current.delete(cb);
    if (current.size === 0 && !artRunning.has(song.id)) {
      artListeners.delete(song.id);
      artJobs.delete(song.id);
      const at = artStack.indexOf(song.id);
      if (at >= 0) artStack.splice(at, 1);
    }
  };
}

// ---------- Lyrics and details of one song ----------
export async function fetchLyrics(uri) {
  if (!Meta || typeof Meta.getLyric !== 'function') {
    return { text: '', error: 'Lyrics reader is not part of this build.' };
  }
  try {
    const text = await Meta.getLyric(uri);
    return { text: text || '', error: '' };
  } catch (e) {
    return { text: '', error: errText(e) };
  }
}

export async function fetchDetails(uri) {
  if (!Meta || typeof Meta.getMetadata !== 'function') return null;
  try {
    return await Meta.getMetadata(uri, [
      'title',
      'artist',
      'albumArtist',
      'albumTitle',
      'genre',
      'year',
      'trackNumber',
      'totalTrackCount',
      'discNumber',
      'composer',
      'bitrate',
      'sampleRate',
      'channelCount',
      'codecs',
    ]);
  } catch (e) {
    return { _error: errText(e) };
  }
}
