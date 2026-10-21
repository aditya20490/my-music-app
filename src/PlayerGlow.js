// The glowing animated background of the full-screen player (fire, aura, sparks, pulse).
// It sits behind everything (buttons and cover stay in front) and never blocks touches.
// Style, color, intensity and speed are chosen in the player (wand button on top) and remembered.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

let AS = null;
try {
  const mod = require('@react-native-async-storage/async-storage');
  AS = mod.default || mod;
} catch (e) {
  AS = null;
}

const KEY = 'mm_glow_v1';

export const GLOW_DEFAULT = { style: 'fire', color: 'blue', intensity: 0.75, speed: 0.5 };

export const GLOW_STYLES = [
  { key: 'off', label: 'Off', icon: 'moon' },
  { key: 'fire', label: 'Fire', icon: 'flame' },
  { key: 'aura', label: 'Aura', icon: 'color-filter' },
  { key: 'sparks', label: 'Sparks', icon: 'sparkles' },
  { key: 'pulse', label: 'Pulse', icon: 'radio-button-on' },
];

// [deep, middle, bright]
const PALETTES = {
  blue: ['#0A3CFF', '#2F8CFF', '#9AD7FF'],
  cyan: ['#0090B8', '#2EE6FF', '#C2F8FF'],
  purple: ['#5B21FF', '#A04BFF', '#E1B8FF'],
  pink: ['#FF2E93', '#FF6FB5', '#FFC2E1'],
  red: ['#FF1A1A', '#FF5A1F', '#FFC38A'],
  gold: ['#FF8A00', '#FFC21A', '#FFF0A6'],
  green: ['#00B86B', '#2FE08C', '#B6FFD9'],
};

export const GLOW_COLORS = [
  { key: 'blue', label: 'Blue', swatch: PALETTES.blue[1] },
  { key: 'cyan', label: 'Cyan', swatch: PALETTES.cyan[1] },
  { key: 'purple', label: 'Purple', swatch: PALETTES.purple[1] },
  { key: 'pink', label: 'Pink', swatch: PALETTES.pink[1] },
  { key: 'red', label: 'Red', swatch: PALETTES.red[1] },
  { key: 'gold', label: 'Gold', swatch: PALETTES.gold[1] },
  { key: 'green', label: 'Green', swatch: PALETTES.green[1] },
  { key: 'theme', label: 'Theme', swatch: null },
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

function rgba(hex, a) {
  const h = String(hex).replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  if (!isFinite(n)) return hex;
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

function palette(key, accent, accent2) {
  if (key === 'theme' || !PALETTES[key]) return [accent, accent2 || accent, '#FFFFFF'];
  return PALETTES[key];
}

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

// Runs one 0 -> 1 loop for each value while "run" is true
function useLoops(vals, run, specs) {
  const key = specs.map((x) => x.dur + ':' + x.del).join(',');
  useEffect(() => {
    if (!run) return undefined;
    const anims = vals.map((v, i) => {
      const sp = specs[i];
      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(sp.del),
          Animated.timing(v, { toValue: 1, duration: sp.dur, easing: sp.easing || Easing.linear, useNativeDriver: true }),
        ])
      );
      loop.start();
      return loop;
    });
    return () => anims.forEach((a) => a.stop());
  }, [run, key]);
}

// Same, but goes 0 -> 1 -> 0 smoothly (for slow drifting things)
function useSwing(vals, run, specs) {
  const key = specs.map((x) => x.dur).join(',');
  useEffect(() => {
    if (!run) return undefined;
    const anims = vals.map((v, i) => {
      const sp = specs[i];
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: sp.dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: sp.dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );
      loop.start();
      return loop;
    });
    return () => anims.forEach((a) => a.stop());
  }, [run, key]);
}

function BaseGlow({ pal, height }) {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[rgba(pal[0], 0), rgba(pal[0], 0.32), rgba(pal[1], 0.55)]}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.4 }}
    />
  );
}

// ---------- Fire: tongues of light rising from the bottom ----------
const FLAMES = 8;
function Fire({ pal, run, sf, width, height }) {
  const vals = useRef(Array.from({ length: FLAMES }, () => new Animated.Value(0))).current;
  const flames = useMemo(
    () =>
      Array.from({ length: FLAMES }, (_, i) => {
        const w = (width / FLAMES) * 2.1;
        const h = height * (0.34 + ((i * 37) % 5) * 0.05);
        return {
          w,
          h,
          x: (i + 0.5) * (width / FLAMES) - w / 2,
          rise: h * (0.25 + ((i * 17) % 4) * 0.05),
          dur: 2400 + ((i * 613) % 1800),
          del: (i * 337) % 1500,
        };
      }),
    [width, height]
  );
  useLoops(
    vals,
    run,
    flames.map((f) => ({ dur: f.dur / sf, del: f.del / sf }))
  );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <BaseGlow pal={pal} height={height} />
      {flames.map((f, i) => {
        const p = vals[i];
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: f.x,
              bottom: -f.h * 0.25,
              width: f.w,
              height: f.h,
              opacity: p.interpolate({ inputRange: [0, 0.2, 0.7, 1], outputRange: [0, 1, 0.7, 0] }),
              transform: [
                { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, -f.rise] }) },
                { translateX: p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-f.w * 0.06, f.w * 0.06, -f.w * 0.06] }) },
                { scaleY: p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.75, 1.1, 0.8] }) },
                { scaleX: p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.8, 0.9] }) },
              ],
            }}
          >
            <LinearGradient
              colors={[rgba(pal[0], 0), rgba(pal[1], 0.5), rgba(pal[2], 0.8)]}
              locations={[0, 0.55, 1]}
              style={{ flex: 1, borderTopLeftRadius: f.w / 2, borderTopRightRadius: f.w / 2 }}
            />
            <LinearGradient
              colors={[rgba(pal[2], 0), rgba(pal[2], 0.55)]}
              style={{
                position: 'absolute',
                bottom: 0,
                left: f.w * 0.28,
                width: f.w * 0.44,
                height: f.h * 0.6,
                borderTopLeftRadius: f.w * 0.22,
                borderTopRightRadius: f.w * 0.22,
              }}
            />
          </Animated.View>
        );
      })}
    </View>
  );
}

// ---------- Aura: big soft colored lights drifting around ----------
function Aura({ pal, run, sf, width, height }) {
  const vals = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const orbs = useMemo(
    () => [
      { size: width * 1.2, left: -width * 0.4, top: height * 0.02, c: 0, a: 0.55, dx: 60, dy: 40, dur: 7000 },
      { size: width * 1.0, left: width * 0.35, top: height * 0.34, c: 1, a: 0.5, dx: -50, dy: -50, dur: 9000 },
      { size: width * 1.3, left: -width * 0.3, top: height * 0.6, c: 0, a: 0.6, dx: 50, dy: -30, dur: 8000 },
    ],
    [width, height]
  );
  useSwing(
    vals,
    run,
    orbs.map((o) => ({ dur: o.dur / sf }))
  );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <BaseGlow pal={pal} height={height} />
      {orbs.map((o, i) => {
        const p = vals[i];
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: o.left,
              top: o.top,
              transform: [
                { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, o.dx] }) },
                { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, o.dy] }) },
                { scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) },
              ],
            }}
          >
            <Soft size={o.size} color={pal[o.c]} alpha={o.a} />
          </Animated.View>
        );
      })}
    </View>
  );
}

// ---------- Sparks: little glowing dots floating up ----------
const SPARKS = 26;
function Sparks({ pal, run, sf, width, height }) {
  const vals = useRef(Array.from({ length: SPARKS }, () => new Animated.Value(0))).current;
  const sparks = useMemo(
    () =>
      Array.from({ length: SPARKS }, (_, i) => ({
        x: (((i * 97) % 100) / 100) * width,
        size: 3 + (i % 4) * 1.5,
        rise: height * (0.55 + ((i * 13) % 5) * 0.1),
        dur: 3500 + ((i * 571) % 4500),
        del: (i * 433) % 3000,
        sway: 10 + (i % 5) * 5,
      })),
    [width, height]
  );
  useLoops(
    vals,
    run,
    sparks.map((sp) => ({ dur: sp.dur / sf, del: sp.del / sf }))
  );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <BaseGlow pal={pal} height={height} />
      {sparks.map((sp, i) => {
        const p = vals[i];
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: sp.x,
              bottom: height * 0.02,
              width: sp.size * 4,
              height: sp.size * 4,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: p.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 0.8, 0] }),
              transform: [
                { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, -sp.rise] }) },
                { translateX: p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, sp.sway, -sp.sway] }) },
              ],
            }}
          >
            <View
              style={{
                position: 'absolute',
                width: sp.size * 4,
                height: sp.size * 4,
                borderRadius: sp.size * 2,
                backgroundColor: pal[1],
                opacity: 0.22,
              }}
            />
            <View style={{ width: sp.size, height: sp.size, borderRadius: sp.size / 2, backgroundColor: pal[2] }} />
          </Animated.View>
        );
      })}
    </View>
  );
}

// ---------- Pulse: rings that spread out from behind the cover ----------
const RINGS = 3;
function Pulse({ pal, run, sf, width, height }) {
  const vals = useRef(Array.from({ length: RINGS }, () => new Animated.Value(0))).current;
  const breathe = useRef([new Animated.Value(0)]).current;
  const S = width * 0.55;
  const cx = width / 2;
  const cy = height * 0.32;
  useLoops(
    vals,
    run,
    vals.map((_, i) => ({ dur: 3600 / sf, del: (i * 1200) / sf, easing: Easing.out(Easing.quad) }))
  );
  useSwing(breathe, run, [{ dur: 1800 / sf }]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <BaseGlow pal={pal} height={height} />
      <Animated.View
        style={{
          position: 'absolute',
          left: cx - S,
          top: cy - S,
          transform: [{ scale: breathe[0].interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.12] }) }],
        }}
      >
        <Soft size={S * 2} color={pal[0]} alpha={0.6} />
      </Animated.View>
      {vals.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: cx - S / 2,
            top: cy - S / 2,
            width: S,
            height: S,
            borderRadius: S / 2,
            borderWidth: 3,
            borderColor: rgba(pal[1], 0.9),
            backgroundColor: rgba(pal[0], 0.07),
            opacity: p.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.8, 0] }),
            transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.3] }) }],
          }}
        />
      ))}
    </View>
  );
}

// The background itself. glow = { style, color, intensity, speed }, colors = { accent, accent2 }
export function GlowBackground({ glow, playing, visible, colors }) {
  const { width, height } = useWindowDimensions();
  const fade = useRef(new Animated.Value(1)).current;
  const [run, setRun] = useState(false);
  const active = !!playing && !!visible;

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

  if (!glow || glow.style === 'off') return null;

  const pal = palette(glow.color, colors.accent, colors.accent2);
  const sf = 0.5 + (typeof glow.speed === 'number' ? glow.speed : 0.5) * 1.5;
  const level = 0.3 + (typeof glow.intensity === 'number' ? glow.intensity : 0.75) * 0.7;
  const props = { pal, run, sf, width, height };

  let effect = null;
  if (glow.style === 'fire') effect = <Fire {...props} />;
  else if (glow.style === 'aura') effect = <Aura {...props} />;
  else if (glow.style === 'sparks') effect = <Sparks {...props} />;
  else if (glow.style === 'pulse') effect = <Pulse {...props} />;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: level, overflow: 'hidden' }]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        {effect}
      </Animated.View>
    </View>
  );
}
