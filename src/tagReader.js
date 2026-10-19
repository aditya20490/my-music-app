// Reads title, artist, album, genre, year, track... straight from the song file (MP3 / FLAC / M4A).
// It works on its own, so song details show up even if the "song details" library is missing or fails.
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
if (FS && typeof FS.readAsStringAsync !== 'function') FS = null;

export const TAG_READER_AVAILABLE = !!FS;

const WIN = 32 * 1024; // first part of the file that is read in one go

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOK = new Uint8Array(256).fill(255);
for (let i = 0; i < B64.length; i++) LOOK[B64.charCodeAt(i)] = i;

function decode64(b64) {
  let len = b64.length;
  while (len > 0 && b64.charCodeAt(len - 1) === 61) len--;
  const out = new Uint8Array((len * 3) >> 2);
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const v = LOOK[b64.charCodeAt(i)];
    if (v === 255) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 255;
      buf &= (1 << bits) - 1;
    }
  }
  return out.subarray(0, o);
}

async function readBytes(uri, pos, len) {
  const b64 = await FS.readAsStringAsync(uri, { encoding: 'base64', position: pos, length: len });
  return b64 ? decode64(b64) : new Uint8Array(0);
}

function u32(b, o) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function syncsafe(b, o) {
  return ((b[o] & 127) << 21) | ((b[o + 1] & 127) << 14) | ((b[o + 2] & 127) << 7) | (b[o + 3] & 127);
}

function ascii(b, o, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i] || 0);
  return s;
}

// ---------- text decoders ----------
function latin1(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

function utf8(b) {
  let s = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i++];
    if (c < 0x80) {
      s += String.fromCharCode(c);
    } else if (c >= 0xc0 && c < 0xe0) {
      s += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63));
    } else if (c >= 0xe0 && c < 0xf0) {
      s += String.fromCharCode(((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63));
    } else if (c >= 0xf0) {
      const cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
      s += String.fromCodePoint(cp);
    }
  }
  return s;
}

function utf16(b, defaultLE) {
  let le = defaultLE;
  let i = 0;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    le = true;
    i = 2;
  } else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    le = false;
    i = 2;
  }
  let s = '';
  for (; i + 1 < b.length; i += 2) {
    s += String.fromCharCode(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  }
  return s;
}

function decodeText(enc, b) {
  let s;
  if (enc === 1) s = utf16(b, true);
  else if (enc === 2) s = utf16(b, false);
  else if (enc === 3) s = utf8(b);
  else s = latin1(b);
  return s
    .split('\0')
    .map((x) => x.replace(/^\uFEFF/, '').trim())
    .filter(Boolean)
    .join('; ');
}

const GENRES = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal',
  'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial',
  'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk',
  'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
  'Alt. Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic',
  'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta',
  'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes',
  'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock',
];

function fixGenre(g) {
  const s = String(g || '').trim();
  let m = s.match(/^\(?(\d{1,3})\)?$/);
  if (m) return GENRES[parseInt(m[1], 10)] || '';
  m = s.match(/^\(\d{1,3}\)(.+)$/);
  if (m) return m[1].trim();
  return s;
}

function firstInt(s) {
  const m = String(s || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

// Turns what was found into the shape the app expects.
function finish(raw) {
  const yearMatch = String(raw.year || '').match(/\d{4}/);
  return {
    title: raw.title || '',
    artist: raw.artist || '',
    albumArtist: raw.albumArtist || '',
    albumTitle: raw.albumTitle || '',
    genre: fixGenre(raw.genre),
    year: yearMatch ? parseInt(yearMatch[0], 10) : 0,
    trackNumber: firstInt(raw.trackNumber),
    discNumber: firstInt(raw.discNumber),
    composer: raw.composer || '',
  };
}

function hasAny(raw) {
  return !!(raw && (raw.title || raw.artist || raw.albumArtist || raw.albumTitle || raw.genre || raw.year));
}

// ---------- MP3 (ID3v2) ----------
const ID3_NEW = {
  TIT2: 'title',
  TPE1: 'artist',
  TPE2: 'albumArtist',
  TALB: 'albumTitle',
  TDRC: 'year',
  TYER: 'year',
  TRCK: 'trackNumber',
  TPOS: 'discNumber',
  TCON: 'genre',
  TCOM: 'composer',
};
const ID3_OLD = {
  TT2: 'title',
  TP1: 'artist',
  TP2: 'albumArtist',
  TAL: 'albumTitle',
  TYE: 'year',
  TRK: 'trackNumber',
  TPA: 'discNumber',
  TCO: 'genre',
  TCM: 'composer',
};

async function fromId3(rd) {
  const head = rd.head;
  const ver = head[3];
  if (ver < 2 || ver > 4) return null;
  const flags = head[5];
  const end = 10 + syncsafe(head, 6);
  let pos = 10;
  if (flags & 0x40 && ver >= 3) {
    const eh = await rd.get(10, 4);
    pos += ver === 4 ? syncsafe(eh, 0) : u32(eh, 0) + 4;
  }
  const hl = ver === 2 ? 6 : 10;
  const WANT = ver === 2 ? ID3_OLD : ID3_NEW;
  const out = {};
  for (let guard = 0; guard < 400 && pos + hl <= end; guard++) {
    const fh = await rd.get(pos, hl);
    if (fh.length < hl || fh[0] === 0) break;
    const id = ver === 2 ? ascii(fh, 0, 3) : ascii(fh, 0, 4);
    let size;
    let extra = 0;
    if (ver === 2) {
      size = (fh[3] << 16) | (fh[4] << 8) | fh[5];
    } else if (ver === 4) {
      size = syncsafe(fh, 4);
      if (fh[9] & 1) extra = 4;
    } else {
      size = u32(fh, 4);
    }
    if (size <= 0 || pos + hl + size > end + 16) break;
    const key = WANT[id];
    if (key && !out[key] && size - extra > 1 && size <= 8192) {
      const d = await rd.get(pos + hl + extra, size - extra);
      const text = decodeText(d[0], d.subarray(1));
      if (text) out[key] = text;
    }
    pos += hl + size;
  }
  return out;
}

// Old ID3v1 tag: the last 128 bytes of the file.
async function fromId3v1(uri) {
  const info = await FS.getInfoAsync(uri);
  const total = info && info.size ? info.size : 0;
  if (total < 200) return null;
  const t = await readBytes(uri, total - 128, 128);
  if (t.length < 128 || ascii(t, 0, 3) !== 'TAG') return null;
  const clean = (a, b) => latin1(t.subarray(a, b)).replace(/\0.*$/, '').trim();
  return {
    title: clean(3, 33),
    artist: clean(33, 63),
    albumTitle: clean(63, 93),
    year: clean(93, 97),
    genre: t[127] < GENRES.length ? GENRES[t[127]] : '',
  };
}

// ---------- FLAC (Vorbis comments) ----------
function parseVorbis(d) {
  const out = {};
  const le = (o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
  let p = 0;
  p += 4 + le(p);
  const n = le(p);
  p += 4;
  for (let i = 0; i < n && p + 4 <= d.length; i++) {
    const l = le(p);
    p += 4;
    if (p + l > d.length) break;
    const s = utf8(d.subarray(p, p + l));
    p += l;
    const e = s.indexOf('=');
    if (e > 0) {
      const k = s.slice(0, e).toUpperCase();
      const v = s.slice(e + 1).trim();
      if (v) out[k] = out[k] ? out[k] + '; ' + v : v;
    }
  }
  return out;
}

async function fromFlac(rd) {
  let pos = 4;
  for (let guard = 0; guard < 64; guard++) {
    const bh = await rd.get(pos, 4);
    if (bh.length < 4) break;
    const last = bh[0] & 0x80;
    const type = bh[0] & 0x7f;
    const len = (bh[1] << 16) | (bh[2] << 8) | bh[3];
    if (type === 4) {
      const d = await rd.get(pos + 4, Math.min(len, 200000));
      const v = parseVorbis(d);
      return {
        title: v.TITLE,
        artist: v.ARTIST,
        albumArtist: v.ALBUMARTIST || v['ALBUM ARTIST'],
        albumTitle: v.ALBUM,
        genre: v.GENRE,
        year: v.DATE || v.YEAR,
        trackNumber: v.TRACKNUMBER,
        discNumber: v.DISCNUMBER,
        composer: v.COMPOSER,
      };
    }
    pos += 4 + len;
    if (last) break;
  }
  return null;
}

// ---------- M4A / MP4 ----------
async function atomAt(uri, pos) {
  const h = await readBytes(uri, pos, 16);
  if (h.length < 8) return null;
  let size = u32(h, 0);
  let hdr = 8;
  if (size === 1 && h.length >= 16) {
    size = u32(h, 8) * 4294967296 + u32(h, 12);
    hdr = 16;
  }
  return { size, type: ascii(h, 4, 4), hdr };
}

async function child(uri, start, end, type) {
  let pos = start;
  for (let guard = 0; guard < 600 && pos + 8 <= end; guard++) {
    const a = await atomAt(uri, pos);
    if (!a) return null;
    const size = a.size === 0 ? end - pos : a.size;
    if (size < 8) return null;
    if (a.type === type) return { pos, size, hdr: a.hdr };
    pos += size;
  }
  return null;
}

const MP4_MAP = {
  '\u00A9nam': 'title',
  '\u00A9ART': 'artist',
  aART: 'albumArtist',
  '\u00A9alb': 'albumTitle',
  '\u00A9gen': 'genre',
  '\u00A9day': 'year',
  '\u00A9wrt': 'composer',
  trkn: 'trackNumber',
  disk: 'discNumber',
};

async function fromMp4(uri) {
  const info = await FS.getInfoAsync(uri);
  const total = info && info.size ? info.size : 0;
  if (!total) return null;
  const moov = await child(uri, 0, total, 'moov');
  if (!moov) return null;
  const udta = await child(uri, moov.pos + moov.hdr, moov.pos + moov.size, 'udta');
  if (!udta) return null;
  const meta = await child(uri, udta.pos + udta.hdr, udta.pos + udta.size, 'meta');
  if (!meta) return null;
  const ilst = await child(uri, meta.pos + meta.hdr + 4, meta.pos + meta.size, 'ilst');
  if (!ilst) return null;
  const out = {};
  const end = ilst.pos + ilst.size;
  let pos = ilst.pos + ilst.hdr;
  for (let guard = 0; guard < 200 && pos + 8 <= end; guard++) {
    const a = await atomAt(uri, pos);
    if (!a || a.size < 8) break;
    const key = MP4_MAP[a.type];
    if (key) {
      const d = await readBytes(uri, pos, Math.min(a.size, 4096));
      const payload = d.subarray(24, Math.min(d.length, a.size));
      if (key === 'trackNumber' || key === 'discNumber') {
        const n = payload.length >= 4 ? (payload[2] << 8) | payload[3] : 0;
        if (n) out[key] = String(n);
      } else {
        const text = utf8(payload).trim();
        if (text) out[key] = text;
      }
    }
    pos += a.size;
  }
  return out;
}

// Returns { title, artist, albumArtist, albumTitle, genre, year, trackNumber, discNumber, composer } or null.
export async function readTagsJs(song) {
  if (!FS) return null;
  const uri = song.uri;
  const head = await readBytes(uri, 0, WIN);
  if (head.length < 8) return null;
  const rd = {
    head,
    async get(pos, len) {
      if (pos + len <= head.length) return head.subarray(pos, pos + len);
      if (head.length < WIN) return head.subarray(Math.min(pos, head.length), head.length);
      return readBytes(uri, pos, len);
    },
  };

  const isId3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;
  const isFlac = ascii(head, 0, 4) === 'fLaC';
  const isMp4 = ascii(head, 4, 4) === 'ftyp';

  let raw = null;
  if (isId3) raw = await fromId3(rd);
  else if (isFlac) raw = await fromFlac(rd);
  else if (isMp4) raw = await fromMp4(uri);

  if (!hasAny(raw) && !isFlac && !isMp4) {
    const v1 = await fromId3v1(uri);
    if (hasAny(v1)) raw = { ...(raw || {}), ...v1 };
  }
  return hasAny(raw) ? finish(raw) : null;
}
