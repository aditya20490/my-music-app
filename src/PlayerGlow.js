// The animated background of the full-screen player.
// Six premium styles built from soft layers of light (aurora curtains, liquid light, nebula clouds, silk ribbons,
// sunlight under the ocean, embers).
// The soft textures are made in code the first time they are needed, so no image files are needed.
// Only transforms and opacity move, so it all runs on the phone's graphics side (smooth and light on battery).
// It sits behind everything (buttons and cover stay in front) and never blocks touches.
import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, Image, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getCachedArt, loadArt } from './library';
import { COVER_SECONDS } from './CoverShow';
import { getCoverColors } from './coverColors';

let AS = null;
try {
  const mod = require('@react-native-async-storage/async-storage');
  AS = mod.default || mod;
} catch (e) {
  AS = null;
}

const KEY = 'mm_glow_v2';
const TAU = Math.PI * 2;
const memo = React.memo;
const FILL = StyleSheet.absoluteFill;

// How strong and how fast the background is (fixed, there are no sliders for it any more)
const LEVEL = 0.86;
const SPEED = 1.1;

export const GLOW_DEFAULT = { style: 'aurora', color: 'cover', intensity: 0.8, speed: 0.4 };

export const GLOW_STYLES = [
  { key: 'off', label: 'Off', icon: 'moon' },
  { key: 'aurora', label: 'Aurora', icon: 'cloudy-night' },
  { key: 'liquid', label: 'Liquid light', icon: 'water' },
  { key: 'nebula', label: 'Nebula', icon: 'planet' },
  { key: 'silk', label: 'Silk', icon: 'layers' },
  { key: 'ocean', label: 'Ocean', icon: 'boat' },
  { key: 'fire', label: 'Embers', icon: 'flame' },
];

// Styles saved by older versions now point to the closest new one
const ALIAS = {
  aura: 'liquid',
  lava: 'liquid',
  bokeh: 'liquid',
  sparks: 'nebula',
  galaxy: 'nebula',
  fireflies: 'nebula',
  pulse: 'silk',
  waves: 'silk',
  bars: 'aurora',
  rain: 'aurora',
};

// [deep, middle, bright]
const PALETTES = {
  blue: ['#0A3CFF', '#2F8CFF', '#9AD7FF'],
  cyan: ['#0090B8', '#2EE6FF', '#C2F8FF'],
  teal: ['#00897B', '#26D9C4', '#BDFFF5'],
  green: ['#00B86B', '#2FE08C', '#B6FFD9'],
  lime: ['#5BA800', '#A6F000', '#EEFFB0'],
  gold: ['#FF8A00', '#FFC21A', '#FFF0A6'],
  orange: ['#FF5A00', '#FF9A1F', '#FFE0A0'],
  red: ['#E10000', '#FF3D2E', '#FFB199'],
  pink: ['#FF2E93', '#FF6FB5', '#FFC2E1'],
  purple: ['#5B21FF', '#A04BFF', '#E1B8FF'],
  indigo: ['#2A1B9E', '#5B6CFF', '#C5CCFF'],
  white: ['#9AA0B8', '#E3E6F5', '#FFFFFF'],
  black: ['#15151C', '#3A3A48', '#8C8CA0'],
};

// The water of the Ocean style (it keeps these colors unless you pick one of the color chips)
const OCEAN = {
  pal: ['#0B5C9E', '#1FB5D6', '#F2FFFF'],
  base: ['#2AA6C9', '#0A5A86', '#031A33'],
};

export const GLOW_COLORS = [
  { key: 'cover', label: 'Cover colors', swatch: '#8E6BFF', icon: 'image' },
  { key: 'theme', label: 'Theme', swatch: null, icon: 'color-palette' },
  { key: 'blue', label: 'Blue', swatch: PALETTES.blue[1] },
  { key: 'cyan', label: 'Cyan', swatch: PALETTES.cyan[1] },
  { key: 'teal', label: 'Teal', swatch: PALETTES.teal[1] },
  { key: 'green', label: 'Green', swatch: PALETTES.green[1] },
  { key: 'lime', label: 'Lime', swatch: PALETTES.lime[1] },
  { key: 'gold', label: 'Gold', swatch: PALETTES.gold[1] },
  { key: 'orange', label: 'Orange', swatch: PALETTES.orange[1] },
  { key: 'red', label: 'Red', swatch: PALETTES.red[1] },
  { key: 'pink', label: 'Pink', swatch: PALETTES.pink[1] },
  { key: 'purple', label: 'Purple', swatch: PALETTES.purple[1] },
  { key: 'indigo', label: 'Indigo', swatch: PALETTES.indigo[1] },
  { key: 'white', label: 'White', swatch: PALETTES.white[1] },
  { key: 'black', label: 'Black', swatch: PALETTES.black[0] },
];

export async function loadGlow() {
  setTimeout(() => {
    try {
      textures(); // prepare the soft textures early, so the player opens without a hiccup
    } catch (e) {}
  }, 600);
  try {
    const raw = AS ? await AS.getItem(KEY) : null;
    if (raw) {
      const g = { ...GLOW_DEFAULT, ...JSON.parse(raw) };
      if (ALIAS[g.style]) g.style = ALIAS[g.style];
      return g;
    }
  } catch (e) {}
  return GLOW_DEFAULT;
}

let saveTimer = null;
export function saveGlow(g) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (AS) AS.setItem(KEY, JSON.stringify(g));
    } catch (e) {}
  }, 400);
}

// ---------- colors ----------
function hexToRgb(h) {
  let s = String(h).replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  if (!isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r, g, b) {
  const f = (x) => ('0' + Math.max(0, Math.min(255, Math.round(x))).toString(16)).slice(-2);
  return '#' + f(r) + f(g) + f(b);
}

function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
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

function hsvToHex(h, s, v) {
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const m = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return toHex(m[0] * 255, m[1] * 255, m[2] * 255);
}

// pal = [deep, middle, bright] for the effects, base = [top, middle, bottom] for the background.
// With the cover colors the background goes from the brightest shade at the top to almost black at the bottom.
function coverPal(main, second) {
  const c = hexToRgb(main);
  const hsv = rgbToHsv(c[0], c[1], c[2]);
  const gray = hsv[1] < 0.12;
  const s = gray ? hsv[1] : Math.max(0.5, hsv[1]);
  const mid = hsvToHex(hsv[0], s, Math.max(0.6, Math.min(0.95, hsv[2] + 0.1)));
  const deep = hsvToHex(hsv[0], Math.min(1, s + 0.1), 0.45);
  let bright = hsvToHex(hsv[0], s * 0.3, 1);
  if (second && second !== main) {
    const c2 = hexToRgb(second);
    const h2 = rgbToHsv(c2[0], c2[1], c2[2]);
    bright = hsvToHex(h2[0], Math.max(0.15, h2[1] * 0.4), 1);
  }
  return {
    pal: [deep, mid, bright],
    base: [hsvToHex(hsv[0], gray ? s : s * 0.75, 0.85), hsvToHex(hsv[0], s, 0.36), hsvToHex(hsv[0], gray ? s : s * 0.9, 0.06)],
  };
}

function palette(key, colors, cover, styleKey) {
  let k = key;
  if (styleKey === 'ocean' && (k === 'cover' || k === 'theme')) return OCEAN;
  if (k === 'cover') {
    if (cover && cover.main) return coverPal(cover.main, cover.second);
    k = 'theme';
  }
  if (k === 'theme' || !PALETTES[k]) {
    return { pal: [colors.accent, colors.accent2 || colors.accent, '#FFFFFF'], base: null };
  }
  const p = PALETTES[k];
  const bg = colors.bg || '#0B0B10';
  if (k === 'black') return { pal: p, base: ['#2B2B35', '#0E0E13', '#000000'] };
  return { pal: p, base: [mix(bg, p[1], 0.5), mix(bg, p[0], 0.2), bg] };
}

// Follows the cover on screen: the song's single cover, or the cover the cover show is on right now
function useCoverColors(enabled, song, covers, pinned, currentTime) {
  const n = covers ? covers.length : 0;
  const auto = n > 0 ? Math.floor(Math.max(0, currentTime || 0) / COVER_SECONDS) % n : 0;
  const idx = n >= 2 ? (typeof pinned === 'number' && pinned >= 0 && pinned < n ? pinned : auto) : -1;
  const multi = idx >= 0 ? covers[idx] : null;
  const [single, setSingle] = useState(null);
  const [colors, setColors] = useState(null);
  const sid = song ? song.id : null;
  const ckey = song ? song.coverKey : undefined;

  useEffect(() => {
    if (!enabled || !song) return undefined;
    let alive = true;
    let cancel = null;
    const c = getCachedArt(song);
    if (typeof c === 'string') setSingle(c);
    else if (c === null) setSingle(null);
    else
      cancel = loadArt(song, (u) => {
        if (alive) setSingle(u || null);
      });
    return () => {
      alive = false;
      if (cancel) cancel();
    };
  }, [enabled, sid, ckey]);

  const uri = multi || single;
  useEffect(() => {
    if (!enabled) return undefined;
    if (!uri) {
      setColors(null);
      return undefined;
    }
    let alive = true;
    getCoverColors(uri).then((v) => {
      if (alive) setColors(v);
    });
    return () => {
      alive = false;
    };
  }, [enabled, uri]);
  return colors;
}

// ---------- soft textures, drawn in code once ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += B64C[(n >> 18) & 63] + B64C[(n >> 12) & 63] + (i + 1 < bytes.length ? B64C[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64C[n & 63] : '=');
  }
  return s;
}

function makePng(w, h, px) {
  const rowLen = w * 4 + 1;
  const raw = new Uint8Array(rowLen * h);
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w * 4, (y + 1) * w * 4), y * rowLen + 1);
  const blocks = Math.ceil(raw.length / 65535);
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let o = 0;
  z[o++] = 0x78;
  z[o++] = 0x01;
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535;
    const len = Math.min(65535, raw.length - start);
    z[o++] = i === blocks - 1 ? 1 : 0;
    z[o++] = len & 255;
    z[o++] = len >> 8;
    z[o++] = ~len & 255;
    z[o++] = (~len >> 8) & 255;
    z.set(raw.subarray(start, start + len), o);
    o += len;
  }
  const ad = adler32(raw);
  z[o++] = ad >>> 24;
  z[o++] = (ad >>> 16) & 255;
  z[o++] = (ad >>> 8) & 255;
  z[o++] = ad & 255;

  const chunk = (type, data) => {
    const n = data.length;
    const out = new Uint8Array(12 + n);
    out[0] = (n >>> 24) & 255;
    out[1] = (n >>> 16) & 255;
    out[2] = (n >>> 8) & 255;
    out[3] = n & 255;
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    const c = crc32(out, 4, 8 + n);
    out[8 + n] = (c >>> 24) & 255;
    out[9 + n] = (c >>> 16) & 255;
    out[10 + n] = (c >>> 8) & 255;
    out[11 + n] = c & 255;
    return out;
  };
  const ihdr = new Uint8Array(13);
  ihdr[2] = (w >> 8) & 255;
  ihdr[3] = w & 255;
  ihdr[6] = (h >> 8) & 255;
  ihdr[7] = h & 255;
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z.subarray(0, o)), chunk('IEND', new Uint8Array(0))];
  let total = 0;
  parts.forEach((p) => {
    total += p.length;
  });
  const file = new Uint8Array(total);
  let at = 0;
  parts.forEach((p) => {
    file.set(p, at);
    at += p.length;
  });
  return b64(file);
}

// A white picture whose see-through-ness is f(x, y) (x and y go from 0 to 1). It gets its color from tintColor.
function tex(w, h, f) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, Math.min(1, f(x / (w - 1), y / (h - 1))));
      const i = (y * w + x) * 4;
      px[i] = 255;
      px[i + 1] = 255;
      px[i + 2] = 255;
      px[i + 3] = Math.round(a * 255);
    }
  }
  return 'data:image/png;base64,' + makePng(w, h, px);
}

function hash(x, y, s) {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function vnoise(x, y, s) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s);
  const b = hash(xi + 1, yi, s);
  const c = hash(xi, yi + 1, s);
  const d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, s, oct) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  let sum = 0;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(x * f, y * f, s + i);
    sum += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / sum;
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

let TX = null;
function textures() {
  if (TX) return TX;
  TX = {
    // a round soft light
    blob: tex(64, 64, (x, y) => {
      const r = Math.hypot(x - 0.5, y - 0.5) * 2;
      return r >= 1 ? 0 : Math.pow(1 - smooth(0, 1, r), 1.3);
    }),
    // a small glowing point
    dot: tex(32, 32, (x, y) => {
      const r = Math.hypot(x - 0.5, y - 0.5) * 2;
      return r >= 1 ? 0 : Math.pow(1 - smooth(0, 1, r), 2.6);
    }),
    // a soft irregular cloud
    cloud: tex(96, 96, (x, y) => {
      const r = Math.hypot(x - 0.5, y - 0.5) * 2;
      const n = fbm(x * 3.2, y * 3.2, 7, 4);
      return smooth(0.32, 0.78, n) * (1 - smooth(0.55, 1, r)) * 0.95;
    }),
    // an aurora curtain: fine rays, bright low edge, long soft fade upward
    curtain: tex(64, 160, (x, y) => {
      const u = 1 - y;
      const rays = vnoise(x * 14, 0.5, 3) * 0.6 + vnoise(x * 31, 1.5, 5) * 0.4;
      const mask = smooth(0, 0.22, x) * smooth(1, 0.78, x);
      const uu = u * (1.35 - 0.8 * rays);
      return smooth(0, 0.12, u) * Math.pow(Math.max(0, 1 - uu), 1.7) * (0.3 + 0.7 * rays) * mask;
    }),
    // a soft ribbon of light
    band: tex(32, 128, (x, y) => {
      const g = Math.exp(-Math.pow((x - 0.5) * 4.4, 2));
      return g * smooth(0, 0.2, y) * smooth(1, 0.8, y) * (0.75 + 0.25 * vnoise(x * 6, y * 3, 9));
    }),
    // a soft flame
    flame: tex(48, 128, (x, y) => {
      const hw = 0.5 * Math.pow(Math.sin((Math.min(1, y * 1.1) * Math.PI) / 2), 0.9);
      const d = Math.abs(x - 0.5) / (hw + 0.0001);
      if (d >= 1) return 0;
      return Math.pow(1 - d * d, 1.6) * smooth(0, 0.12, y) * (0.55 + 0.45 * y) * (0.8 + 0.4 * (vnoise(x * 5, y * 9, 2) - 0.5));
    }),
    // a shaft of sunlight in water: bright at the top, fading slowly down, soft on both sides
    ray: tex(32, 192, (x, y) => {
      const g = Math.exp(-Math.pow((x - 0.5) * 4.2, 2));
      const fade = Math.pow(1 - smooth(0, 1, y), 1.15);
      return g * fade * smooth(0, 0.03, y) * (0.8 + 0.3 * vnoise(x * 5, y * 8, 4));
    }),
    // the moving net of light that sunlight makes under the water surface
    caustic: tex(128, 128, (x, y) => {
      const a = Math.abs(fbm(x * 4, y * 4, 11, 3) - 0.5);
      const b = Math.abs(fbm(x * 7 + 3, y * 7, 17, 2) - 0.5);
      const v = Math.max(1 - smooth(0, 0.07, a), (1 - smooth(0, 0.05, b)) * 0.6);
      return v * smooth(1, 0.25, y) * smooth(0, 0.1, x) * smooth(1, 0.9, x) * 0.85;
    }),
  };
  return TX;
}

// ---------- animation helpers ----------
// One clock (0 -> 1, over and over) drives everything. Each layer picks its own speed (whole cycles) and phase from it.
// It restarts itself if it ever stops by accident, and "nudge" restarts it whenever the player changes page or opens a sheet.
function useClock(run, dur, nudge) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!run) return undefined;
    let alive = true;
    let timer = null;
    const cycle = () => {
      if (!alive) return;
      clearTimeout(timer);
      v.setValue(0);
      Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.linear, useNativeDriver: true }).start(() => {
        if (alive) cycle();
      });
      // if the animation ever dies without finishing, this brings it back
      timer = setTimeout(() => {
        if (alive) v.stopAnimation();
      }, dur + 1500);
    };
    cycle();
    return () => {
      alive = false;
      clearTimeout(timer);
      v.stopAnimation();
    };
  }, [run, dur, nudge]);
  return v;
}

function rnd(i, k) {
  const x = Math.sin(i * 12.9898 + (k || 0) * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// A smooth wave that repeats "cycles" times per clock round
function wave(p, base, amp, cycles, phase, unit) {
  const N = Math.min(120, Math.max(24, Math.ceil(cycles * 14)));
  const inp = [];
  const out = [];
  for (let i = 0; i <= N; i++) {
    const v = base + amp * Math.sin(TAU * (cycles * (i / N) + phase));
    inp.push(i / N);
    out.push(unit ? v + unit : v);
  }
  return p.interpolate({ inputRange: inp, outputRange: out });
}

// Something that starts over k times per round (rising sparks). f(u) is its look from u = 0 to 1.
function saw(p, k, ph, f) {
  const inp = [];
  const out = [];
  const add = (x, u) => {
    inp.push(x);
    out.push(f(Math.max(0, Math.min(1, u))));
  };
  let x = 0;
  let u = ph - Math.floor(ph);
  add(0, u);
  for (let guard = 0; guard < 200 && x < 1; guard++) {
    const dx = (1 - u) / k;
    const xe = x + dx;
    if (dx < 0.002) {
      x = xe;
      u = 0;
      if (x < 1) add(x, 0);
      continue;
    }
    const end = Math.min(xe, 1);
    for (let s = 1; s < 6; s++) {
      const xs = x + (end - x) * (s / 6);
      add(xs, u + (xs - x) * k);
    }
    if (xe >= 1) {
      add(1, u + (1 - x) * k);
      break;
    }
    add(xe - 0.0001, 1);
    add(xe, 0);
    x = xe;
    u = 0;
  }
  return p.interpolate({ inputRange: inp, outputRange: out });
}

const AImg = Animated.createAnimatedComponent(Image);

function Sprite({ src, color, x, y, w, h, opacity, transform }) {
  return (
    <AImg
      pointerEvents="none"
      fadeDuration={0}
      resizeMode="stretch"
      source={{ uri: src }}
      style={{ position: 'absolute', left: x, top: y, width: w, height: h, tintColor: color, opacity: opacity === undefined ? 1 : opacity, transform }}
    />
  );
}

// ---------- Aurora: slow curtains of light with fine rays ----------
const Aurora = memo(function Aurora({ pal, clock, width, height }) {
  const T = textures();
  const stand = height * 0.72;
  const cur = [
    { x: -0.3, w: 1.25, c: 1, k: 1, ph: 0.0, o: 0.75 },
    { x: 0.05, w: 1.0, c: 2, k: 2, ph: 0.3, o: 0.6 },
    { x: 0.3, w: 1.2, c: 0, k: 1, ph: 0.55, o: 0.8 },
    { x: -0.15, w: 0.9, c: 2, k: 2, ph: 0.8, o: 0.5 },
  ];
  return (
    <View style={FILL} pointerEvents="none">
      <Sprite src={T.blob} color={pal[0]} x={-width * 0.4} y={stand - height * 0.2} w={width * 1.8} h={height * 0.5} opacity={wave(clock, 0.6, 0.15, 1, 0)} transform={[{ translateX: wave(clock, 0, width * 0.12, 1, 0.2) }]} />
      {cur.map((c, i) => (
        <Sprite
          key={i}
          src={T.curtain}
          color={pal[c.c]}
          x={c.x * width}
          y={stand - height * 0.8}
          w={width * c.w}
          h={height * 0.8}
          opacity={wave(clock, c.o, 0.28, 2, c.ph)}
          transform={[
            { translateX: wave(clock, 0, width * 0.14, c.k, c.ph) },
            { rotate: wave(clock, 0, 3, c.k, c.ph + 0.25, 'deg') },
            { scaleX: wave(clock, 1, 0.16, 2, c.ph) },
            { scaleY: wave(clock, 1, 0.08, 3, c.ph + 0.4) },
          ]}
        />
      ))}
      <Sprite src={T.blob} color={pal[2]} x={-width * 0.2} y={stand - height * 0.07} w={width * 1.4} h={height * 0.18} opacity={wave(clock, 0.35, 0.12, 2, 0.4)} transform={[{ translateX: wave(clock, 0, width * 0.1, 1, 0.6) }]} />
    </View>
  );
});

// ---------- Liquid light: big soft fields of color flowing into each other ----------
const Liquid = memo(function Liquid({ pal, clock, width, height }) {
  const T = textures();
  const fields = [
    { t: 'cloud', c: 0, w: 1.9, x: -0.5, y: -0.1, o: 0.8, kx: 1, ky: 2, ph: 0.0 },
    { t: 'cloud', c: 1, w: 1.6, x: 0.0, y: 0.15, o: 0.65, kx: 2, ky: 1, ph: 0.3 },
    { t: 'blob', c: 2, w: 1.3, x: -0.2, y: 0.4, o: 0.5, kx: 1, ky: 1, ph: 0.55 },
    { t: 'cloud', c: 0, w: 1.8, x: -0.4, y: 0.55, o: 0.8, kx: 1, ky: 2, ph: 0.7 },
    { t: 'cloud', c: 1, w: 1.5, x: -0.1, y: 0.7, o: 0.6, kx: 2, ky: 1, ph: 0.9 },
    { t: 'blob', c: 2, w: 1.0, x: 0.2, y: 0.25, o: 0.4, kx: 1, ky: 2, ph: 0.15 },
  ];
  return (
    <View style={FILL} pointerEvents="none">
      {fields.map((f, i) => {
        const s = width * f.w;
        return (
          <Sprite
            key={i}
            src={T[f.t]}
            color={pal[f.c]}
            x={f.x * width}
            y={f.y * height}
            w={s}
            h={s}
            opacity={wave(clock, f.o, 0.18, 2, f.ph + 0.4)}
            transform={[
              { translateX: wave(clock, 0, width * 0.22, f.kx, f.ph) },
              { translateY: wave(clock, 0, height * 0.12, f.ky, f.ph + 0.2) },
              { rotate: wave(clock, 0, 25, 1, f.ph, 'deg') },
              { scale: wave(clock, 1, 0.14, 2, f.ph) },
            ]}
          />
        );
      })}
      <Sprite src={T.band} color={pal[2]} x={width * 0.2} y={-height * 0.3} w={width * 0.5} h={height * 1.6} opacity={0.3} transform={[{ translateX: wave(clock, 0, width * 0.7, 1, 0) }, { rotate: '24deg' }]} />
    </View>
  );
});

// ---------- Nebula: drifting clouds with a quiet star field ----------
const Nebula = memo(function Nebula({ pal, clock, width, height }) {
  const T = textures();
  const clouds = [
    { c: 0, w: 2.0, x: -0.6, y: -0.15, o: 0.6, ph: 0.0 },
    { c: 1, w: 1.7, x: -0.1, y: 0.2, o: 0.5, ph: 0.3 },
    { c: 0, w: 2.0, x: -0.5, y: 0.5, o: 0.6, ph: 0.6 },
    { c: 2, w: 1.3, x: 0.1, y: 0.05, o: 0.3, ph: 0.85 },
  ];
  return (
    <View style={FILL} pointerEvents="none">
      {clouds.map((c, i) => {
        const s = width * c.w;
        return (
          <Sprite
            key={i}
            src={T.cloud}
            color={pal[c.c]}
            x={c.x * width}
            y={c.y * height}
            w={s}
            h={s}
            opacity={wave(clock, c.o, 0.15, 1, c.ph)}
            transform={[{ translateX: wave(clock, 0, width * 0.1, 1, c.ph) }, { translateY: wave(clock, 0, height * 0.05, 1, c.ph + 0.3) }, { rotate: wave(clock, 0, 40, 1, c.ph, 'deg') }]}
          />
        );
      })}
      {Array.from({ length: 26 }, (_, i) => {
        const sz = 5 + rnd(i, 1) * 9;
        return (
          <Sprite
            key={'s' + i}
            src={T.dot}
            color={i % 4 ? '#FFFFFF' : pal[2]}
            x={rnd(i, 2) * width}
            y={rnd(i, 3) * height * 0.85}
            w={sz}
            h={sz}
            opacity={wave(clock, 0.5, 0.45, 2 + Math.floor(rnd(i, 4) * 4), rnd(i, 5))}
            transform={[{ translateX: wave(clock, 0, 6 + rnd(i, 6) * 14, 1, rnd(i, 7)) }, { translateY: wave(clock, 0, 5 + rnd(i, 8) * 10, 1, rnd(i, 9)) }]}
          />
        );
      })}
    </View>
  );
});

// ---------- Silk: long ribbons of light sliding across ----------
const Silk = memo(function Silk({ pal, clock, width, height }) {
  const T = textures();
  const ribbons = [
    { x: -0.25, w: 0.55, c: 0, o: 0.55, k: 1, ph: 0.0 },
    { x: 0.05, w: 0.4, c: 1, o: 0.55, k: 2, ph: 0.2 },
    { x: 0.35, w: 0.6, c: 0, o: 0.5, k: 1, ph: 0.45 },
    { x: -0.1, w: 0.18, c: 2, o: 0.5, k: 2, ph: 0.65 },
    { x: 0.55, w: 0.45, c: 1, o: 0.45, k: 1, ph: 0.8 },
    { x: 0.25, w: 0.14, c: 2, o: 0.45, k: 2, ph: 0.35 },
  ];
  return (
    <View style={FILL} pointerEvents="none">
      {ribbons.map((r, i) => (
        <Sprite
          key={i}
          src={T.band}
          color={pal[r.c]}
          x={r.x * width}
          y={-height * 0.25}
          w={width * r.w}
          h={height * 1.5}
          opacity={wave(clock, r.o, 0.22, 2, r.ph)}
          transform={[{ translateX: wave(clock, 0, width * 0.3, r.k, r.ph) }, { rotate: wave(clock, -24, 4, 1, r.ph, 'deg') }]}
        />
      ))}
      <Sprite src={T.blob} color={pal[1]} x={-width * 0.3} y={height * 0.6} w={width * 1.6} h={height * 0.5} opacity={wave(clock, 0.35, 0.1, 1, 0.5)} />
    </View>
  );
});

// ---------- Ocean: you are under the water and the sunlight comes down in slow shafts ----------
const Ocean = memo(function Ocean({ pal, clock, width, height }) {
  const T = textures();
  const rays = [
    { x: 0.0, w: 0.3, o: 0.5, k: 1, ph: 0.0, a: -16 },
    { x: 0.18, w: 0.18, o: 0.55, k: 2, ph: 0.3, a: -13 },
    { x: 0.34, w: 0.34, o: 0.45, k: 1, ph: 0.55, a: -17 },
    { x: 0.55, w: 0.16, o: 0.55, k: 2, ph: 0.8, a: -12 },
    { x: 0.68, w: 0.28, o: 0.45, k: 1, ph: 0.15, a: -15 },
    { x: 0.84, w: 0.2, o: 0.5, k: 2, ph: 0.65, a: -14 },
  ];
  return (
    <View style={FILL} pointerEvents="none">
      <Sprite src={T.blob} color={pal[2]} x={-width * 0.3} y={-height * 0.22} w={width * 1.6} h={height * 0.5} opacity={wave(clock, 0.75, 0.15, 2, 0.1)} transform={[{ translateX: wave(clock, 0, width * 0.1, 1, 0) }]} />
      {rays.map((r, i) => (
        <Sprite
          key={'r' + i}
          src={T.ray}
          color={pal[2]}
          x={r.x * width}
          y={-height * 0.1}
          w={width * r.w}
          h={height * 1.15}
          opacity={wave(clock, r.o, 0.22, 2, r.ph)}
          transform={[
            { translateX: wave(clock, 0, width * 0.06, r.k, r.ph) },
            { rotate: wave(clock, r.a, 2.2, 1, r.ph, 'deg') },
            { scaleX: wave(clock, 1, 0.18, 2, r.ph + 0.4) },
          ]}
        />
      ))}
      <Sprite src={T.caustic} color={pal[2]} x={-width * 0.2} y={-height * 0.05} w={width * 1.4} h={height * 0.7} opacity={wave(clock, 0.28, 0.1, 3, 0)} transform={[{ translateX: wave(clock, 0, width * 0.12, 1, 0) }, { translateY: wave(clock, 0, height * 0.02, 2, 0.3) }]} />
      <Sprite src={T.caustic} color={pal[1]} x={-width * 0.1} y={height * 0.05} w={width * 1.3} h={height * 0.7} opacity={wave(clock, 0.2, 0.08, 2, 0.5)} transform={[{ translateX: wave(clock, 0, -width * 0.1, 1, 0.5) }, { scaleX: -1 }]} />
      {Array.from({ length: 24 }, (_, i) => {
        const sz = 3 + rnd(i, 1) * 6;
        const k = 1 + Math.floor(rnd(i, 2) * 2);
        const ph = rnd(i, 3);
        return (
          <Sprite
            key={'p' + i}
            src={T.dot}
            color={pal[2]}
            x={rnd(i, 4) * width}
            y={rnd(i, 5) * height}
            w={sz}
            h={sz}
            opacity={wave(clock, 0.45, 0.35, 2 + Math.floor(rnd(i, 6) * 4), rnd(i, 7))}
            transform={[{ translateX: wave(clock, 0, 10 + rnd(i, 8) * 22, k, ph) }, { translateY: wave(clock, 0, 16 + rnd(i, 9) * 30, k, ph + 0.3) }]}
          />
        );
      })}
      <Sprite src={T.blob} color={pal[0]} x={-width * 0.3} y={height * 0.7} w={width * 1.6} h={height * 0.5} opacity={0.5} />
    </View>
  );
});

// ---------- Embers: soft flames rising from the bottom, with a few sparks ----------
const Fire = memo(function Fire({ pal, clock, width, height }) {
  const T = textures();
  const rows = [
    { n: 6, w: 0.36, h: 0.55, o: 0.5, cols: [0, 1], y: 0.0 },
    { n: 7, w: 0.26, h: 0.38, o: 0.62, cols: [1, 2], y: 0.04 },
  ];
  let id = 0;
  return (
    <View style={FILL} pointerEvents="none">
      <Sprite src={T.blob} color={pal[0]} x={-width * 0.4} y={height * 0.55} w={width * 1.8} h={height * 0.6} opacity={wave(clock, 0.7, 0.12, 3, 0)} />
      <Sprite src={T.blob} color={pal[1]} x={-width * 0.1} y={height * 0.72} w={width * 1.2} h={height * 0.35} opacity={wave(clock, 0.55, 0.15, 4, 0.3)} />
      {rows.map((r, ri) => {
        const sp = width / r.n;
        return Array.from({ length: r.n }, (_, i) => {
          id += 1;
          const w = width * r.w * (0.8 + rnd(id, 1) * 0.4);
          const h = height * r.h * (0.75 + rnd(id, 2) * 0.5);
          const x = (i + 0.5) * sp - w / 2 + (rnd(id, 3) - 0.5) * sp * 0.4;
          const k = 3 + Math.floor(rnd(id, 4) * 5);
          const ph = rnd(id, 5);
          return (
            <Sprite
              key={ri + '-' + i}
              src={T.flame}
              color={pal[r.cols[i % 2]]}
              x={x}
              y={height - h * 0.9 + height * r.y}
              w={w}
              h={h}
              opacity={wave(clock, r.o, 0.18, k, ph)}
              transform={[{ translateX: wave(clock, 0, w * 0.12, 2, ph) }, { scaleY: wave(clock, 1, 0.16, k, ph + 0.3) }, { scaleX: wave(clock, 1, 0.1, k + 1, ph) }]}
            />
          );
        });
      })}
      {Array.from({ length: 14 }, (_, i) => {
        const k = 1 + Math.floor(rnd(i, 1) * 3);
        const ph = rnd(i, 2);
        const sz = 5 + rnd(i, 3) * 6;
        const sway = 8 + rnd(i, 4) * 20;
        return (
          <Sprite
            key={'e' + i}
            src={T.dot}
            color={pal[2]}
            x={rnd(i, 5) * width}
            y={height * 0.96}
            w={sz}
            h={sz}
            opacity={saw(clock, k, ph, (u) => (u < 0.12 ? u / 0.12 : u > 0.7 ? (1 - u) / 0.3 : 1))}
            transform={[{ translateX: saw(clock, k, ph, (u) => Math.sin(u * TAU * 2) * sway) }, { translateY: saw(clock, k, ph, (u) => -u * height * 0.7) }]}
          />
        );
      })}
    </View>
  );
});

const EFFECTS = { aurora: Aurora, liquid: Liquid, nebula: Nebula, silk: Silk, ocean: Ocean, fire: Fire };
const PERIOD = { fire: 8000 }; // embers move faster than the rest (default 36 seconds per round)

// When the colors change (other color chosen, or the cover changed) the new ones fade in over the old ones
function usePalLayers(spec) {
  const sig = spec.pal.join('|') + '#' + (spec.base ? spec.base.join('|') : '');
  const [layers, setLayers] = useState(() => [{ key: sig, pal: spec.pal, base: spec.base, op: new Animated.Value(1) }]);
  const last = useRef(sig);
  useEffect(() => {
    if (last.current === sig) return;
    last.current = sig;
    const nl = { key: sig, pal: spec.pal, base: spec.base, op: new Animated.Value(0) };
    setLayers((cur) => [...cur, nl]);
    Animated.timing(nl.op, { toValue: 1, duration: 1000, useNativeDriver: true }).start(() => {
      setLayers((cur) => cur.slice(-1));
    });
  }, [sig]);
  return layers;
}

// The background itself.
// glow = { style, color }, colors = { accent, accent2, bg }
// song / covers / pinned / currentTime are only used by the "Cover colors" mode
// nudge = any text that changes when the player changes page or opens a sheet (it restarts the movement)
export function GlowBackground({ glow, playing, visible, colors, song, covers, pinned, currentTime, nudge }) {
  const { width, height } = useWindowDimensions();
  const fade = useRef(new Animated.Value(1)).current;
  const [run, setRun] = useState(false);
  const active = !!playing && !!visible;
  const g = glow || GLOW_DEFAULT;
  const styleKey = ALIAS[g.style] || g.style;
  const Effect = EFFECTS[styleKey] || null;

  const cover = useCoverColors(g.color === 'cover' && styleKey !== 'ocean' && !!visible, song, covers, pinned, currentTime);
  const spec = palette(g.color, colors, cover, styleKey);
  const layers = usePalLayers(spec);

  const clock = useClock(run && !!Effect, (PERIOD[styleKey] || 36000) / SPEED, nudge);

  // Playing: it flows. Paused: it dims and stops moving (saves battery).
  // A short hiccup in the play state never stops it: it only calms down after 2.5 seconds of real pause.
  useEffect(() => {
    Animated.timing(fade, { toValue: active ? 1 : 0.3, duration: 700, useNativeDriver: true }).start();
    if (active) {
      setRun(true);
      return undefined;
    }
    const id = setTimeout(() => setRun(false), 2500);
    return () => clearTimeout(id);
  }, [active]);

  const hasBase = layers.some((l) => !!l.base);
  if (!Effect && !hasBase) return null;

  return (
    <View pointerEvents="none" style={[FILL, { overflow: 'hidden' }]}>
      {layers.map((l) => (
        <Animated.View key={l.key} pointerEvents="none" style={[FILL, { opacity: l.op }]}>
          {l.base ? <LinearGradient colors={l.base} style={FILL} /> : null}
          {Effect ? (
            <View pointerEvents="none" style={[FILL, { opacity: LEVEL }]}>
              <Animated.View pointerEvents="none" style={[FILL, { opacity: fade }]}>
                <Effect pal={l.pal} clock={clock} width={width} height={height} />
              </Animated.View>
            </View>
          ) : null}
        </Animated.View>
      ))}
    </View>
  );
}
