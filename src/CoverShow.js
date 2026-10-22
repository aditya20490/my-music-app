// Several covers inside one song file: the player changes between them by itself every 20 seconds
// (following the song's own time, so pause / seek keep it in step) and you can hold the cover to choose one.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Animated, TouchableOpacity, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from './theme';
import { extractAllEmbeddedArt } from './embeddedArt';
import { getEditCover } from './edits';

export const COVER_SECONDS = 20;

let AS = null;
try {
  const mod = require('@react-native-async-storage/async-storage');
  AS = mod.default || mod;
} catch (e) {
  AS = null;
}

// ---------- the cover you picked for a song (remembered) ----------
const PIN_KEY = 'mm_cover_pins_v1';
let pinData = {};
let pinLoaded = null;

function loadPins() {
  if (!pinLoaded) {
    pinLoaded = (async () => {
      try {
        if (AS) {
          const raw = await AS.getItem(PIN_KEY);
          if (raw) pinData = JSON.parse(raw) || {};
        }
      } catch (e) {}
    })();
  }
  return pinLoaded;
}

export function usePin(songId) {
  const [pin, setPinState] = useState(null); // null = automatic
  useEffect(() => {
    let alive = true;
    setPinState(null);
    if (songId === null || songId === undefined) return undefined;
    loadPins().then(() => {
      if (!alive) return;
      const v = pinData[String(songId)];
      setPinState(typeof v === 'number' ? v : null);
    });
    return () => {
      alive = false;
    };
  }, [songId]);

  const setPin = (v) => {
    setPinState(v);
    if (songId === null || songId === undefined) return;
    if (v === null) delete pinData[String(songId)];
    else pinData[String(songId)] = v;
    try {
      if (AS) AS.setItem(PIN_KEY, JSON.stringify(pinData)).catch(() => {});
    } catch (e) {}
  };
  return [pin, setPin];
}

// ---------- the list of covers inside the playing song ----------
// Returns [] while loading, or when the song has fewer than two covers (then the normal cover is shown).
export function useCovers(song, enabled) {
  const id = song ? song.id : null;
  const [state, setState] = useState({ id: null, list: [] });
  useEffect(() => {
    if (!enabled || !song || song.mka || typeof getEditCover(song.id) === 'string') {
      setState({ id, list: [] });
      return undefined;
    }
    let alive = true;
    extractAllEmbeddedArt(song)
      .then((list) => {
        if (alive) setState({ id: song.id, list: list || [] });
      })
      .catch(() => {
        if (alive) setState({ id: song.id, list: [] });
      });
    return () => {
      alive = false;
    };
  }, [enabled, id, song ? song.coverKey : undefined]);
  return state.id === id ? state.list : [];
}

// One picture, whole (nothing cut off). A blurred copy fills the empty space when it is not square.
function Layer({ uri, bg }) {
  const [needsBack, setNeedsBack] = useState(false);
  return (
    <View style={StyleSheet.absoluteFill}>
      {needsBack ? (
        <>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" resizeMethod="resize" blurRadius={25} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.3)' }]} />
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: bg }]} />
      )}
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        resizeMethod="resize"
        onLoad={(e) => {
          const src = e && e.nativeEvent ? e.nativeEvent.source : null;
          if (src && src.width > 0 && src.height > 0) setNeedsBack(Math.abs(src.width / src.height - 1) > 0.03);
        }}
      />
    </View>
  );
}

// The cover in the player. pinned = a number (the cover you chose) or null (changes by itself).
export function CoverShow({ covers, size, radius, currentTime, pinned }) {
  const { t } = useTheme();
  const n = covers.length;
  const auto = n > 0 ? Math.floor(Math.max(0, currentTime || 0) / COVER_SECONDS) % n : 0;
  const target = typeof pinned === 'number' && pinned >= 0 && pinned < n ? pinned : auto;

  const [shown, setShown] = useState(target);
  const [prev, setPrev] = useState(null);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (target === shown) return;
    setPrev(shown);
    setShown(target);
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 700, useNativeDriver: true }).start(() => setPrev(null));
  }, [target]);

  const idx = Math.min(shown, n - 1);
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', backgroundColor: t.card }}>
      {prev !== null && covers[prev] ? <Layer key={'p' + covers[prev]} uri={covers[prev]} bg={t.card} /> : null}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <Layer key={'c' + covers[idx]} uri={covers[idx]} bg={t.card} />
      </Animated.View>
      {/* small dots: which cover is showing */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 10, flexDirection: 'row', justifyContent: 'center' }}>
        <View style={{ flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.35)' }}>
          {covers.map((c, i) => (
            <View
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                marginHorizontal: 3,
                backgroundColor: i === target ? '#fff' : 'rgba(255,255,255,0.4)',
              }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

// The sheet that opens when you hold the cover: pick which cover to show (or let it change by itself)
export function CoverSheet({ visible, covers, pinned, onPick, onClose, bottomInset }) {
  const { t } = useTheme();
  const { width, height } = useWindowDimensions();
  if (!visible || !covers || covers.length < 2) return null;
  const gap = 10;
  const tile = Math.floor((width - 32 - gap * 2) / 3);
  const isAuto = typeof pinned !== 'number';
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' }}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}
      />
      <View
        style={{
          backgroundColor: t.card,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: (bottomInset || 0) + 18,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: '800' }}>Choose cover</Text>
          <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
            <Ionicons name="close" size={24} color={t.muted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => onPick(null)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 10,
            padding: 12,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: isAuto ? t.accent : t.track,
          }}
        >
          <Ionicons name="sync" size={20} color={isAuto ? t.accent : t.muted} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }}>Automatic</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>Changes cover every {COVER_SECONDS} seconds while the song plays</Text>
          </View>
          {isAuto ? <Ionicons name="checkmark-circle" size={22} color={t.accent} /> : null}
        </TouchableOpacity>

        <ScrollView style={{ maxHeight: height * 0.55, marginTop: 6 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
            {covers.map((uri, i) => {
              const on = pinned === i;
              return (
                <TouchableOpacity
                  key={uri}
                  activeOpacity={0.8}
                  onPress={() => onPick(i)}
                  style={{ width: tile, marginRight: i % 3 === 2 ? 0 : gap, marginBottom: gap }}
                >
                  <View
                    style={{
                      width: tile,
                      height: tile,
                      borderRadius: 14,
                      overflow: 'hidden',
                      borderWidth: on ? 3 : 1,
                      borderColor: on ? t.accent : t.track,
                      backgroundColor: t.bg,
                    }}
                  >
                    <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" resizeMethod="resize" />
                    {on ? (
                      <View style={{ position: 'absolute', right: 6, top: 6 }}>
                        <Ionicons name="checkmark-circle" size={22} color={t.accent} />
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ color: on ? t.accent : t.muted, fontSize: 12, fontWeight: '700', marginTop: 4, textAlign: 'center' }}>
                    {i === 0 ? 'Main cover' : 'Cover ' + (i + 1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
