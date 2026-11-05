// Remembers how you listen (plays, skips, time of day) and what the online lookup learned about your artists.
// Everything is saved inside the app only. Nothing here touches the songs on the phone.
let AS = null;
try {
  const mod = require('@react-native-async-storage/async-storage');
  AS = mod.default || mod;
} catch (e) {
  AS = null;
}

const TASTE_KEY = 'mm_taste_v1';
const TAGS_KEY = 'mm_artist_tags_v1';
const META_KEY = 'mm_foryou_meta_v1';

// taste.plays: { songId: { n: completed plays, sk: skips, last: ms, first: ms, sl: [night, morning, afternoon, evening] } }
let taste = { plays: {} };
// artistTags: { artistKey: [[tag, weight], ...] }  or  { artistKey: 0 } when nothing was found (retried after 30 days)
let artistTags = {};
let artistTagsTime = {}; // artistKey -> when it was looked up
// meta: { refresh: number, shown: { playlistId: [timestamps] } }
let meta = { refresh: 0, shown: {} };
let loaded = false;
let timers = {};

function later(key, fn) {
  if (timers[key]) return;
  timers[key] = setTimeout(() => {
    timers[key] = null;
    fn();
  }, 2500);
}

async function read(key, fallback) {
  try {
    const raw = AS ? await AS.getItem(key) : null;
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return fallback;
}

async function write(key, value) {
  try {
    if (AS) await AS.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

export async function loadForYouData() {
  if (loaded) return;
  const t = await read(TASTE_KEY, { plays: {} });
  taste = t && t.plays ? t : { plays: {} };
  const a = await read(TAGS_KEY, { tags: {}, time: {} });
  artistTags = a && a.tags ? a.tags : {};
  artistTagsTime = a && a.time ? a.time : {};
  const m = await read(META_KEY, { refresh: 0, shown: {} });
  meta = m && m.shown ? m : { refresh: 0, shown: {} };
  loaded = true;
}

export function slotOfHour(h) {
  if (h >= 22 || h < 5) return 0; // night
  if (h < 12) return 1; // morning
  if (h < 18) return 2; // afternoon
  return 3; // evening
}

export function getTaste() {
  return taste;
}

export function recordListen(id, kind, startedAt) {
  // kind: 'play' (listened to most of it) or 'skip' (left within the first part)
  if (!id) return;
  const e = taste.plays[id] || { n: 0, sk: 0, last: 0, first: 0, sl: [0, 0, 0, 0] };
  const when = startedAt || Date.now();
  if (kind === 'play') {
    e.n += 1;
    e.last = when;
    if (!e.first) e.first = when;
    const sl = slotOfHour(new Date(when).getHours());
    e.sl[sl] = (e.sl[sl] || 0) + 1;
  } else if (kind === 'skip') {
    e.sk += 1;
  }
  taste.plays[id] = e;
  later('taste', () => write(TASTE_KEY, taste));
}

export function getArtistTags() {
  return artistTags;
}

export function hasArtistTags(key) {
  return Object.prototype.hasOwnProperty.call(artistTags, key);
}

export function artistTagsAge(key) {
  return artistTagsTime[key] || 0;
}

export function setArtistTags(key, tags) {
  artistTags[key] = tags && tags.length > 0 ? tags : 0;
  artistTagsTime[key] = Date.now();
  later('tags', () => write(TAGS_KEY, { tags: artistTags, time: artistTagsTime }));
}

export function flushNow() {
  write(TASTE_KEY, taste);
  write(TAGS_KEY, { tags: artistTags, time: artistTagsTime });
  write(META_KEY, meta);
}

export function getMeta() {
  return meta;
}

export function bumpRefresh() {
  meta.refresh = (meta.refresh || 0) + 1;
  later('meta', () => write(META_KEY, meta));
  return meta.refresh;
}

// Remembers that a playlist was shown, so tomorrow's choice can favour fresh ones.
export function markShown(ids) {
  const now = Date.now();
  const cutoff = now - 5 * 86400000;
  for (const id of ids) {
    const list = (meta.shown[id] || []).filter((x) => x > cutoff);
    const last = list.length > 0 ? list[list.length - 1] : 0;
    if (now - last > 6 * 3600000) list.push(now);
    meta.shown[id] = list;
  }
  later('meta', () => write(META_KEY, meta));
}
