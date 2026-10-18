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

export const SORT_OPTIONS = [
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'year', label: 'Year' },
  { key: 'genre', label: 'Genre' },
  { key: 'duration', label: 'Length' },
  { key: 'added', label: 'Date added' },
];

function low(v) {
  return v ? String(v).toLowerCase() : '';
}

// Returns the value to sort by, or null when the song has no value (those go last).
function sortKey(item, key) {
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
    default:
      return item.t || null;
  }
}

export function sortSongs(songs, key, dir) {
  const mul = dir === 'desc' ? -1 : 1;
  const arr = songs.map((s) => ({
    s,
    t: low(s.title),
    ar: low(s.artist),
    al: low(s.album),
    g: low(s.genre),
  }));
  arr.sort((x, y) => {
    const kx = sortKey(x, key);
    const ky = sortKey(y, key);
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

// Lyrics can be plain text or "synced" (LRC) with [mm:ss.xx] time tags.
export function parseLyrics(raw) {
  if (!raw) return { synced: false, lines: [] };
  const rawLines = String(raw).replace(/\r/g, '').split('\n');
  const synced = [];
  const plain = [];
  let hasTime = false;
  for (const line of rawLines) {
    const times = [];
    const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const mm = parseInt(m[1], 10);
      const ss = parseInt(m[2], 10);
      const frac = m[3] ? parseFloat('0.' + m[3]) : 0;
      times.push(mm * 60 + ss + frac);
    }
    const content = line.replace(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g, '').trim();
    if (times.length > 0) {
      hasTime = true;
      for (const t of times) synced.push({ t, text: content });
    } else if (/^\[(ar|ti|al|by|offset|length|au|re|ve|la):/i.test(line.trim())) {
      // LRC info tag line, skip it
    } else {
      plain.push({ t: null, text: line.trim() });
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
