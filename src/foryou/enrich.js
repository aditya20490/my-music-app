// Asks the internet what each of your ARTISTS sounds like (genre, mood, language), once, and remembers it.
// It asks per artist, not per song, so 1300 songs is only a few hundred small requests.
// It runs quietly in the background, stops when offline, and continues next time. Songs are never uploaded.
import { LASTFM_API_KEY } from './config';
import * as Store from './store';

const JUNK = new Set([
  'seen live', 'favorites', 'favourites', 'favorite', 'favourite', 'love', 'awesome', 'beautiful', 'good',
  'albums i own', 'male vocalists', 'female vocalists', 'male vocalist', 'female vocalist', 'under 2000 listeners',
  'all', 'music', 'singer-songwriter', 'my music', 'cool', 'best', 'amazing', 'spotify', 'check out',
]);

const ALIASES = {
  'hip hop': 'hip-hop',
  'hiphop': 'hip-hop',
  'rap': 'hip-hop',
  'bollywood music': 'bollywood',
  'hindi': 'bollywood',
  'indian': 'bollywood',
  'chillout': 'chill',
  'relax': 'chill',
  'relaxing': 'chill',
  'mellow': 'chill',
  'romantic': 'romantic',
  'romance': 'romantic',
  'love songs': 'romantic',
  'electronica': 'electronic',
  'edm': 'electronic',
  'r&b': 'rnb',
  'r and b': 'rnb',
  'alternative': 'indie',
  'indie pop': 'indie',
  'indie rock': 'indie',
  'lo-fi': 'lofi',
  'lo fi': 'lofi',
  'melancholy': 'sad',
  'melancholic': 'sad',
  'heartbreak': 'sad',
  'dance': 'dance',
  'party': 'party',
  'workout': 'workout',
  'gym': 'workout',
};

export function normTag(raw) {
  let t = String(raw || '').toLowerCase().trim();
  if (!t || t.length > 24) return '';
  t = t.replace(/\s+/g, ' ');
  if (ALIASES[t]) t = ALIASES[t];
  if (JUNK.has(t)) return '';
  if (/^\d{4}$/.test(t)) return '';
  return t;
}

// "A, B & C", "A feat. B", "A x B" -> "A"
export function primaryName(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  return n.split(/\s*(?:,|&|;|\/|\sfeat\.?\s|\sft\.?\s|\sfeaturing\s|\sx\s|\swith\s)\s*/i)[0].trim();
}

export function artistKeyOf(name) {
  return primaryName(name).toLowerCase();
}

const status = { running: false, done: 0, total: 0, offline: false, source: LASTFM_API_KEY ? 'lastfm' : 'itunes' };
export function getEnrichStatus() {
  return { ...status };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getJson(url) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 12000) : null;
  try {
    const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (timer) clearTimeout(timer);
    if (!res.ok) {
      const err = new Error('http ' + res.status);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (e) {
    if (timer) clearTimeout(timer);
    throw e;
  }
}

async function lookupLastfm(name) {
  const url =
    'https://ws.audioscrobbler.com/2.0/?method=artist.gettoptags&autocorrect=1&format=json&artist=' +
    encodeURIComponent(name) +
    '&api_key=' +
    encodeURIComponent(LASTFM_API_KEY);
  const data = await getJson(url);
  const list = data && data.toptags && Array.isArray(data.toptags.tag) ? data.toptags.tag : [];
  const out = [];
  for (const t of list) {
    const tag = normTag(t.name);
    const count = Number(t.count) || 0;
    if (!tag || count < 15) continue;
    if (out.some((x) => x[0] === tag)) continue;
    out.push([tag, Math.min(1, count / 100)]);
    if (out.length >= 8) break;
  }
  return out;
}

async function lookupItunes(name) {
  const url = 'https://itunes.apple.com/search?media=music&entity=musicArtist&limit=1&term=' + encodeURIComponent(name);
  const data = await getJson(url);
  const r = data && data.results && data.results[0];
  if (!r || !r.primaryGenreName) return [];
  const tag = normTag(r.primaryGenreName);
  return tag ? [[tag, 1]] : [];
}

let runToken = 0;

// artistNames: list of display names (most songs first is best). Calls onProgress(done, total) now and then.
export async function enrichArtists(artistNames, onProgress) {
  if (status.running) return;
  await Store.loadForYouData();
  const myToken = ++runToken;
  const now = Date.now();
  const todo = [];
  const seen = new Set();
  for (const n of artistNames) {
    const key = artistKeyOf(n);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const has = Store.hasArtistTags(key);
    if (!has) todo.push([key, primaryName(n)]);
    else if (Store.getArtistTags()[key] === 0 && now - Store.artistTagsAge(key) > 30 * 86400000) todo.push([key, primaryName(n)]);
  }
  status.total = todo.length;
  status.done = 0;
  status.offline = false;
  if (todo.length === 0) return;
  status.running = true;
  const gap = LASTFM_API_KEY ? 260 : 3200; // iTunes allows roughly 20 requests a minute
  let failures = 0;
  for (let i = 0; i < todo.length; i++) {
    if (myToken !== runToken) break;
    const [key, name] = todo[i];
    try {
      const tags = LASTFM_API_KEY ? await lookupLastfm(name) : await lookupItunes(name);
      Store.setArtistTags(key, tags);
      failures = 0;
    } catch (e) {
      failures++;
      if (e && (e.status === 429 || e.status === 403)) {
        await sleep(30000);
        i--;
        if (failures > 4) break;
        continue;
      }
      if (failures >= 3) {
        status.offline = true; // no internet right now, try again next time the app opens
        break;
      }
    }
    status.done = i + 1;
    if (onProgress && (i % 12 === 0 || i === todo.length - 1)) onProgress(status.done, status.total);
    await sleep(gap);
  }
  status.running = false;
  Store.flushNow();
  if (onProgress) onProgress(status.done, status.total);
}
