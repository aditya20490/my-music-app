// Backup cover reader. Reads the picture stored inside MP3 (ID3), FLAC and M4A/MP4 files
// using only expo-file-system, so covers still work even if the "song details" library is not in the build.
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

export const EMBEDDED_ART_AVAILABLE = !!FS;

const MAX_IMAGE = 10 * 1024 * 1024;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOK = new Uint8Array(256).fill(255);
for (let i = 0; i < B64.length; i++) LOOK[B64.charCodeAt(i)] = i;

function decode(b64) {
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

async function readB64(uri, pos, len) {
  return FS.readAsStringAsync(uri, { encoding: 'base64', position: pos, length: len });
}

async function readBytes(uri, pos, len) {
  const b64 = await readB64(uri, pos, len);
  return b64 ? decode(b64) : new Uint8Array(0);
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

// Finds where the real picture bytes start (JPEG / PNG / WEBP) inside a small chunk.
function findImageStart(p) {
  for (let i = 0; i + 4 <= p.length; i++) {
    if (p[i] === 0xff && p[i + 1] === 0xd8 && p[i + 2] === 0xff) return { at: i, ext: 'jpg' };
    if (p[i] === 0x89 && p[i + 1] === 0x50 && p[i + 2] === 0x4e && p[i + 3] === 0x47) return { at: i, ext: 'png' };
    if (p[i] === 0x52 && p[i + 1] === 0x49 && p[i + 2] === 0x46 && p[i + 3] === 0x46) return { at: i, ext: 'webp' };
  }
  return null;
}

// ---------- MP3 (ID3v2) ----------
function picTypeOf(p, ver) {
  let i = 1;
  if (ver === 2) {
    i = 4;
  } else {
    while (i < p.length && p[i] !== 0) i++;
    i++;
  }
  return p[i];
}

async function fromId3(uri, head) {
  const ver = head[3];
  const flags = head[5];
  const tagSize = syncsafe(head, 6);
  const end = 10 + tagSize;
  let pos = 10;
  if (flags & 0x40 && ver >= 3) {
    const eh = await readBytes(uri, 10, 4);
    pos += ver === 4 ? syncsafe(eh, 0) : u32(eh, 0) + 4;
  }
  const hdrLen = ver === 2 ? 6 : 10;
  let best = null;
  for (let guard = 0; guard < 300 && pos + hdrLen <= end; guard++) {
    const fh = await readBytes(uri, pos, hdrLen);
    if (fh.length < hdrLen || fh[0] === 0) break;
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
    if (size <= 0 || pos + hdrLen + size > end + 16) break;
    if (id === 'APIC' || id === 'PIC') {
      const dataPos = pos + hdrLen + extra;
      const dataLen = size - extra;
      const probe = await readBytes(uri, dataPos, Math.min(dataLen, 600));
      const img = findImageStart(probe);
      if (img) {
        const cand = { pos: dataPos + img.at, len: dataLen - img.at, ext: img.ext };
        if (picTypeOf(probe, ver) === 3) return cand;
        if (!best) best = cand;
      }
    }
    pos += hdrLen + size;
  }
  return best;
}

// ---------- FLAC ----------
async function fromFlac(uri) {
  let pos = 4;
  let best = null;
  for (let guard = 0; guard < 64; guard++) {
    const bh = await readBytes(uri, pos, 4);
    if (bh.length < 4) break;
    const last = bh[0] & 0x80;
    const type = bh[0] & 0x7f;
    const len = (bh[1] << 16) | (bh[2] << 8) | bh[3];
    if (type === 6) {
      const p = await readBytes(uri, pos + 4, Math.min(len, 2048));
      const picT = u32(p, 0);
      const ml = u32(p, 4);
      let o = 8 + ml;
      const dl = u32(p, o);
      o += 4 + dl + 16;
      const dataLen = u32(p, o);
      o += 4;
      if (dataLen > 0 && o < len) {
        const probe = await readBytes(uri, pos + 4 + o, 16);
        const img = findImageStart(probe);
        const cand = { pos: pos + 4 + o, len: dataLen, ext: img ? img.ext : 'jpg' };
        if (picT === 3) return cand;
        if (!best) best = cand;
      }
    }
    pos += 4 + len;
    if (last) break;
  }
  return best;
}

// ---------- M4A / MP4 ----------
async function readAtom(uri, pos) {
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

async function findChild(uri, start, end, type) {
  let pos = start;
  for (let guard = 0; guard < 600 && pos + 8 <= end; guard++) {
    const a = await readAtom(uri, pos);
    if (!a) return null;
    const size = a.size === 0 ? end - pos : a.size;
    if (size < 8) return null;
    if (a.type === type) return { pos, size, hdr: a.hdr };
    pos += size;
  }
  return null;
}

async function fromMp4(uri) {
  const info = await FS.getInfoAsync(uri);
  const total = info && info.size ? info.size : 0;
  if (!total) return null;
  const moov = await findChild(uri, 0, total, 'moov');
  if (!moov) return null;
  const udta = await findChild(uri, moov.pos + moov.hdr, moov.pos + moov.size, 'udta');
  if (!udta) return null;
  const meta = await findChild(uri, udta.pos + udta.hdr, udta.pos + udta.size, 'meta');
  if (!meta) return null;
  const ilst = await findChild(uri, meta.pos + meta.hdr + 4, meta.pos + meta.size, 'ilst');
  if (!ilst) return null;
  const covr = await findChild(uri, ilst.pos + ilst.hdr, ilst.pos + ilst.size, 'covr');
  if (!covr) return null;
  const data = await findChild(uri, covr.pos + covr.hdr, covr.pos + covr.size, 'data');
  if (!data) return null;
  const start = data.pos + data.hdr + 8;
  const len = data.size - data.hdr - 8;
  if (len <= 0) return null;
  const probe = await readBytes(uri, start, 16);
  const img = findImageStart(probe);
  return { pos: start, len, ext: img ? img.ext : 'jpg' };
}

let dirReady = false;

// Returns a file:// uri of the saved cover, or null when the file has no picture inside.
export async function extractEmbeddedArt(song) {
  if (!FS) return null;
  const uri = song.uri;
  const head = await readBytes(uri, 0, 12);
  if (head.length < 8) return null;

  let cand = null;
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    cand = await fromId3(uri, head);
  } else if (ascii(head, 0, 4) === 'fLaC') {
    cand = await fromFlac(uri);
  } else if (ascii(head, 4, 4) === 'ftyp') {
    cand = await fromMp4(uri);
  }
  if (!cand || cand.len <= 0 || cand.len > MAX_IMAGE) return null;

  const b64 = await readB64(uri, cand.pos, cand.len);
  if (!b64) return null;

  const dir = (FS.documentDirectory || FS.cacheDirectory) + 'covers/';
  if (!dirReady) {
    try {
      await FS.makeDirectoryAsync(dir, { intermediates: true });
    } catch (e) {}
    dirReady = true;
  }
  const safe = String(song.id).replace(/[^A-Za-z0-9_-]/g, '_');
  const out = dir + safe + '.' + cand.ext;
  await FS.writeAsStringAsync(out, b64, { encoding: 'base64' });
  return out;
}
