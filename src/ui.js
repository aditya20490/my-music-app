// Small reusable pieces of the screen: cover pictures, song rows, tiles, buttons, options sheet.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Pressable,
  StyleSheet,
  Animated,
  PanResponder,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, THEMES } from './theme';
import { getCachedArt, loadArt, invalidateArt } from './library';
import { gradientFor, formatTime, SORT_MODES } from './utils';

export const ROW_H = 72;

// ---------- Cover picture (real cover if the song has one, colorful tile if not) ----------
export function Art({ song, size, radius = 12 }) {
  const { t } = useTheme();
  const [uri, setUri] = useState(() => {
    const c = getCachedArt(song);
    return typeof c === 'string' ? c : null;
  });
  const retried = useRef(false);
  const [needsBack, setNeedsBack] = useState(false); // true when the cover is not square

  useEffect(() => {
    retried.current = false;
    setNeedsBack(false);
    const c = getCachedArt(song);
    setUri(typeof c === 'string' ? c : null);
    if (c !== undefined) return undefined;
    return loadArt(song, (res) => setUri(res));
  }, [song.id, song.uri, song.coverKey]);

  const onError = () => {
    if (retried.current) {
      setUri(null);
      return;
    }
    retried.current = true;
    invalidateArt(song.id);
    setUri(null);
    loadArt(song, (res) => setUri(res));
  };

  if (uri) {
    // The whole cover is shown (nothing is cut off). If it is not square, a blurred copy fills the empty space.
    return (
      <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', backgroundColor: t.card }}>
        {needsBack ? (
          <>
            <Image
              source={{ uri }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              resizeMethod="resize"
              blurRadius={25}
            />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.3)' }]} />
          </>
        ) : null}
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          resizeMode="contain"
          resizeMethod="resize"
          onLoad={(e) => {
            const src = e && e.nativeEvent ? e.nativeEvent.source : null;
            if (src && src.width > 0 && src.height > 0) {
              setNeedsBack(Math.abs(src.width / src.height - 1) > 0.03);
            }
          }}
          onError={onError}
        />
      </View>
    );
  }

  const g = gradientFor(song.title || '?');
  const letter = String(song.title || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <LinearGradient
      colors={g}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: 'rgba(255,255,255,0.92)', fontSize: size * 0.42, fontWeight: '800' }}>
        {letter}
      </Text>
    </LinearGradient>
  );
}

// ---------- List view row ----------
export const SongRow = React.memo(function SongRow({ song, index, active, onPress, onLongPress, fav, onFav }) {
  const { t, s } = useTheme();
  const sub = (song.artist || 'Unknown artist') + (song.album ? '  •  ' + song.album : '');
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      style={s.row}
      onPress={() => onPress(index)}
      onLongPress={onLongPress ? () => onLongPress(index) : undefined}
    >
      <Art song={song} size={54} radius={12} />
      <View style={s.rowText}>
        <Text style={[s.rowTitle, active && { color: t.accent }]} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={s.rowSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {song.versions && song.versions.length > 1 ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginRight: 8,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 8,
            backgroundColor: t.track,
          }}
        >
          <Ionicons name="layers" size={12} color={t.accent} />
          <Text style={{ color: t.accent, fontSize: 11, fontWeight: '800', marginLeft: 3 }}>{song.versions.length}</Text>
        </View>
      ) : null}
      <Text style={s.rowTime}>{formatTime(song.duration)}</Text>
      {onFav ? (
        <TouchableOpacity
          onPress={() => onFav(song.id)}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          style={{ paddingHorizontal: 8 }}
        >
          <Ionicons name={fav ? 'heart' : 'heart-outline'} size={20} color={fav ? t.accent : t.muted} />
        </TouchableOpacity>
      ) : null}
      {active ? <Ionicons name="musical-notes" size={18} color={t.accent} style={s.rowNote} /> : null}
    </TouchableOpacity>
  );
});

// ---------- Grid view tile (big cover, name at the very bottom, one line) ----------
export const SongTile = React.memo(function SongTile({ song, index, active, onPress, onLongPress, size }) {
  const { t, s } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => onPress(index)}
      onLongPress={onLongPress ? () => onLongPress(index) : undefined}
      style={[s.tile, { width: size, height: size }]}
    >
      <Art song={song} size={size} radius={0} />
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.82)']} style={s.tileScrim}>
        <Text style={s.tileTitle} numberOfLines={1}>
          {song.title}
        </Text>
      </LinearGradient>
      <View style={s.badge}>
        <Text style={s.badgeText}>{formatTime(song.duration)}</Text>
      </View>
      {song.versions && song.versions.length > 1 ? (
        <View
          style={{
            position: 'absolute',
            top: 6,
            left: 6,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 8,
            backgroundColor: 'rgba(0,0,0,0.6)',
          }}
        >
          <Ionicons name="layers" size={12} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', marginLeft: 3 }}>{song.versions.length}</Text>
        </View>
      ) : null}
      {active ? <View pointerEvents="none" style={[s.tileActive, { borderColor: t.accent }]} /> : null}
    </TouchableOpacity>
  );
});

// ---------- Album tile (long press to select, then you can hide several at once) ----------
export const GroupTile = React.memo(function GroupTile({ group, size, onPress, onLongPress, selecting, selected }) {
  const { t, s } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => onPress(group)}
      onLongPress={onLongPress ? () => onLongPress(group) : undefined}
      style={{ width: size }}
    >
      <View>
        <Art song={group.songs[0]} size={size} radius={16} />
        {selected ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: size,
              height: size,
              borderRadius: 16,
              borderWidth: 3,
              borderColor: t.accent,
              backgroundColor: t.accent + '33',
            }}
          />
        ) : null}
        {selecting ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 26,
              height: 26,
              borderRadius: 13,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? t.accent : 'rgba(0,0,0,0.45)',
              borderWidth: 2,
              borderColor: '#FFFFFF',
            }}
          >
            {selected ? <Ionicons name="checkmark" size={16} color={t.onAccent} /> : null}
          </View>
        ) : null}
      </View>
      <Text style={s.groupTitle} numberOfLines={1}>
        {group.title}
      </Text>
      <Text style={s.groupSub} numberOfLines={1}>
        {(group.sub ? group.sub + '  •  ' : '') + group.songs.length + (group.songs.length === 1 ? ' song' : ' songs')}
      </Text>
    </TouchableOpacity>
  );
});

// ---------- Artist row ----------
export const ArtistRow = React.memo(function ArtistRow({ group, onPress }) {
  const { t, s } = useTheme();
  return (
    <TouchableOpacity activeOpacity={0.7} style={s.row} onPress={() => onPress(group)}>
      <Art song={group.songs[0]} size={54} radius={27} />
      <View style={s.rowText}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {group.title}
        </Text>
        <Text style={s.rowSub} numberOfLines={1}>
          {group.songs.length + (group.songs.length === 1 ? ' song' : ' songs')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={t.muted} />
    </TouchableOpacity>
  );
});

// ---------- Tabs (Songs | Albums | Artists | Favorites) ----------
export function Segmented({ items, value, onChange }) {
  const { t, s } = useTheme();
  return (
    <View style={s.segment}>
      {items.map((it) => {
        const on = value === it.key;
        return (
          <TouchableOpacity
            key={it.key}
            style={[s.segItem, on && { backgroundColor: t.accent }]}
            onPress={() => onChange(it.key)}
            activeOpacity={0.8}
          >
            <Ionicons name={it.icon} size={16} color={on ? t.onAccent : t.muted} />
            <Text style={[s.segText, on && { color: t.onAccent }]}>{it.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ---------- Seek bar ----------
export function SeekBar({ progress, onSeek }) {
  const { s } = useTheme();
  const widthRef = useRef(1);
  const [drag, setDrag] = useState(null);

  const getFraction = (e) => {
    const x = e.nativeEvent.locationX / widthRef.current;
    return Math.max(0, Math.min(1, x));
  };

  const shown = drag !== null ? drag : progress;

  return (
    <View
      style={s.seekTouch}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width || 1;
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => setDrag(getFraction(e))}
      onResponderMove={(e) => setDrag(getFraction(e))}
      onResponderRelease={(e) => {
        onSeek(getFraction(e));
        setDrag(null);
      }}
      onResponderTerminate={() => setDrag(null)}
    >
      <View pointerEvents="none" style={s.seekInner}>
        <View style={s.seekTrack}>
          <View style={[s.seekFill, { width: shown * 100 + '%' }]} />
        </View>
        <View style={[s.seekThumb, { left: shown * 100 + '%' }]} />
      </View>
    </View>
  );
}

// ---------- Mini player at the bottom ----------
export function MiniPlayer({ song, progress, playing, bottom, onOpen, onPrev, onToggle, onNext }) {
  const { t, s } = useTheme();
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onOpen} style={[s.mini, { bottom }]}>
      <View style={s.miniProgressBg}>
        <View style={[s.miniProgressFill, { width: progress * 100 + '%' }]} />
      </View>
      <Art song={song} size={44} radius={10} />
      <View style={s.miniTextWrap}>
        <Text style={s.miniTitle} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={s.miniArtist} numberOfLines={1}>
          {song.artist || 'Unknown artist'}
        </Text>
      </View>
      <TouchableOpacity onPress={onPrev} style={s.miniBtn}>
        <Ionicons name="play-skip-back" size={22} color={t.text} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onToggle} style={s.miniBtn}>
        <Ionicons name={playing ? 'pause' : 'play'} size={28} color={t.text} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onNext} style={s.miniBtn}>
        <Ionicons name="play-skip-forward" size={22} color={t.text} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ---------- Options sheet: sort, theme, hidden albums, library ----------
// It is not a pop-up window. It slides up instantly, closes when you swipe it down or tap outside.
function Chip({ label, active, onPress, icon }) {
  const { t, s } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[s.chip, active && { backgroundColor: t.accent, borderColor: t.accent }]}
    >
      {icon ? <Ionicons name={icon} size={16} color={active ? t.onAccent : t.text} /> : null}
      <Text style={[s.chipText, active && { color: t.onAccent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function OptionsSheet({ onClose, settings, sortMode, onChange, info, onRescan, hiddenAlbums, onUnhide }) {
  const { t, s } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const slide = useRef(new Animated.Value(height)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(0);
  const closing = useRef(false);
  const closeRef = useRef(null);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slide, { toValue: 0, duration: 170, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 170, useNativeDriver: true }),
    ]).start();
  }, []);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(slide, { toValue: height, duration: 150, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => onClose());
  };
  closeRef.current = close;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (e, g) =>
        scrollY.current <= 0 && g.dy > 10 && g.dy > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (e, g) => {
        if (g.dy > 0) slide.setValue(g.dy);
      },
      onPanResponderRelease: (e, g) => {
        if (g.dy > 90 || g.vy > 0.8) {
          closeRef.current();
        } else {
          Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  const lines = [
    'Songs found: ' + info.songCount,
    'Songs with details (artist, album...): ' + info.withDetails,
    'Saving favorites / albums: ' +
      (info.storageOk ? 'working' : 'NOT working' + (info.storageError ? ' (' + info.storageError + ')' : '')),
    'Details library: ' +
      (info.metaLoaded
        ? 'loaded'
        : 'NOT in this build' + (info.metaLoadError ? ' (' + info.metaLoadError + ')' : '')),
    'Details read OK: ' + info.metaOk + '   failed: ' + info.metaFail,
    'Covers saved: ' + info.artSaved + ' (backup reader: ' + info.artJs + ')   no cover: ' + info.artNone + '   failed: ' + info.artFail,
    'Backup cover reader: ' + (info.backupReader ? 'available' : 'NOT in this build'),
    'Backup details reader: ' + (info.tagReader ? 'available' : 'NOT in this build') + '   used for: ' + info.metaJs + ' songs   untagged: ' + info.metaNone,
  ];
  if (info.lastError) lines.push('Last details error: ' + info.lastError);
  if (info.lastArtError) lines.push('Last cover error: ' + info.lastArtError);

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, elevation: 50 }}>
      <Animated.View style={[s.sheetBackdrop, { opacity: fade }]}>
        <Pressable style={{ flex: 1 }} onPress={close} />
      </Animated.View>
      <View style={s.sheetWrap} pointerEvents="box-none">
        <Animated.View
          style={[s.sheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY: slide }] }]}
          {...pan.panHandlers}
        >
          <View style={s.sheetHandle} />
          <ScrollView
            showsVerticalScrollIndicator={false}
            onScroll={(e) => {
              scrollY.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
          >
            <Text style={s.sheetTitle}>Sort songs</Text>
            <View style={s.chipRow}>
              {SORT_MODES.map((m) => (
                <Chip key={m.key} label={m.label} active={sortMode === m.key} onPress={() => onChange({ sort: m.key })} />
              ))}
            </View>

            <Text style={s.sheetTitle}>Theme</Text>
            <View style={s.swatchRow}>
              {THEMES.map((th) => {
                const on = settings.theme === th.id;
                return (
                  <TouchableOpacity key={th.id} style={s.swatchItem} activeOpacity={0.8} onPress={() => onChange({ theme: th.id })}>
                    <LinearGradient
                      colors={[th.bgTop, th.bg]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[s.swatch, { borderColor: on ? t.text : th.accent }]}
                    >
                      <View
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          backgroundColor: th.accent,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {on ? <Ionicons name="checkmark" size={15} color={th.onAccent} /> : null}
                      </View>
                    </LinearGradient>
                    <Text style={[s.swatchName, on && { color: t.text }]}>{th.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.sheetTitle}>Dynamic island</Text>
            <View style={s.chipRow}>
              <Chip label="On" icon="radio-button-on" active={settings.island !== false} onPress={() => onChange({ island: true })} />
              <Chip label="Off" icon="radio-button-off" active={settings.island === false} onPress={() => onChange({ island: false })} />
            </View>

            {hiddenAlbums && hiddenAlbums.length > 0 ? (
              <>
                <Text style={s.sheetTitle}>Hidden albums</Text>
                <View style={s.infoBox}>
                  {hiddenAlbums.map((g) => (
                    <View key={g.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                      <Text style={[s.infoLine, { flex: 1 }]} numberOfLines={1}>
                        {g.title + (g.sub ? '  •  ' + g.sub : '')}
                      </Text>
                      <TouchableOpacity onPress={() => onUnhide(g.key)} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Text style={{ color: t.accent, fontWeight: '800' }}>Show</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            <Text style={s.sheetTitle}>Library</Text>
            <View style={s.chipRow}>
              <Chip
                label={showInfo ? 'Hide library info' : 'Show library info'}
                icon="information-circle-outline"
                active={false}
                onPress={() => setShowInfo(!showInfo)}
              />
            </View>
            {showInfo ? (
              <View style={[s.infoBox, { marginTop: 10 }]}>
                {lines.map((l, i) => (
                  <Text key={i} style={s.infoLine}>
                    {l}
                  </Text>
                ))}
              </View>
            ) : null}
            <TouchableOpacity style={s.rescanButton} onPress={onRescan} activeOpacity={0.8}>
              <Ionicons name="refresh" size={18} color={t.onAccent} />
              <Text style={s.rescanText}>Rescan library</Text>
            </TouchableOpacity>
          </ScrollView>
        </Animated.View>
      </View>
    </View>
  );
}
