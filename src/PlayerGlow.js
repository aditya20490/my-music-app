// The animated background of the full-screen player.
// 13 styles, 15 colors, and a "Cover colors" mode that takes the colors from the cover that is showing.
// It sits behind everything (buttons and cover stay in front) and never blocks touches.
import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet, NativeModules, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getCachedArt, loadArt } from './library';
import { COVER_SECONDS } from './CoverShow';

let AS = null;
try {
  const mod = require('@react-native-async-storage/async-storage');
  AS = mod.default || mod;
} catch (e) {
  AS = null;
}

const KEY = 'mm_glow_v1';
const TAU = Math.PI * 2;
const memo = React.memo;

export const GLOW_DEFAULT = { style: 'fire', color: 'blue', intensity: 0.75, speed: 0.5 };

export const GLOW_STYLES = [
  { key: 'off', label: 'Off', icon: 'moon' },
  { key: 'fire', label: 'Fire', icon: 'flame' },
  { key: 'aura', label: 'Aura', icon: 'color-filter' },
  { key: 'sparks', label: 'Sparkles', icon: 'sparkles' },
  { key: 'pulse', label: 'Pulse', icon: 'radio-button-on' },
  { key: 'aurora', label: 'Aurora', icon: 'cloudy-night' },
  { key: 'waves', label: 'Waves', icon: 'water' },
  { key: 'bokeh', label: 'Bokeh', icon: 'ellipse' },
  { key: 'galaxy', label: 'Galaxy', icon: 'planet' },
  { key: 'lava', label: 'Lava', icon: 'flask' },
  { key: 'bars', label: 'Equalizer', icon: 'stats-chart' },
  { key: 'rain', label: 'Neon rain', icon: 'rainy' },
  { key: 'fireflies', label: 'Fireflies', icon: 'bulb' },
];

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
  try {
    const raw = AS ? await AS.getItem(KEY) : null;
    if (raw) return { ...GLOW_DEFAULT, ...JSON.parse(raw) };
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

function rgba(hex, a) {
  const c = hexToRgb(hex);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
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

// The colors of the cover: pal = [deep, middle, bright] for the effects, base = [top, middle, bottom] for the background.
// The background goes from the brightest shade at the top to almost black at the bottom.
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

function palette(key, colors, cover) {
  let k = key;
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

// ---------- reading the colors of the cover that is showing ----------
const CoverColor = NativeModules.CoverColor;
const colorCache = new Map();

function fetchColors(uri) {
  if (colorCache.has(uri)) return Promise.resolve(colorCache.get(uri));
  if (!CoverColor) return Promise.resolve(null);
  return CoverColor.getColors(uri)
    .then((r) => {
      const v = r && r.length ? { main: r[0], second: r[1] || r[0] } : null;
      colorCache.set(uri, v);
      return v;
    })
    .catch(() => null);
}

// Follows the cover on screen: the single cover of the song, or the one the cover show is on right now
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
    fetchColors(uri).then((v) => {
      if (alive) setColors(v);
    });
    return () => {
      alive = false;
    };
  }, [enabled, uri]);
  return colors;
}

// ---------- animation helpers ----------
// One clock (0 -> 1, over and over) drives everything. Each thing picks its own speed and phase from it.
function useClock(run, dur) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!run) return undefined;
    const a = Animated.loop(Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [run, dur]);
  return v;
}

function rnd(i, k) {
  const x = Math.sin(i * 12.9898 + (k || 0) * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// A smooth wave that repeats "cycles" times per clock round
function wave(p, base, amp, cycles, phase, unit) {
  const inp = [];
  const out = [];
  for (let i = 0; i <= 16; i++) {
    const v = base + amp * Math.sin(TAU * (cycles * (i / 16) + phase));
    inp.push(i / 16);
    out.push(unit ? v + unit : v);
  }
  return p.interpolate({ inputRange: inp, outputRange: out });
}

// Something that starts over k times per round (rising sparks, falling rain...). f(u) is its look from u = 0 to 1.
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

const fadeInOut = (u) => (u < 0.12 ? u / 0.12 : u > 0.7 ? (1 - u) / 0.3 : 1);

// A soft round glow: several see-through circles on top of each other
const LAYERS = [1, 0.82, 0.65, 0.5, 0.36, 0.24];
function Soft({ size, color, alpha }) {
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      {LAYERS.map((k, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            width: size * k,
            height: size * k,
            left: (size - size * k) / 2,
            top: (size - size * k) / 2,
            borderRadius: (size * k) / 2,
            backgroundColor: color,
            opacity: alpha * (0.12 + i * 0.05),
          }}
        />
      ))}
    </View>
  );
}

function Base({ pal, height, a }) {
  const m = a || 1;
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[rgba(pal[0], 0), rgba(pal[0], 0.3 * m), rgba(pal[1], 0.6 * m)]}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.42 }}
    />
  );
}

// Little glowing dots floating up (used by Fire and Sparkles)
function embers({ pal, clock, width, height, count, rise, size }) {
  return Array.from({ length: count }, (_, i) => {
    const k = 2 + Math.floor(rnd(i, 1) * 5);
    const ph = rnd(i, 2);
    const sz = (size || 3) * (0.6 + rnd(i, 3) * 1.1);
    const sway = 10 + rnd(i, 4) * 24;
    return (
      <Animated.View
        key={'e' + i}
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: rnd(i, 5) * width,
          bottom: height * 0.02,
          opacity: saw(clock, k, ph, fadeInOut),
          transform: [
            { translateX: saw(clock, k, ph, (u) => Math.sin(u * TAU * 2) * sway) },
            { translateY: saw(clock, k, ph, (u) => -u * rise) },
          ],
        }}
      >
        <View style={{ position: 'absolute', left: -sz * 1.5, top: -sz * 1.5, width: sz * 3, height: sz * 3, borderRadius: sz * 1.5, backgroundColor: pal[1], opacity: 0.25 }} />
        <View style={{ width: sz, height: sz, borderRadius: sz / 2, backgroundColor: pal[2] }} />
      </Animated.View>
    );
  });
}

const FILL = StyleSheet.absoluteFill;

// ---------- Fire: three rows of real flame shapes (teardrops with a hot core), flickering and leaning, plus embers ----------
function Flame({ x, w, h, base, pal, a, cols, clock, seed }) {
  const S = w / 1.4142; // the flame is a square with one pointed corner, turned 45 degrees and stretched tall
  const sy = h / w;
  const k1 = 7 + Math.floor(rnd(seed, 4) * 6);
  const k2 = 2 + Math.floor(rnd(seed, 5) * 3);
  const ph = rnd(seed, 6);
  const corner = (z) => ({ width: z, height: z, borderRadius: z / 2, borderTopLeftRadius: 0 });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - S / 2,
        bottom: base + h * 0.5 - S / 2,
        width: S,
        height: S,
        opacity: wave(clock, 0.88, 0.12, k1 + 1, ph + 0.6),
        transform: [
          { translateX: wave(clock, 0, w * 0.1, k2, ph) },
          { rotate: wave(clock, 0, 4, k2 + 1, ph + 0.25, 'deg') },
          { scaleX: wave(clock, 1, 0.14, k1 - 2, ph) },
          { scaleY: wave(clock, sy, sy * 0.2, k1, ph + 0.3) },
          { rotate: '45deg' },
        ],
      }}
    >
      <View style={[corner(S * 1.2), { position: 'absolute', left: -S * 0.1, top: -S * 0.1, backgroundColor: pal[cols[0]], opacity: a * 0.3 }]} />
      <View style={[corner(S), { backgroundColor: pal[cols[0]], opacity: a }]} />
      <View style={[corner(S * 0.68), { position: 'absolute', right: S * 0.1, bottom: S * 0.1, backgroundColor: pal[cols[1]], opacity: 0.85 }]} />
      <View style={[corner(S * 0.36), { position: 'absolute', right: S * 0.2, bottom: S * 0.2, backgroundColor: pal[cols[2]], opacity: 0.95 }]} />
    </Animated.View>
  );
}

const Fire = memo(function Fire({ pal, clock, width, height }) {
  const rows = [
    { n: 6, hf: 0.58, wf: 2.7, a: 0.5, c: [0, 0, 1], base: -0.05 },
    { n: 8, hf: 0.44, wf: 2.3, a: 0.62, c: [0, 1, 2], base: -0.04 },
    { n: 11, hf: 0.31, wf: 2.0, a: 0.78, c: [1, 2, 2], base: -0.03 },
  ];
  let id = 0;
  return (
    <View style={FILL} pointerEvents="none">
      <Base pal={pal} height={height} />
      {rows.map((r, ri) => {
        const sp = width / r.n;
        return Array.from({ length: r.n }, (_, i) => {
          id += 1;
          const w = sp * r.wf * (0.8 + rnd(id, 1) * 0.5);
          const h = height * r.hf * (0.7 + rnd(id, 2) * 0.6);
          const x = (i + 0.5) * sp + (rnd(id, 3) - 0.5) * sp * 0.5;
          return <Flame key={ri + '-' + i} x={x} w={w} h={h} base={height * r.base} pal={pal} a={r.a} cols={r.c} clock={clock} seed={id} />;
        });
      })}
      {embers({ pal, clock, width, height, count: 22, rise: height * 0.7, size: 3.2 })}
    </View>
  );
});

// ---------- Aura: big soft lights drifting, with a slow shine sweeping across ----------
const Aura = memo(function Aura({ pal, clock, width, height }) {
  const orbs = [
    { s: 1.25, l: -0.4, t: 0.0, c: 0, a: 0.55 },
    { s: 1.0, l: 0.4, t: 0.25, c: 1, a: 0.5 },
    { s: 1.3, l: -0.3, t: 0.55, c: 0, a: 0.6 },
    { s: 0.9, l: 0.5, t: 0.6, c: 2, a: 0.4 },
    { s: 0.8, l: 0.0, t: 0.3, c: 1, a: 0.35 },
  ];
  return (
    <View style={FILL} pointerEvents="none">
      <Base pal={pal} height={height} />
      {orbs.map((o, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: o.l * width,
            top: o.t * height,
            transform: [
              { translateX: wave(clock, 0, width * 0.16, 1 + (i % 3), i * 0.21) },
              { translateY: wave(clock, 0, height * 0.06, 1 + ((i + 1) % 3), i * 0.33) },
              { scale: wave(clock, 1.05, 0.12, 2 + (i % 2), i * 0.17) },
            ],
          }}
        >
          <Soft size={o.s * width} color={pal[o.c]} alpha={o.a} />
        </Animated.View>
      ))}
      <Animated.View
        style={{
          position: 'absolute',
          left: -width * 0.2,
          top: height * 0.1,
          width: width * 1.4,
          height: height * 0.35,
          transform: [{ translateX: wave(clock, 0, width * 0.5, 1, 0) }, { rotate: '-18deg' }],
        }}
      >
        <LinearGradient colors={[rgba(pal[2], 0), rgba(pal[2], 0.16), rgba(pal[2], 0)]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} />
      </Animated.View>
    </View>
  );
});

// ---------- Sparkles: twinkling four-point stars and floating dust ----------
function Star({ x, y, size, pal, clock, seed }) {
  const k = 4 + Math.floor(rnd(seed, 1) * 7);
  const ph = rnd(seed, 2);
  const col = rnd(seed, 3) > 0.5 ? pal[2] : pal[1];
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: wave(clock, 0.55, 0.45, k, ph),
        transform: [{ scale: wave(clock, 0.65, 0.35, k, ph) }, { rotate: wave(clock, 0, 25, 2, ph, 'deg') }],
      }}
    >
      <View style={{ position: 'absolute', width: size * 0.5, height: size * 0.5, borderRadius: size * 0.25, backgroundColor: pal[1], opacity: 0.25 }} />
      <View style={{ position: 'absolute', width: size * 0.14, height: size, borderRadius: size * 0.07, backgroundColor: col }} />
      <View style={{ position: 'absolute', width: size, height: size * 0.14, borderRadius: size * 0.07, backgroundColor: col }} />
      <View style={{ width: size * 0.22, height: size * 0.22, borderRadius: size * 0.11, backgroundColor: '#FFFFFF' }} />
    </Animated.View>
  );
}

const Sparks = memo(function Sparks({ pal, clock, width, height }) {
  return (
    <View style={FILL} pointerEvents="none">
      <Base pal={pal} height={height} />
      {Array.from({ length: 30 }, (_, i) => (
        <Star key={i} x={rnd(i, 7) * width} y={rnd(i, 8) * height * 0.92} size={10 + rnd(i, 9) * 26} pal={pal} clock={clock} seed={i + 1} />
      ))}
      {embers({ pal, clock, width, height, count: 16, rise: height * 0.8, size: 2.6 })}
    </View>
  );
});

// ---------- Pulse: rings spreading out from behind the cover, with a breathing glow ----------
const Pulse = memo(function Pulse({ pal, clock, width, height }) {
  const S = width * 0.55;
  const cx = width / 2;
  const cy = height * 0.33;
  return (
    <View style={FILL} pointerEvents="none">
      <Base pal={pal} height={height} />
      <Animated.View style={{ position: 'absolute', left: cx - S, top: cy - S, transform: [{ scale: wave(clock, 1.02, 0.14, 5, 0) }] }}>
        <Soft size={S * 2} color={pal[0]} alpha={0.65} />
      </Animated.View>
      {[0, 1, 2, 3].map((i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: cx - S / 2,
            top: cy - S / 2,
            width: S,
            height: S,
            borderRadius: S / 2,
            borderWidth: i % 2 ? 2 : 4,
            borderColor: rgba(i % 2 ? pal[2] : pal[1], 0.9),
            backgroundColor: rgba(pal[0], 0.06),
            opacity: saw(clock, 3, i / 4, (u) => (u < 0.1 ? (u / 0.1) * 0.85 : 0.85 * (1 - u))),
            transform: [{ scale: saw(clock, 3, i / 4, (u) => 0.55 + u * 2.3) }],
          }}
        />
      ))}
    </View>
  );
});

// ---------- Aurora: waving curtains of light ----------
const Aurora = memo(function Aurora({ pal, clock, width, height }) {
  const rib = [
    { l: -0.1, c: 1, c2: 2 },
    { l: 0.15, c: 2, c2: 1 },
    { l: 0.4, c: 1, c2: 0 },
    { l: 0.62, c: 0, c2: 2 },
    { l: 0.85, c: 2, c2: 1 },
  ];
  return (
    <View style={FILL} pointerEvents="none">
      <Base pal={pal} height={height} a={0.8} />
      {rib.map((r, i) => {
        const w = width * 0.5;
        const h = height * 0.85;
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: r.l * width,
              top: -height * 0.05,
              width: w,
              height: h,
              alignItems: 'center',
              opacity: wave(clock, 0.6, 0.35, 2 + (i % 3), i * 0.2),
              transform: [
                { translateX: wave(clock, 0, width * 0.12, 1 + (i % 3), i * 0.17) },
                { rotate: wave(clock, 0, 8, 1 + ((i + 1) % 3), i * 0.3, 'deg') },
                { scaleX: wave(clock, 1, 0.25, 2 + (i % 2), i * 0.11) },
              ],
            }}
          >
            {[1, 0.66, 0.36].map((k, j) => (
              <LinearGradient
                key={j}
                colors={[rgba(pal[r.c], 0), rgba(pal[r.c], 0.34 + j * 0.08), rgba(pal[r.c2], 0.3 + j * 0.06), rgba(pal[r.c], 0)]}
                locations={[0, 0.32, 0.7, 1]}
                style={{ position: 'absolute', top: 0, bottom: 0, width: w * k, borderRadius: (w * k) / 2 }}
              />
            ))}
          </Animated.View>
        );
      })}
      {Array.from({ length: 14 }, (_, i) => (
        <Star key={'s' + i} x={rnd(i, 21) * width} y={rnd(i, 22) * height * 0.5} size={6 + rnd(i, 23) * 8} pal={pal} clock={clock} seed={i + 40} />
      ))}
    </View>
  );
});

// ---------- Waves: rolling water layers ----------
const Waves = memo(function Waves({ pal, clock, width, height }) {
  const layers = [
    { c: 0, a: 0.55, y: 0.66, k: 1, d: 0.62 },
    { c: 1, a: 0.5, y: 0.73, k: 2, d: 0.55 },
    { c: 2, a: 0.42, y: 0.8, k: 3, d: 0.5 },
  ];
  return (
    <View style={FILL} pointerEvents="none">
      <Base pal={pal} height={height} a={0.7} />
      {layers.map((L, i) => {
        const D = width * L.d * 1.4;
        const sp = D * 0.62;
        const n = Math.ceil(width / sp) + 3;
        return (
          <Animated.View
            key={i}
            needsOffscreenAlphaCompositing
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: -sp * 1.5,
              top: height * L.y,
              width: n * sp,
              height: height,
              opacity: L.a,
              transform: [{ translateX: saw(clock, L.k, i * 0.3, (u) => (i % 2 ? -u : u) * sp) }, { translateY: wave(clock, 0, 6 + i * 2, 4 + i, i * 0.4) }],
            }}
          >
            {Array.from({ length: n }, (_, j) => (
              <View key={j} style={{ position: 'absolute', left: j * sp, top: 0, width: D, height: D, borderRadius: D / 2, backgroundColor: pal[L.c] }} />
            ))}
            <View style={{ position: 'absolute', left: 0, right: 0, top: D * 0.5, height: height, backgroundColor: pal[L.c] }} />
          </Animated.View>
        );
      })}
    </View>
  );
});

// ---------- Bokeh: glassy bubbles of light drifting up ----------
const Bokeh = memo(function Bokeh({ pal, clock, width, height }) {
  return (
    <View style={FILL} pointerEvents="none">
      <Base pal={pal} height={height} />
      {Array.from({ length: 16 }, (_, i) => {
        const sz = 26 + rnd(i, 1) * 96;
        const k = 1 + Math.floor(rnd(i, 2) * 2);
        const ph = rnd(i, 3);
        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: rnd(i, 4) * (width - sz),
              top: height * 0.85,
              width: sz,
              height: sz,
              borderRadius: sz / 2,
              borderWidth: 2,
              borderColor: rgba(pal[2], 0.55),
              backgroundColor: rgba(pal[1], 0.13),
              opacity: saw(clock, k, ph, fadeInOut),
              transform: [
                { translateX: saw(clock, k, ph, (u) => Math.sin(u * TAU) * (20 + rnd(i, 5) * 30)) },
                { translateY: saw(clock, k, ph, (u) => -u * height * 0.95) },
                { scale: wave(clock, 1, 0.08, 3, ph) },
              ],
            }}
          >
            <View style={{ position: 'absolute', left: sz * 0.2, top: sz * 0.16, width: sz * 0.22, height: sz * 0.12, borderRadius: sz * 0.1, backgroundColor: '#FFFFFF', opacity: 0.45 }} />
          </Animated.View>
        );
      })}
    </View>
  );
});

// ---------- Galaxy: twinkling stars, slow nebulas and shooting stars ----------
const Galaxy = memo(function Galaxy({ pal, clock, width, height }) {
  return (
    <View style={FILL} pointerEvents="none">
      {[
        { s: 1.3, l: -0.3, t: 0.05, c: 0, a: 0.5 },
        { s: 1.1, l: 0.3, t: 0.4, c: 1, a: 0.35 },
        { s: 1.2, l: -0.2, t: 0.65, c: 0, a: 0.45 },
      ].map((o, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: o.l * width,
            top: o.t * height,
            transform: [{ translateX: wave(clock, 0, width * 0.1, 1, i * 0.3) }, { translateY: wave(clock, 0, height * 0.04, 2, i * 0.2) }],
          }}
        >
          <Soft size={o.s * width} color={pal[o.c]} alpha={o.a} />
        </Animated.View>
      ))}
      {Array.from({ length: 44 }, (_, i) => {
        const sz = 1.5 + rnd(i, 1) * 3;
        const k = 3 + Math.floor(rnd(i, 2) * 8);
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: rnd(i, 3) * width,
              top: rnd(i, 4) * height,
              width: sz,
              height: sz,
              borderRadius: sz / 2,
              backgroundColor: i % 3 ? '#FFFFFF' : pal[2],
              opacity: wave(clock, 0.5, 0.5, k, rnd(i, 5)),
            }}
          />
        );
      })}
      {[0, 1].map((i) => (
        <Animated.View
          key={'m' + i}
          style={{
            position: 'absolute',
            left: 0,
            top: height * (0.08 + i * 0.22),
            width: 120,
            height: 3,
            borderRadius: 2,
            opacity: saw(clock, 1, i * 0.5, (u) => (u < 0.3 ? Math.sin((Math.PI * u) / 0.3) : 0)),
            transform: [
              { translateX: saw(clock, 1, i * 0.5, (u) => -120 + Math.min(1, u / 0.3) * (width + 240)) },
              { translateY: saw(clock, 1, i * 0.5, (u) => Math.min(1, u / 0.3) * (width + 240) * 0.5) },
              { rotate: '27deg' },
            ],
          }}
        >
          <LinearGradient colors={[rgba(pal[2], 0), '#FFFFFF']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1, borderRadius: 2 }} />
        </Animated.View>
      ))}
    </View>
  );
});

// ---------- Lava: slow blobs rising and sinking ----------
const Lava = memo(function Lava({ pal, clock, width, height }) {
  return (
    <View style={FILL} pointerEvents="none">
      <Base pal={pal} height={height} />
      {Array.from({ length: 6 }, (_, i) => {
        const sz = width * (0.5 + rnd(i, 1) * 0.45);
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: rnd(i, 2) * (width - sz * 0.6) - sz * 0.2,
              top: height * 0.45,
              transform: [
                { translateX: wave(clock, 0, width * 0.14, 1 + (i % 3), rnd(i, 3)) },
                { translateY: wave(clock, 0, height * 0.3, 1 + (i % 2), rnd(i, 4)) },
                { scale: wave(clock, 1, 0.18, 2 + (i % 3), rnd(i, 5)) },
              ],
            }}
          >
            <Soft size={sz} color={pal[i % 3]} alpha={0.62} />
          </Animated.View>
        );
      })}
    </View>
  );
});

// ---------- Equalizer: dancing bars ----------
const Bars = memo(function Bars({ pal, clock, width, height }) {
  const n = 24;
  const gap = 4;
  const bw = (width - gap * (n + 1)) / n;
  const H = height * 0.4;
  return (
    <View style={FILL} pointerEvents="none">
      <Base pal={pal} height={height} a={0.6} />
      {Array.from({ length: n }, (_, i) => {
        const k = 3 + Math.floor(rnd(i, 1) * 8);
        const ph = rnd(i, 2);
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: gap + i * (bw + gap),
              bottom: 0,
              width: bw,
              height: H,
              opacity: 0.88,
              transform: [{ translateY: wave(clock, (H / 2) * 0.45, -(H / 2) * 0.45, k, ph) }, { scaleY: wave(clock, 0.55, 0.45, k, ph) }],
            }}
          >
            <LinearGradient colors={[pal[2], pal[1], pal[0]]} style={{ flex: 1, borderTopLeftRadius: bw / 2, borderTopRightRadius: bw / 2 }} />
          </Animated.View>
        );
      })}
    </View>
  );
});

// ---------- Neon rain: glowing streaks falling ----------
const Rain = memo(function Rain({ pal, clock, width, height }) {
  const span = height + 300;
  return (
    <View style={FILL} pointerEvents="none">
      <Base pal={pal} height={height} />
      {Array.from({ length: 30 }, (_, i) => {
        const k = 3 + Math.floor(rnd(i, 1) * 6);
        const ph = rnd(i, 2);
        const h = 50 + rnd(i, 3) * 90;
        const c = i % 2 ? pal[1] : pal[2];
        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: rnd(i, 4) * width,
              top: 0,
              width: 2 + rnd(i, 5) * 1.6,
              height: h,
              opacity: 0.35 + rnd(i, 6) * 0.45,
              transform: [
                { translateX: saw(clock, k, ph, (u) => -u * span * 0.18) },
                { translateY: saw(clock, k, ph, (u) => -h + u * span) },
                { rotate: '10deg' },
              ],
            }}
          >
            <LinearGradient colors={[rgba(c, 0), c]} style={{ flex: 1, borderRadius: 2 }} />
          </Animated.View>
        );
      })}
    </View>
  );
});

// ---------- Fireflies: little lights wandering and blinking ----------
const Fireflies = memo(function Fireflies({ pal, clock, width, height }) {
  return (
    <View style={FILL} pointerEvents="none">
      <Base pal={pal} height={height} a={0.7} />
      {Array.from({ length: 20 }, (_, i) => {
        const sz = 5 + rnd(i, 1) * 5;
        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: rnd(i, 2) * width,
              top: height * (0.1 + rnd(i, 3) * 0.8),
              opacity: wave(clock, 0.5, 0.5, 3 + Math.floor(rnd(i, 4) * 5), rnd(i, 5)),
              transform: [
                { translateX: wave(clock, 0, 40 + rnd(i, 6) * 50, 1 + Math.floor(rnd(i, 7) * 3), rnd(i, 8)) },
                { translateY: wave(clock, 0, 40 + rnd(i, 9) * 40, 1 + Math.floor(rnd(i, 10) * 3), rnd(i, 11)) },
              ],
            }}
          >
            <View style={{ position: 'absolute', left: -sz * 2, top: -sz * 2, width: sz * 5, height: sz * 5, borderRadius: sz * 2.5, backgroundColor: pal[1], opacity: 0.2 }} />
            <View style={{ position: 'absolute', left: -sz, top: -sz, width: sz * 3, height: sz * 3, borderRadius: sz * 1.5, backgroundColor: pal[2], opacity: 0.3 }} />
            <View style={{ width: sz, height: sz, borderRadius: sz / 2, backgroundColor: '#FFFFFF' }} />
          </Animated.View>
        );
      })}
    </View>
  );
});

const EFFECTS = {
  fire: Fire,
  aura: Aura,
  sparks: Sparks,
  pulse: Pulse,
  aurora: Aurora,
  waves: Waves,
  bokeh: Bokeh,
  galaxy: Galaxy,
  lava: Lava,
  bars: Bars,
  rain: Rain,
  fireflies: Fireflies,
};

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
    Animated.timing(nl.op, { toValue: 1, duration: 900, useNativeDriver: true }).start(() => {
      setLayers((cur) => cur.slice(-1));
    });
  }, [sig]);
  return layers;
}

// The background itself.
// glow = { style, color, intensity, speed }, colors = { accent, accent2, bg }
// song / covers / pinned / currentTime are only used by the "Cover colors" mode
export function GlowBackground({ glow, playing, visible, colors, song, covers, pinned, currentTime }) {
  const { width, height } = useWindowDimensions();
  const fade = useRef(new Animated.Value(1)).current;
  const [run, setRun] = useState(false);
  const active = !!playing && !!visible;
  const g = glow || GLOW_DEFAULT;
  const Effect = EFFECTS[g.style] || null;

  const cover = useCoverColors(g.color === 'cover' && !!visible, song, covers, pinned, currentTime);
  const spec = palette(g.color, colors, cover);
  const layers = usePalLayers(spec);

  const sf = 0.5 + (typeof g.speed === 'number' ? g.speed : 0.5) * 1.5;
  const level = 0.3 + (typeof g.intensity === 'number' ? g.intensity : 0.75) * 0.7;
  const clock = useClock(run && !!Effect, 12000 / sf);

  // Playing: everything moves. Paused: it dims and stops moving (saves battery).
  useEffect(() => {
    Animated.timing(fade, { toValue: active ? 1 : 0.3, duration: 600, useNativeDriver: true }).start();
    if (active) {
      setRun(true);
      return undefined;
    }
    const id = setTimeout(() => setRun(false), 900);
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
            <View pointerEvents="none" style={[FILL, { opacity: level }]}>
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
