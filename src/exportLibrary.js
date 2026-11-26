// Export Music Library (JSON). Reads every song's tags, real file info (size, format, codec, bitrate, sample rate,
// channels) and cover INFO (embedded yes/no, format, width, height - never the picture itself), in small chunks so the
// screen stays smooth, then saves one .json file into Downloads/Music Plus.
import { NativeModules, Platform, Image } from 'react-native';
import { readTagsJs, TAG_READER_AVAILABLE } from './tagReader';
import { getCachedArt } from './library';

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

// The "song details" library (same one the player uses). Optional: without it, the backup readers below are used.
let Meta = null;
try {
  Meta = require('@missingcore/react-native-metadata-retriever');
} catch (e) {
  Meta = null;
}

export const EXPORT_AVAILABLE = !!FS;

const HEAD = 32 * 1024; // first part of every file, read in one go
const CHUNK = 24; // songs per round, then the screen gets a breather
const EMPTY = new Uint8Array(0);

// ---------- small helpers (also used by the screen) ----------
export function fmtInt(n) {
  return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtBytes(b) {
  const n = b || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const two = (x) => (x < 10 ? '0' + x : String(x));
  return h > 0 ? h + ':' + two(m) + ':' + two(r) : m + ':' + two(r);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- reading bytes ----------
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
  try {
    const b64 = await FS.readAsStringAsync(uri, { encoding: 'base64', position: pos, length: len });
    return b64 ? decode64(b64) : EMPTY;
  } catch (e) {
    return EMPTY;
  }
}

function u32(b, o) {
  return (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0) || 0;
}
function u32le(b, o) {
  return (((b[o + 3] << 24) | (b[o + 2] << 16) | (b[o + 1] << 8) | b[o]) >>> 0) || 0;
}
function syncsafe(b, o) {
  return ((b[o] & 127) << 21) | ((b[o + 1] & 127) << 14) | ((b[o + 2] & 127) << 7) | (b[o + 3] & 127);
}
function ascii(b, o, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i] || 0);
  return s;
}

// Reads the start of the file once, and anything further only when it is really needed.
function makeReader(uri, head) {
  let win = null;
  let winPos = 0;
  return {
    head,
    peek(pos, len) {
      return pos < head.length ? head.subarray(pos, Math.min(head.length, pos + len)) : EMPTY;
    },
    async get(pos, len) {
      if (pos >= head.length) {
        if (head.length < HEAD) return EMPTY; // the whole file is already read
      } else if (pos + len <= head.length) {
        return head.subarray(pos, pos + len);
      } else if (head.length < HEAD) {
        return head.subarray(pos, head.length);
      }
      if (win && pos >= winPos && pos + len <= winPos + win.length) return win.subarray(pos - winPos, pos - winPos + len);
      const b = await readBytes(uri, pos, Math.max(len, 4096));
      win = b;
      winPos = pos;
      return b.subarray(0, Math.min(len, b.length));
    },
  };
}

// ---------- pictures: format and size from the first bytes ----------
function imageStart(p) {
  for (let i = 0; i + 4 <= p.length; i++) {
    if (p[i] === 0xff && p[i + 1] === 0xd8 && p[i + 2] === 0xff) return i;
    if (p[i] === 0x89 && p[i + 1] === 0x50 && p[i + 2] === 0x4e && p[i + 3] === 0x47) return i;
    if (p[i] === 0x52 && p[i + 1] === 0x49 && p[i + 2] === 0x46 && p[i + 3] === 0x46) return i;
    if (p[i] === 0x47 && p[i + 1] === 0x49 && p[i + 2] === 0x46) return i;
    if (p[i] === 0x42 && p[i + 1] === 0x4d && i === 0) return i;
  }
  return -1;
}

// Returns { format, width, height } (width / height null when they could not be read yet), or null when it is no picture.
function imageInfo(b) {
  if (!b || b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) {
        i += 2;
        continue;
      }
      const segLen = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { format: 'JPEG', height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      }
      if (segLen < 2) break;
      i += 2 + segLen;
    }
    return { format: 'JPEG', width: null, height: null };
  }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return b.length >= 24 ? { format: 'PNG', width: u32(b, 16), height: u32(b, 20) } : { format: 'PNG', width: null, height: null };
  }
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b.length >= 30) {
    const kind = ascii(b, 12, 4);
    if (kind === 'VP8 ') return { format: 'WEBP', width: ((b[26] | (b[27] << 8)) & 0x3fff), height: ((b[28] | (b[29] << 8)) & 0x3fff) };
    if (kind === 'VP8L') {
      return {
        format: 'WEBP',
        width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
        height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
      };
    }
    if (kind === 'VP8X') {
      return {
        format: 'WEBP',
        width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
      };
    }
    return { format: 'WEBP', width: null, height: null };
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b.length >= 10) {
    return { format: 'GIF', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  }
  if (b[0] === 0x42 && b[1] === 0x4d && b.length >= 26) {
    return { format: 'BMP', width: u32le(b, 18), height: Math.abs(u32le(b, 22) | 0) };
  }
  return null;
}

function formatFromMime(m) {
  const s = String(m || '').toLowerCase();
  if (s.indexOf('jp') >= 0) return 'JPEG';
  if (s.indexOf('png') >= 0) return 'PNG';
  if (s.indexOf('webp') >= 0) return 'WEBP';
  if (s.indexOf('gif') >= 0) return 'GIF';
  if (s.indexOf('bmp') >= 0) return 'BMP';
  return null;
}

// Gets the picture's size: first from what is already read, then (only for big JPEG headers) a bigger read.
async function measureImage(rd, pos, len) {
  let info = imageInfo(rd.peek(pos, Math.min(len, 65536)));
  if (!info || info.width == null) {
    const more = imageInfo(await rd.get(pos, Math.min(len, 131072)));
    if (more) info = more;
  }
  return info;
}

// ---------- MP3 (ID3v2) ----------
async function probeId3(rd, out, needAudio) {
  const head = rd.head;
  const ver = head[3];
  const flags = head[5];
  const end = 10 + syncsafe(head, 6) + (flags & 0x10 ? 10 : 0);
  let best = null;
  if (ver >= 2 && ver <= 4) {
    let pos = 10;
    if (flags & 0x40 && ver >= 3) {
      const eh = await rd.get(10, 4);
      pos += ver === 4 ? syncsafe(eh, 0) : u32(eh, 0) + 4;
    }
    const hl = ver === 2 ? 6 : 10;
    for (let g = 0; g < 250 && pos + hl <= end; g++) {
      const fh = await rd.get(pos, hl);
      if (fh.length < hl || fh[0] === 0) break;
      const id = ver === 2 ? ascii(fh, 0, 3) : ascii(fh, 0, 4);
      let size;
      let extra = 0;
      if (ver === 2) size = (fh[3] << 16) | (fh[4] << 8) | fh[5];
      else if (ver === 4) {
        size = syncsafe(fh, 4);
        if (fh[9] & 1) extra = 4;
      } else size = u32(fh, 4);
      if (size <= 0 || pos + hl + size > end + 16) break;
      if (id === 'APIC' || id === 'PIC') {
        const dataPos = pos + hl + extra;
        const dataLen = size - extra;
        const probe = await rd.get(dataPos, Math.min(dataLen, 600));
        const at = imageStart(probe);
        // picture type byte sits after the mime text
        let i = 1;
        if (ver === 2) i = 4;
        else {
          while (i < probe.length && probe[i] !== 0) i++;
          i++;
        }
        const picType = probe[i];
        const mime = ver === 2 ? ascii(probe, 1, 3) : ascii(probe, 1, Math.max(0, Math.min(40, i - 2)));
        let info = null;
        if (at >= 0) info = await measureImage(rd, dataPos + at, dataLen - at);
        const cand = {
          embedded: true,
          format: info ? info.format : formatFromMime(mime),
          width: info && info.width ? info.width : null,
          height: info && info.height ? info.height : null,
        };
        if (picType === 3) {
          best = cand;
          break;
        }
        if (!best) best = cand;
      }
      pos += hl + size;
    }
  }
  out.art = best || { embedded: false, format: null, width: null, height: null };
  if (needAudio) await probeMp3Frame(rd, end, out);
}

const MP3_SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

async function probeMp3Frame(rd, from, out) {
  const b = await rd.get(from, 4096);
  for (let i = 0; i + 4 <= b.length; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const ver = (b[i + 1] >> 3) & 3;
    const layer = (b[i + 1] >> 1) & 3;
    const brIdx = (b[i + 2] >> 4) & 15;
    const srIdx = (b[i + 2] >> 2) & 3;
    if (ver === 1 || layer === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    out.sampleRate = MP3_SR[ver][srIdx];
    out.channels = ((b[i + 3] >> 6) & 3) === 3 ? 1 : 2;
    return;
  }
}

// ---------- FLAC ----------
async function probeFlac(rd, out) {
  let pos = 4;
  let best = null;
  for (let g = 0; g < 64; g++) {
    const bh = await rd.get(pos, 4);
    if (bh.length < 4) break;
    const last = bh[0] & 0x80;
    const type = bh[0] & 0x7f;
    const len = (bh[1] << 16) | (bh[2] << 8) | bh[3];
    if (type === 0 && len >= 18) {
      const d = await rd.get(pos + 4, 18);
      if (d.length >= 18) {
        out.sampleRate = (d[10] << 12) | (d[11] << 4) | (d[12] >> 4);
        out.channels = ((d[12] >> 1) & 7) + 1;
        out.bitDepth = (((d[12] & 1) << 4) | (d[13] >> 4)) + 1;
      }
    } else if (type === 6) {
      const p = await rd.get(pos + 4, Math.min(len, 1024));
      if (p.length >= 32) {
        const picT = u32(p, 0);
        const ml = u32(p, 4);
        let o = 8 + ml;
        const mime = ascii(p, 8, Math.min(ml, 64));
        const dl = u32(p, o);
        o += 4 + dl;
        const w = o + 8 <= p.length ? u32(p, o) : 0;
        const h = o + 8 <= p.length ? u32(p, o + 4) : 0;
        const cand = { embedded: true, format: formatFromMime(mime), width: w || null, height: h || null };
        if (picT === 3) best = cand;
        else if (!best) best = cand;
      }
    }
    pos += 4 + len;
    if (last) break;
  }
  out.art = best || { embedded: false, format: null, width: null, height: null };
}

// ---------- M4A / MP4 ----------
async function atomAt(rd, pos) {
  const h = await rd.get(pos, 16);
  if (h.length < 8) return null;
  let size = u32(h, 0);
  let hdr = 8;
  if (size === 1 && h.length >= 16) {
    size = u32(h, 8) * 4294967296 + u32(h, 12);
    hdr = 16;
  }
  return { size, type: ascii(h, 4, 4), hdr };
}

async function childAtom(rd, start, end, type) {
  let pos = start;
  for (let g = 0; g < 600 && pos + 8 <= end; g++) {
    const a = await atomAt(rd, pos);
    if (!a) return null;
    const size = a.size === 0 ? end - pos : a.size;
    if (size < 8) return null;
    if (a.type === type) return { pos, size, hdr: a.hdr };
    pos += size;
  }
  return null;
}

async function probeMp4(rd, total, out) {
  out.art = { embedded: false, format: null, width: null, height: null };
  if (!total) return;
  const moov = await childAtom(rd, 0, total, 'moov');
  if (!moov) return;
  const udta = await childAtom(rd, moov.pos + moov.hdr, moov.pos + moov.size, 'udta');
  if (!udta) return;
  const meta = await childAtom(rd, udta.pos + udta.hdr, udta.pos + udta.size, 'meta');
  if (!meta) return;
  const ilst = await childAtom(rd, meta.pos + meta.hdr + 4, meta.pos + meta.size, 'ilst');
  if (!ilst) return;
  const covr = await childAtom(rd, ilst.pos + ilst.hdr, ilst.pos + ilst.size, 'covr');
  if (!covr) return;
  const data = await childAtom(rd, covr.pos + covr.hdr, covr.pos + covr.size, 'data');
  if (!data) return;
  const start = data.pos + data.hdr + 8;
  const len = data.size - data.hdr - 8;
  if (len <= 0) return;
  const info = await measureImage(rd, start, len);
  out.art = {
    embedded: true,
    format: info ? info.format : null,
    width: info && info.width ? info.width : null,
    height: info && info.height ? info.height : null,
  };
}

// ---------- WAV ----------
function probeWav(head, out) {
  if (head.length >= 36 && ascii(head, 12, 4) === 'fmt ') {
    out.channels = head[22] | (head[23] << 8);
    out.sampleRate = u32le(head, 24);
    out.bitDepth = head[34] | (head[35] << 8);
  }
  out.art = { embedded: false, format: null, width: null, height: null };
}

function extOf(name) {
  const m = String(name || '').match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function detectFormat(head, ext) {
  if (head.length >= 12) {
    if (ascii(head, 0, 4) === 'fLaC') return 'FLAC';
    if (ascii(head, 0, 4) === 'OggS') return ascii(head, 0, Math.min(head.length, 200)).indexOf('OpusHead') >= 0 ? 'OPUS' : 'OGG';
    if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') return 'WAV';
    if (ascii(head, 0, 4) === 'FORM') return 'AIFF';
    if (ascii(head, 4, 4) === 'ftyp') return ext === 'mp4' ? 'MP4' : 'M4A';
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return ext === 'mka' ? 'MKA' : 'MKV/WEBM';
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return 'MP3';
    if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return (head[1] & 0xf6) === 0xf0 ? 'AAC' : 'MP3';
  }
  return ext ? ext.toUpperCase() : null;
}

// Looks inside one song file. Never throws.
async function probeFile(song, total, needAudio) {
  const out = { format: null, art: undefined, sampleRate: 0, channels: 0, bitDepth: 0 };
  const ext = extOf(song.filename);
  const head = await readBytes(song.uri, 0, HEAD);
  if (head.length < 8) {
    out.format = ext ? ext.toUpperCase() : null;
    return out;
  }
  out.format = detectFormat(head, ext);
  const rd = makeReader(song.uri, head);
  try {
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) await probeId3(rd, out, needAudio);
    else if (ascii(head, 0, 4) === 'fLaC') await probeFlac(rd, out);
    else if (ascii(head, 4, 4) === 'ftyp') await probeMp4(rd, total, out);
    else if (ascii(head, 0, 4) === 'RIFF') probeWav(head, out);
    else if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
      out.art = { embedded: false, format: null, width: null, height: null };
      if (needAudio) await probeMp3Frame(rd, 0, out);
    }
  } catch (e) {}
  return out;
}

// Other file types (OGG, OPUS, AAC, MKA...): use the cover the app already saved, if there is one.
function imageSize(uri) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const timer = setTimeout(() => finish(null), 3000);
    try {
      Image.getSize(
        uri,
        (w, h) => {
          clearTimeout(timer);
          finish({ width: w, height: h });
        },
        () => {
          clearTimeout(timer);
          finish(null);
        }
      );
    } catch (e) {
      clearTimeout(timer);
      finish(null);
    }
  });
}

async function artFromCache(song) {
  let c;
  try {
    c = getCachedArt(song);
  } catch (e) {
    c = undefined;
  }
  if (typeof c === 'string') {
    const dims = await imageSize(c);
    return {
      embedded: true,
      format: formatFromMime(extOf(c)) || null,
      width: dims ? dims.width : null,
      height: dims ? dims.height : null,
    };
  }
  if (c === null) return { embedded: false, format: null, width: null, height: null };
  return { embedded: null, format: null, width: null, height: null }; // not checked yet
}

// ---------- the song details library ----------
const FIELDS_BASE = ['title', 'artist', 'albumArtist', 'albumTitle', 'genre', 'year', 'trackNumber', 'discNumber', 'composer'];
const FIELDS_EXT = FIELDS_BASE.concat(['totalTrackCount', 'bitrate', 'sampleRate', 'channelCount', 'codecs']);
let extendedOk = true;

async function nativeRead(uris) {
  const map = new Map();
  if (!Meta || uris.length === 0) return map;
  const fields = extendedOk ? FIELDS_EXT : FIELDS_BASE;
  try {
    if (typeof Meta.getBulkMetadata === 'function') {
      const res = await Meta.getBulkMetadata(uris, fields);
      const results = res && res.results ? res.results : [];
      results.forEach((r) => {
        if (r && r.uri) map.set(r.uri, r.data || {});
      });
      if (map.size === 0 && results.length === uris.length) results.forEach((r, i) => map.set(uris[i], (r && r.data) || {}));
      return map;
    }
    for (const u of uris) {
      try {
        map.set(u, await Meta.getMetadata(u, fields));
      } catch (e) {}
    }
  } catch (e) {
    if (extendedOk) {
      extendedOk = false; // this phone's library does not know the extra fields: go on with the basic ones
      return nativeRead(uris);
    }
  }
  return map;
}

// ---------- turning values into clean JSON values ----------
const txt = (v) => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? null : s;
};
const pos = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isFinite(n) && n > 0 ? n : 0;
};
const intOrNull = (v) => {
  const n = Math.round(pos(v));
  return n > 0 ? n : null;
};

function hasTags(d) {
  return !!(d && (d.title || d.artist || d.albumArtist || d.albumTitle || d.genre || d.year));
}

function codecName(raw) {
  const c = String(raw || '').toLowerCase();
  if (!c) return null;
  if (c.indexOf('mp4a.40.2') >= 0) return 'AAC-LC';
  if (c.indexOf('mp4a.40.5') >= 0) return 'HE-AAC';
  if (c.indexOf('mp4a.40.29') >= 0) return 'HE-AACv2';
  if (c.indexOf('mp4a.40') >= 0 || c.indexOf('aac') >= 0) return 'AAC';
  if (c.indexOf('mp4a.6b') >= 0 || c.indexOf('mp4a.69') >= 0 || c.indexOf('mp3') >= 0 || c.indexOf('mpeg') >= 0) return 'MP3';
  if (c.indexOf('alac') >= 0) return 'ALAC';
  if (c.indexOf('flac') >= 0) return 'FLAC';
  if (c.indexOf('opus') >= 0) return 'Opus';
  if (c.indexOf('vorbis') >= 0) return 'Vorbis';
  if (c.indexOf('raw') >= 0 || c.indexOf('pcm') >= 0) return 'PCM';
  return String(raw);
}

function relPath(uri) {
  let p = String(uri || '').replace(/^file:\/\//, '');
  try {
    p = decodeURIComponent(p);
  } catch (e) {}
  return p.replace(/^\/storage\/emulated\/\d+\//, '');
}

function isoDate(ms) {
  const n = pos(ms);
  if (!n) return null;
  try {
    return new Date(n < 1e11 ? n * 1000 : n).toISOString();
  } catch (e) {
    return null;
  }
}

// ---------- one song -> one record ----------
async function buildRecord(song, nativeMap) {
  const isMka = !!song.mka || /\.mka$/i.test(song.filename || '');
  const ext = extOf(song.filename);

  // file level facts
  let size = 0;
  let modified = null;
  try {
    const info = await FS.getInfoAsync(song.uri);
    if (info && info.exists) {
      size = info.size > 0 ? info.size : 0;
      modified = info.modificationTime ? isoDate(info.modificationTime * 1000) : null;
    }
  } catch (e) {}

  // tags: the song file itself (not what you edited inside the app)
  let d = nativeMap.get(song.uri) || null;
  let tagsFrom = d && hasTags(d) ? 'file' : null;
  if (!tagsFrom && !isMka && TAG_READER_AVAILABLE) {
    try {
      const js = await readTagsJs(song);
      if (hasTags(js)) {
        d = { ...(d || {}), ...js };
        tagsFrom = 'file (backup reader)';
      }
    } catch (e) {}
  }
  if (!tagsFrom && isMka) {
    d = {
      title: song.title,
      artist: song.artist,
      albumArtist: song.albumArtist,
      albumTitle: song.album,
      genre: song.genre,
      year: song.year,
      trackNumber: song.track,
      discNumber: song.disc,
      composer: song.composer,
    };
    tagsFrom = 'mka bundle';
  }
  d = d || {};

  // audio facts
  let bitrate = pos(d.bitrate);
  if (bitrate >= 8000) bitrate = bitrate / 1000; // some readers give bits per second
  let sampleRate = pos(d.sampleRate);
  if (sampleRate > 0 && sampleRate < 1000) sampleRate *= 1000;
  let channels = pos(d.channelCount);
  const codecRaw = Array.isArray(d.codecs) ? d.codecs.join(', ') : txt(d.codecs);

  const needAudio = !sampleRate || !channels;
  const probe = isMka ? { format: 'MKA', art: undefined, sampleRate: 0, channels: 0, bitDepth: 0 } : await probeFile(song, size, needAudio);
  if (!sampleRate) sampleRate = probe.sampleRate;
  if (!channels) channels = probe.channels;
  const art = probe.art !== undefined ? probe.art : await artFromCache(song);

  const duration = pos(song.duration);
  const estimated = duration > 0 && size > 0 ? Math.round((size * 8) / duration / 1000) : null;
  const format = probe.format || (ext ? ext.toUpperCase() : null);
  let codec = codecName(codecRaw);
  if (!codec) codec = format === 'MP3' ? 'MP3' : format === 'FLAC' ? 'FLAC' : format === 'OPUS' ? 'Opus' : format === 'WAV' ? 'PCM' : null;

  const rec = {
    id: String(song.id),
    file_path: relPath(song.uri),
    file_name: song.filename || null,
    title: txt(d.title),
    artist: txt(d.artist),
    album: txt(d.albumTitle),
    album_artist: txt(d.albumArtist),
    genre: txt(d.genre),
    year: intOrNull(d.year),
    track_number: intOrNull(d.trackNumber),
    total_tracks: intOrNull(d.totalTrackCount),
    disc_number: intOrNull(d.discNumber),
    composer: txt(d.composer),
    duration: duration ? Math.round(duration * 100) / 100 : null,
    duration_formatted: duration ? fmtClock(duration) : null,
    bitrate: bitrate ? Math.round(bitrate) : null,
    bitrate_estimated: estimated,
    sample_rate: sampleRate ? Math.round(sampleRate) : null,
    channels: channels ? Math.round(channels) : null,
    bit_depth: probe.bitDepth || null,
    format: format,
    codec: codec,
    codec_raw: codecRaw,
    file_size: size || null,
    date_added: isoDate(song.added),
    date_modified: modified,
    tags_source: tagsFrom || 'none',
    edited_in_app: !!song.edited,
    album_art: {
      embedded: art.embedded,
      format: art.format || null,
      width: art.width || null,
      height: art.height || null,
    },
  };
  if (song.edited) {
    rec.app_overrides = {
      title: txt(song.title),
      artist: txt(song.artist),
      album: txt(song.album),
      album_artist: txt(song.albumArtist),
      genre: txt(song.genre),
      year: intOrNull(song.year),
      track_number: intOrNull(song.track),
      disc_number: intOrNull(song.disc),
      composer: txt(song.composer),
    };
  }
  if (song.versions && song.versions.length > 1) rec.bundle_versions = song.versions.map((v) => txt(v.versionLabel || v.title));
  return rec;
}

// ---------- the whole export ----------
// onProgress({ done, total, current }) after every round. isCancelled() is checked every round.
// Returns { cancelled: true, done } or { json, fileName, summary }.
export async function exportLibrary(songs, opts) {
  if (!FS) throw new Error('File access is not part of this build.');
  const onProgress = (opts && opts.onProgress) || (() => {});
  const isCancelled = (opts && opts.isCancelled) || (() => false);
  const total = songs.length;
  const t0 = Date.now();
  const lines = new Array(total);
  const stats = { bytes: 0, seconds: 0, withArt: 0, noArt: 0, artUnknown: 0, errors: 0, formats: {} };

  for (let p = 0; p < total; p += CHUNK) {
    if (isCancelled()) return { cancelled: true, done: p };
    const part = songs.slice(p, p + CHUNK);
    const uris = part.filter((s) => !(s.mka || /\.mka$/i.test(s.filename || ''))).map((s) => s.uri);
    let nativeMap = new Map();
    try {
      nativeMap = await nativeRead(uris);
    } catch (e) {}

    let cur = 0;
    const worker = async () => {
      while (cur < part.length) {
        const i = cur++;
        const song = part[i];
        let rec;
        try {
          rec = await buildRecord(song, nativeMap);
        } catch (e) {
          stats.errors++;
          rec = {
            id: String(song.id),
            file_path: relPath(song.uri),
            file_name: song.filename || null,
            error: e && e.message ? String(e.message).slice(0, 160) : 'could not read this file',
          };
        }
        lines[p + i] = JSON.stringify(rec);
        stats.bytes += rec.file_size || 0;
        stats.seconds += rec.duration || 0;
        if (rec.album_art) {
          if (rec.album_art.embedded === true) stats.withArt++;
          else if (rec.album_art.embedded === false) stats.noArt++;
          else stats.artUnknown++;
        }
        const f = rec.format || 'UNKNOWN';
        stats.formats[f] = (stats.formats[f] || 0) + 1;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    const last = part[part.length - 1];
    onProgress({ done: Math.min(p + CHUNK, total), total, current: last ? last.title || last.filename || '' : '' });
    await sleep(0); // a breather, so the screen keeps drawing smoothly
  }
  if (isCancelled()) return { cancelled: true, done: total };

  const info = {
    format_version: 1,
    generated_by: 'Music Plus',
    exported_at: new Date().toISOString(),
    platform: Platform.OS + ' ' + Platform.Version,
    song_count: total,
    total_file_size_bytes: stats.bytes,
    total_duration_seconds: Math.round(stats.seconds),
    songs_with_embedded_art: stats.withArt,
    songs_without_art: stats.noArt,
    songs_art_unknown: stats.artUnknown,
    songs_with_read_errors: stats.errors,
    formats: stats.formats,
    scan_seconds: Math.round((Date.now() - t0) / 100) / 10,
    notes: [
      'Tags are read from the song files themselves. Songs you edited inside the app also carry app_overrides.',
      'bitrate is in kbps (null when the reader could not tell). bitrate_estimated = file_size * 8 / duration.',
      'album_art never contains the picture itself: only whether it is embedded, its format and its size in pixels. embedded null = not checked.',
      'file_path is relative to the phone storage (Music/Folder/Song.mp3). id is the Android MediaStore id.',
    ],
  };
  const json = '{\n"export_info": ' + JSON.stringify(info, null, 2) + ',\n"songs": [\n' + lines.join(',\n') + '\n]\n}\n';

  const d = new Date();
  const two = (n) => (n < 10 ? '0' + n : String(n));
  const fileName =
    'music-library-' + d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + '_' + two(d.getHours()) + two(d.getMinutes()) + '.json';

  return {
    json,
    fileName,
    summary: {
      songs: total,
      bytes: stats.bytes,
      seconds: stats.seconds,
      withArt: stats.withArt,
      errors: stats.errors,
      formats: stats.formats,
      tookMs: Date.now() - t0,
    },
  };
}

// ---------- saving ----------
// 1) the app's own file saver -> Downloads/Music Plus   2) a folder you pick   3) inside the app (last resort)
export async function saveExport(json, fileName) {
  if (!FS) throw new Error('File access is not part of this build.');
  const cachePath = (FS.cacheDirectory || FS.documentDirectory) + fileName;
  await FS.writeAsStringAsync(cachePath, json);
  let size = json.length;
  try {
    const info = await FS.getInfoAsync(cachePath);
    if (info && info.size) size = info.size;
  } catch (e) {}

  const Native = NativeModules ? NativeModules.FileSaver : null;
  if (Native && typeof Native.save === 'function') {
    try {
      const where = await Native.save(cachePath, fileName, 'application/json', false);
      return { size, where: String(where || 'Download/Music Plus/' + fileName), via: 'downloads', fileName, cachePath };
    } catch (e) {}
  }

  const SAF = FS.StorageAccessFramework;
  if (SAF && Platform.OS === 'android') {
    try {
      const perm = await SAF.requestDirectoryPermissionsAsync();
      if (perm && perm.granted) {
        const uri = await SAF.createFileAsync(perm.directoryUri, fileName.replace(/\.json$/i, ''), 'application/json');
        await SAF.writeAsStringAsync(uri, json);
        return { size, where: 'The folder you picked / ' + fileName, via: 'folder', fileName, cachePath };
      }
    } catch (e) {}
  }
  return { size, where: 'Inside the app (could not reach Downloads)', via: 'app', fileName, cachePath };
}
