// Small helper functions (no phone-specific code in here).

const GRADIENTS = [
  ['#8B5CF6', '#EC4899'],
  ['#06B6D4', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
  ['#10B981', '#06B6D4'],
  ['#F43F5E', '#8B5CF6'],
  ['#84CC16', '#10B981'],
  ['#6366F1', '#EC4899'],
  ['#F97316', '#F59E0B'],
];

export function gradientFor(text) {
  const str = String(text || '?');
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return GRADIENTS[h % GRADIENTS.length];
}

export function cleanTitle(filename) {
  const noExt = String(filename || 'Unknown').replace(/\.[^/.]+$/, '');
  return noExt.replace(/_/g, ' ').trim() || 'Unknown';
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// The only sorting choices in the app
export const SORT_MODES = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'largest', label: 'Largest first' },
  { key: 'smallest', label: 'Smallest first' },
  { key: 'az', label: 'Name A to Z' },
  { key: 'za', label: 'Name Z to A' },
];

function low(v) {
  return v ? String(v).toLowerCase() : '';
}

// Returns the value to sort by, or null when the song has no value (those go last).
function sortKey(item, key, sizes) {
  const s = item.s;
  switch (key) {
    case 'artist':
      return item.ar || null;
    case 'album':
      return item.al || null;
    case 'genre':
      return item.g || null;
    case 'year':
      return s.year > 0 ? s.year : null;
    case 'duration':
      return s.duration > 0 ? s.duration : null;
    case 'added':
      return s.added > 0 ? s.added : null;
    case 'size': {
      const v = sizes ? sizes[s.id] : 0;
      return v > 0 ? v : null;
    }
    default:
      return item.t || null;
  }
}

export function sortSongs(songs, key, dir, sizes) {
  const mul = dir === 'desc' ? -1 : 1;
  const arr = songs.map((s) => ({
    s,
    t: low(s.title),
    ar: low(s.artist),
    al: low(s.album),
    g: low(s.genre),
  }));
  arr.sort((x, y) => {
    if (key === 'added') {
      // The number the phone gives a file keeps growing with every new file, so a bigger number = a newer file
      const nx = parseInt(x.s.id, 10);
      const ny = parseInt(y.s.id, 10);
      if (nx > 0 && ny > 0 && nx !== ny) return (nx - ny) * mul;
    }
    const kx = sortKey(x, key, sizes);
    const ky = sortKey(y, key, sizes);
    if (kx === null && ky !== null) return 1;
    if (kx !== null && ky === null) return -1;
    if (kx !== null && ky !== null && kx !== ky) {
      const r = typeof kx === 'string' ? kx.localeCompare(ky) : kx - ky;
      if (r !== 0) return r * mul;
    }
    if (key === 'artist') {
      const r = x.al.localeCompare(y.al);
      if (r !== 0) return r;
    }
    if (key === 'artist' || key === 'album') {
      const d = (x.s.disc || 0) - (y.s.disc || 0);
      if (d !== 0) return d;
      const tr = (x.s.track || 0) - (y.s.track || 0);
      if (tr !== 0) return tr;
    }
    return x.t.localeCompare(y.t);
  });
  return arr.map((i) => i.s);
}

// Sorts the way the options sheet says: newest, oldest, largest, smallest, A to Z, Z to A
export function sortByMode(songs, mode, sizes) {
  switch (mode) {
    case 'newest':
      return sortSongs(songs, 'added', 'desc');
    case 'oldest':
      return sortSongs(songs, 'added', 'asc');
    case 'largest':
      return sortSongs(songs, 'size', 'desc', sizes);
    case 'smallest':
      return sortSongs(songs, 'size', 'asc', sizes);
    case 'za':
      return sortSongs(songs, 'title', 'desc');
    default:
      return sortSongs(songs, 'title', 'asc');
  }
}

// Groups songs into albums or artists. mode: 'album' | 'artist'
export function groupSongs(songs, mode) {
  const map = new Map();
  for (const s of songs) {
    let key;
    let title;
    let sub;
    if (mode === 'album') {
      const who = s.albumArtist || s.artist || '';
      title = s.album || 'Unknown album';
      key = s.album ? low(s.album) + '|' + low(who) : '__unknown__';
      sub = s.album ? who || 'Unknown artist' : '';
    } else {
      title = s.artist || 'Unknown artist';
      key = s.artist ? low(s.artist) : '__unknown__';
      sub = '';
    }
    let g = map.get(key);
    if (!g) {
      g = { key, title, sub, unknown: key === '__unknown__', songs: [] };
      map.set(key, g);
    }
    g.songs.push(s);
  }
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.songs = sortSongs(g.songs, mode === 'album' ? 'album' : 'artist', 'asc');
  }
  groups.sort((a, b) => {
    if (a.unknown !== b.unknown) return a.unknown ? 1 : -1;
    return low(a.title).localeCompare(low(b.title));
  });
  return groups;
}

// ---------- Lyrics ----------
// Lyrics can be plain text or "synced" (LRC) with [mm:ss.xx] time tags.
// Some files even have word by word times like <mm:ss.xx> inside a line.

function toSeconds(mm, ss, frac) {
  const m = parseInt(mm, 10);
  const s = parseInt(ss, 10);
  const f = frac ? parseFloat('0.' + frac) : 0;
  return m * 60 + s + f;
}

// Splits a line with <mm:ss.xx> tags into words with their start time. Returns null if there are no word tags.
function parseWords(content, lineTime) {
  const re = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
  if (!re.test(content)) return null;
  const re2 = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
  const words = [];
  let m;
  let lastIdx = 0;
  let curT = lineTime;
  while ((m = re2.exec(content)) !== null) {
    const seg = content.slice(lastIdx, m.index);
    if (seg !== '') words.push({ t: curT, text: seg });
    curT = toSeconds(m[1], m[2], m[3]);
    lastIdx = re2.lastIndex;
  }
  const tail = content.slice(lastIdx);
  if (tail !== '') words.push({ t: curT, text: tail });
  return words.length > 0 ? words : null;
}

export function parseLyrics(raw) {
  if (!raw) return { synced: false, lines: [] };
  const rawLines = String(raw).replace(/\r/g, '').split('\n');
  const synced = [];
  const plain = [];
  let hasTime = false;
  const wordTag = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
  for (const line of rawLines) {
    const times = [];
    const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      times.push(toSeconds(m[1], m[2], m[3]));
    }
    const content = line.replace(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g, '');
    const text = content.replace(wordTag, '').replace(/\s+/g, ' ').trim();
    if (times.length > 0) {
      hasTime = true;
      const words = times.length === 1 ? parseWords(content.replace(/^\s+/, ''), times[0]) : null;
      for (const t of times) synced.push({ t, text, words });
    } else if (/^\[(ar|ti|al|by|offset|length|au|re|ve|la):/i.test(line.trim())) {
      // LRC info tag line, skip it
    } else {
      plain.push({ t: null, text: line.replace(wordTag, '').trim(), words: null });
    }
  }
  if (hasTime) {
    synced.sort((a, b) => a.t - b.t);
    return { synced: true, lines: synced };
  }
  // trim empty lines at the start and end of plain lyrics
  while (plain.length > 0 && plain[0].text === '') plain.shift();
  while (plain.length > 0 && plain[plain.length - 1].text === '') plain.pop();
  return { synced: false, lines: plain };
}

// Index of the lyric line that should be highlighted at this time (or -1).
export function lyricIndexAt(lines, time) {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  const t = (time || 0) + 0.25;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
