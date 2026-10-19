// Small reusable pieces of the screen: cover pictures, song rows, tiles, buttons, options sheet.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, Modal, ScrollView, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, THEMES } from './theme';
import { getCachedArt, loadArt, invalidateArt } from './library';
import { gradientFor, formatTime, SORT_OPTIONS } from './utils';

export const ROW_H = 72;

// ---------- Cover picture (real cover if the song has one, colorful tile if not) ----------
export function Art({ song, size, radius = 12 }) {
  const { t } = useTheme();
  const [uri, setUri] = useState(() => {
    const c = getCachedArt(song);
    return typeof c === 'string' ? c : null;
  });
  const retried = useRef(false);

  useEffect(() => {
    retried.current = false;
    const c = getCachedArt(song);
    setUri(typeof c === 'string' ? c : null);
    if (c !== undefined) return undefined;
    return loadArt(song, (res) => setUri(res));
  }, [song.id, song.uri]);

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
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: t.card }}
        resizeMode="cover"
        resizeMethod="resize"
        onError={onError}
      />
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
export const SongRow = React.memo(function SongRow({ song, index, active, onPress }) {
  const { t, s } = useTheme();
  const sub = (song.artist || 'Unknown artist') + (song.album ? '  •  ' + song.album : '');
  return (
    <TouchableOpacity activeOpacity={0.7} style={s.row} onPress={() => onPress(index)}>
      <Art song={song} size={54} radius={12} />
      <View style={s.rowText}>
        <Text style={[s.rowTitle, active && { color: t.accent }]} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={s.rowSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Text style={s.rowTime}>{formatTime(song.duration)}</Text>
      {active ? <Ionicons name="musical-notes" size={18} color={t.accent} style={s.rowNote} /> : null}
    </TouchableOpacity>
  );
});

// ---------- Grid view tile (big cover, name at the very bottom, one line) ----------
export const SongTile = React.memo(function SongTile({ song, index, active, onPress, size }) {
  const { t, s } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => onPress(index)}
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
      {active ? <View pointerEvents="none" style={[s.tileActive, { borderColor: t.accent }]} /> : null}
    </TouchableOpacity>
  );
});

// ---------- Album tile ----------
export const GroupTile = React.memo(function GroupTile({ group, size, onPress }) {
  const { s } = useTheme();
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={() => onPress(group)} style={{ width: size }}>
      <Art song={group.songs[0]} size={size} radius={16} />
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

// ---------- Tabs (Songs | Albums | Artists) ----------
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

// ---------- Options sheet: view, sort, theme, library info ----------
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

export function OptionsSheet({ visible, onClose, settings, onChange, info, onRescan }) {
  const { t, s } = useTheme();
  const insets = useSafeAreaInsets();

  const lines = [
    'Songs found: ' + info.songCount,
    'Songs with details (artist, album...): ' + info.withDetails,
    'Details library: ' +
      (info.metaLoaded
        ? 'loaded'
        : 'NOT in this build' + (info.metaLoadError ? ' (' + info.metaLoadError + ')' : '')),
    'Details read OK: ' + info.metaOk + '   failed: ' + info.metaFail,
    'Covers saved: ' + info.artSaved + ' (backup reader: ' + info.artJs + ')   no cover: ' + info.artNone + '   failed: ' + info.artFail,
    'Backup cover reader: ' + (info.backupReader ? 'available' : 'NOT in this build'),
  ];
  if (info.lastError) lines.push('Last details error: ' + info.lastError);
  if (info.lastArtError) lines.push('Last cover error: ' + info.lastArtError);
  if (info.metaFunctions) lines.push('Library functions: ' + info.metaFunctions);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={s.sheetWrap}>
        <Pressable style={s.sheetBackdrop} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={s.sheetHandle} />
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={s.sheetTitle}>View</Text>
            <View style={s.chipRow}>
              <Chip label="List" icon="list" active={settings.view === 'list'} onPress={() => onChange({ view: 'list' })} />
              <Chip label="Grid" icon="apps" active={settings.view === 'grid3'} onPress={() => onChange({ view: 'grid3' })} />
            </View>

            <Text style={s.sheetTitle}>Sort songs by</Text>
            <View style={s.chipRow}>
              {SORT_OPTIONS.map((o) => (
                <Chip
                  key={o.key}
                  label={o.label}
                  active={settings.sort === o.key}
                  onPress={() => onChange({ sort: o.key, dir: o.key === 'added' && settings.sort !== 'added' ? 'desc' : settings.dir })}
                />
              ))}
            </View>

            <Text style={s.sheetTitle}>Order</Text>
            <View style={s.chipRow}>
              <Chip label="Ascending" icon="arrow-up" active={settings.dir === 'asc'} onPress={() => onChange({ dir: 'asc' })} />
              <Chip label="Descending" icon="arrow-down" active={settings.dir === 'desc'} onPress={() => onChange({ dir: 'desc' })} />
            </View>

            <Text style={s.sheetTitle}>Theme</Text>
            <View style={s.swatchRow}>
              {THEMES.map((th) => {
                const on = settings.theme === th.id;
                return (
                  <TouchableOpacity key={th.id} style={s.swatchItem} activeOpacity={0.8} onPress={() => onChange({ theme: th.id })}>
                    <LinearGradient
                      colors={[th.accent, th.accent2]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[s.swatch, { borderColor: on ? t.text : th.card }]}
                    >
                      {on ? <Ionicons name="checkmark" size={22} color="#fff" /> : null}
                    </LinearGradient>
                    <Text style={[s.swatchName, on && { color: t.text }]}>{th.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={s.sheetTitle}>Library</Text>
            <View style={s.infoBox}>
              {lines.map((l, i) => (
                <Text key={i} style={s.infoLine}>
                  {l}
                </Text>
              ))}
            </View>
            <TouchableOpacity style={s.rescanButton} onPress={onRescan} activeOpacity={0.8}>
              <Ionicons name="refresh" size={18} color={t.onAccent} />
              <Text style={s.rescanText}>Rescan library</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
