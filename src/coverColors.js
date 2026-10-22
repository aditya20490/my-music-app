// Finds the main color of a cover picture (and a second color if there is one).
// 1) the small Android helper (CoverColor.kt) if it is in the build
// 2) otherwise it reads the JPEG file itself, so it still works without the helper
import { NativeModules } from 'react-native';

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

const Native = NativeModules.CoverColor;
const cache = new Map();

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOK = new Uint8Array(256).fill(255);
for (let i = 0; i < B64.length; i++) LOOK[B64.charCodeAt(i)] = i;

function decode64(s) {
  let len = s.length;
  while (len > 0 && s.charCodeAt(len - 1) === 61) len--;
  const out = new Uint8Array((len * 3) >> 2);
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const v = LOOK[s.charCodeAt(i)];
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

function toHex(r, g, b) {
  const f = (x) => ('0' + Math.max(0, Math.min(255, Math.round(x))).toString(16)).slice(-2);
  return '#' + f(r) + f(g) + f(b);
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}

// samples = flat [r, g, b, r, g, b ...]
function dominant(samples) {
  const weight = new Array(12).fill(0);
  const sr = new Array(12).fill(0);
  const sg = new Array(12).fill(0);
  const sb = new Array(12).fill(0);
  let aR = 0;
  let aG = 0;
  let aB = 0;
  let total = 0;
  for (let i = 0; i + 2 < samples.length; i += 3) {
    const r = samples[i];
    const g = samples[i + 1];
    const b = samples[i + 2];
    aR += r;
    aG += g;
    aB += b;
    total++;
    const hsv = rgbToHsv(r, g, b);
    if (hsv[2] < 0.12 || hsv[1] < 0.18) continue;
    const w = hsv[1] * (0.35 + hsv[2]);
    const k = Math.floor(hsv[0] / 30) % 12;
    weight[k] += w;
    sr[k] += r * w;
    sg[k] += g * w;
    sb[k] += b * w;
  }
  if (!total) return null;
  let top = 0;
  for (let i = 1; i < 12; i++) if (weight[i] > weight[top]) top = i;
  if (weight[top] < total * 0.04) {
    const c = toHex(aR / total, aG / total, aB / total);
    return { main: c, second: c };
  }
  const col = (k) => toHex(sr[k] / weight[k], sg[k] / weight[k], sb[k] / weight[k]);
  let second = -1;
  for (let i = 0; i < 12; i++) {
    const d = Math.abs(i - top);
    if (d <= 1 || d >= 11) continue;
    if (second < 0 || weight[i] > weight[second]) second = i;
  }
  const main = col(top);
  return { main, second: second >= 0 && weight[second] > weight[top] * 0.35 ? col(second) : main };
}

// ---------- a tiny JPEG reader that only reads the average color of each 8x8 block ----------
function buildHuff(counts, symbols) {
  const mincode = [0];
  const maxcode = [-1];
  const valptr = [0];
  let code = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    const n = counts[l - 1];
    valptr[l] = k;
    mincode[l] = code;
    code += n;
    k += n;
    maxcode[l] = n ? code - 1 : -1;
    code <<= 1;
  }
  return { mincode, maxcode, valptr, symbols };
}

function decodeScan(b, start, comps, qt, dcT, acT, restart, W, H) {
  let pos = start;
  let cur = 0;
  let cnt = 0;
  let dead = false;
  const bit = () => {
    if (cnt === 0) {
      if (pos >= b.length) {
        dead = true;
        return 0;
      }
      let v = b[pos++];
      if (v === 0xff) {
        if (b[pos] === 0) {
          pos++;
        } else {
          pos--;
          dead = true;
          v = 0;
        }
      }
      cur = v;
      cnt = 8;
    }
    cnt--;
    return (cur >> cnt) & 1;
  };
  const huff = (t) => {
    let code = 0;
    for (let l = 1; l <= 16; l++) {
      code = (code << 1) | bit();
      if (t.maxcode[l] >= 0 && code <= t.maxcode[l] && code >= t.mincode[l]) {
        return t.symbols[t.valptr[l] + code - t.mincode[l]];
      }
    }
    return 0;
  };
  const recv = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | bit();
    return v;
  };
  const ext = (v, n) => (n === 0 ? 0 : v < 1 << (n - 1) ? v - (1 << n) + 1 : v);

  let hmax = 1;
  let vmax = 1;
  comps.forEach((c) => {
    if (c.h > hmax) hmax = c.h;
    if (c.v > vmax) vmax = c.v;
    if (!dcT[c.td] || !acT[c.ta]) hmax = 0;
  });
  if (!hmax) return null;
  const mx = Math.ceil(W / (8 * hmax));
  const my = Math.ceil(H / (8 * vmax));
  if (mx * my > 40000) return null;
  comps.forEach((c) => {
    c.bw = mx * c.h;
    c.bh = my * c.v;
    c.plane = new Float32Array(c.bw * c.bh);
    c.q = qt[c.tq] || 1;
    c.pred = 0;
  });

  let count = 0;
  for (let y = 0; y < my && !dead; y++) {
    for (let x = 0; x < mx && !dead; x++) {
      if (restart && count > 0 && count % restart === 0) {
        cnt = 0;
        while (pos + 1 < b.length && !(b[pos] === 0xff && b[pos + 1] >= 0xd0 && b[pos + 1] <= 0xd7)) pos++;
        pos += 2;
        dead = false;
        comps.forEach((c) => {
          c.pred = 0;
        });
      }
      count++;
      for (let ci = 0; ci < comps.length; ci++) {
        const c = comps[ci];
        for (let v = 0; v < c.v; v++) {
          for (let h = 0; h < c.h; h++) {
            const s = huff(dcT[c.td]);
            c.pred += s ? ext(recv(s), s) : 0;
            c.plane[(y * c.v + v) * c.bw + x * c.h + h] = (c.pred * c.q) / 8 + 128;
            const at = acT[c.ta];
            let k = 1;
            while (k < 64 && !dead) {
              const rs = huff(at);
              const r = rs >> 4;
              const s2 = rs & 15;
              if (s2 === 0) {
                if (r === 15) {
                  k += 16;
                  continue;
                }
                break;
              }
              k += r + 1;
              for (let i = 0; i < s2; i++) bit();
            }
          }
        }
      }
    }
  }
  if (count < mx * my) return null;

  const Y = comps[0];
  const vw = Math.min(Y.bw, Math.ceil((W * Y.h) / hmax / 8));
  const vh = Math.min(Y.bh, Math.ceil((H * Y.v) / vmax / 8));
  const step = Math.max(1, Math.floor(Math.sqrt((vw * vh) / 2500)));
  const out = [];
  const cl = (n) => Math.max(0, Math.min(255, n));
  for (let by = 0; by < vh; by += step) {
    for (let bx = 0; bx < vw; bx += step) {
      const yv = Y.plane[by * Y.bw + bx];
      if (comps.length >= 3) {
        const cb = comps[1];
        const cr = comps[2];
        const cbv = cb.plane[Math.min(cb.bh - 1, Math.floor((by * cb.v) / Y.v)) * cb.bw + Math.min(cb.bw - 1, Math.floor((bx * cb.h) / Y.h))] - 128;
        const crv = cr.plane[Math.min(cr.bh - 1, Math.floor((by * cr.v) / Y.v)) * cr.bw + Math.min(cr.bw - 1, Math.floor((bx * cr.h) / Y.h))] - 128;
        out.push(cl(yv + 1.402 * crv), cl(yv - 0.344136 * cbv - 0.714136 * crv), cl(yv + 1.772 * cbv));
      } else {
        const g = cl(yv);
        out.push(g, g, g);
      }
    }
  }
  return out;
}

function jpegSamples(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const qt = {};
  const dcT = {};
  const acT = {};
  let comps = null;
  let W = 0;
  let H = 0;
  let restart = 0;
  let pos = 2;
  while (pos + 4 <= b.length) {
    if (b[pos] !== 0xff) {
      pos++;
      continue;
    }
    const m = b[pos + 1];
    if (m === 0xff) {
      pos++;
      continue;
    }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0) {
      pos += 2;
      continue;
    }
    const len = (b[pos + 2] << 8) | b[pos + 3];
    const seg = pos + 4;
    const end = pos + 2 + len;
    if (m === 0xdb) {
      let p = seg;
      while (p < end) {
        const pq = b[p] >> 4;
        const tq = b[p] & 15;
        p++;
        qt[tq] = pq ? (b[p] << 8) | b[p + 1] : b[p];
        p += pq ? 128 : 64;
      }
    } else if (m === 0xc0 || m === 0xc1) {
      H = (b[seg + 1] << 8) | b[seg + 2];
      W = (b[seg + 3] << 8) | b[seg + 4];
      const n = b[seg + 5];
      comps = [];
      for (let i = 0; i < n; i++) {
        const o = seg + 6 + i * 3;
        comps.push({ id: b[o], h: b[o + 1] >> 4, v: b[o + 1] & 15, tq: b[o + 2] });
      }
    } else if (m >= 0xc2 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return null; // progressive / other kinds are not read by this tiny reader
    } else if (m === 0xc4) {
      let p = seg;
      while (p < end) {
        const tc = b[p] >> 4;
        const th = b[p] & 15;
        p++;
        const counts = [];
        let total = 0;
        for (let i = 0; i < 16; i++) {
          counts.push(b[p + i]);
          total += b[p + i];
        }
        p += 16;
        const syms = b.subarray(p, p + total);
        p += total;
        (tc === 0 ? dcT : acT)[th] = buildHuff(counts, syms);
      }
    } else if (m === 0xdd) {
      restart = (b[seg] << 8) | b[seg + 1];
    } else if (m === 0xda) {
      if (!comps || !W || !H) return null;
      const ns = b[seg];
      if (ns !== comps.length) return null;
      for (let i = 0; i < ns; i++) {
        const cid = b[seg + 1 + i * 2];
        const t = b[seg + 2 + i * 2];
        const c = comps.find((x) => x.id === cid);
        if (c) {
          c.td = t >> 4;
          c.ta = t & 15;
        }
      }
      return decodeScan(b, end, comps, qt, dcT, acT, restart, W, H);
    }
    pos = end;
  }
  return null;
}

async function jsColors(uri) {
  if (!FS) return null;
  const info = await FS.getInfoAsync(uri);
  if (!info || !info.exists || (info.size && info.size > 3000000)) return null;
  const b64 = await FS.readAsStringAsync(uri, { encoding: 'base64' });
  await new Promise((r) => setTimeout(r, 0)); // let the screen draw a frame first
  const samples = jpegSamples(decode64(b64));
  if (!samples || samples.length < 30) return null;
  return dominant(samples);
}

export function getCoverColors(uri) {
  if (!uri) return Promise.resolve(null);
  if (cache.has(uri)) return Promise.resolve(cache.get(uri));
  const run = async () => {
    let v = null;
    if (Native && Native.getColors) {
      try {
        const r = await Native.getColors(uri);
        if (r && r.length) v = { main: r[0], second: r[1] || r[0] };
      } catch (e) {
        v = null;
      }
    }
    if (!v) {
      try {
        v = await jsColors(uri);
      } catch (e) {
        v = null;
      }
    }
    return v;
  };
  return run().then((v) => {
    if (v) cache.set(uri, v);
    return v;
  });
}
