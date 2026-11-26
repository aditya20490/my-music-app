// Full-screen Settings (replaces the old Options sheet). Sorting, Theme, Dynamic island, Library and the
// Export Music Library (JSON) page all live here. It slides in from the right like a normal app's settings,
// opens in its own window (so nothing floats on top of it), and swipe-from-the-left-edge / back goes back.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  Alert,
  Vibration,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, THEMES, getTheme } from './theme';
import { SORT_MODES } from './utils';
import { exportLibrary, saveExport, fmtBytes, fmtClock, fmtInt, EXPORT_AVAILABLE } from './exportLibrary';

// ---------- tiny haptics (the app had no helper, so this is one) ----------
let vibeOk = null;
function canVibrate() {
  if (vibeOk === null) {
    vibeOk = false;
    try {
      if (Platform.OS === 'android' && PermissionsAndroid && PermissionsAndroid.check) {
        PermissionsAndroid.check('android.permission.VIBRATE')
          .then((ok) => {
            vibeOk = !!ok;
          })
          .catch(() => {});
      } else {
        vibeOk = true;
      }
    } catch (e) {}
  }
  return vibeOk === true;
}
canVibrate();
const buzz = (p) => {
  try {
    if (canVibrate()) Vibration.vibrate(p);
  } catch (e) {}
};
const haptic = {
  tick: () => buzz(10),
  tap: () => buzz(16),
  warn: () => buzz(30),
  success: () => buzz([0, 14, 70, 24]),
};

const GREEN = '#34C759';
const RED = '#F87171';
const EASE = Easing.bezier(0.2, 0.9, 0.25, 1);

// ---------- small building blocks ----------
function Press({ onPress, style, children, scaleTo = 0.95, kind = 'tick', hitSlop, disabled }) {
  const sc = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => Animated.spring(sc, { toValue: scaleTo, speed: 60, bounciness: 0, useNativeDriver: true }).start()}
      onPressOut={() => Animated.spring(sc, { toValue: 1, speed: 36, bounciness: 9, useNativeDriver: true }).start()}
      onPress={() => {
        if (kind && haptic[kind]) haptic[kind]();
        if (onPress) onPress();
      }}
    >
      <Animated.View style={[style, { transform: [{ scale: sc }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

function Toggle({ value }) {
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  const { t } = useTheme();
  useEffect(() => {
    Animated.spring(x, { toValue: value ? 1 : 0, speed: 28, bounciness: 7, useNativeDriver: true }).start();
  }, [value]);
  return (
    <View style={{ width: 52, height: 32, borderRadius: 16, backgroundColor: t.track, justifyContent: 'center' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 16, backgroundColor: GREEN, opacity: x }]} />
      <Animated.View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: '#FFFFFF',
          marginLeft: 2,
          elevation: 3,
          transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }],
        }}
      />
    </View>
  );
}

function Section({ title, children, footer }) {
  const { t } = useTheme();
  return (
    <View>
      {title ? (
        <Text
          style={{
            color: t.muted,
            fontSize: 12.5,
            fontWeight: '700',
            letterSpacing: 0.9,
            textTransform: 'uppercase',
            marginTop: 26,
            marginBottom: 8,
            marginLeft: 22,
          }}
        >
          {title}
        </Text>
      ) : null}
      <View style={{ marginHorizontal: 16, borderRadius: 18, backgroundColor: t.card, overflow: 'hidden' }}>{children}</View>
      {footer ? (
        <Text style={{ color: t.muted, fontSize: 12.5, lineHeight: 17, marginTop: 8, marginHorizontal: 22 }}>{footer}</Text>
      ) : null}
    </View>
  );
}

function Row({ icon, tint, title, subtitle, value, right, onPress, chevron, last, kind = 'tick' }) {
  const { t } = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingVertical: 10, paddingLeft: 16, paddingRight: 14 }}>
      {icon ? (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            backgroundColor: tint || t.accent,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 14,
          }}
        >
          <Ionicons name={icon} size={19} color="#FFFFFF" />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: t.muted, fontSize: 12.5, lineHeight: 17, marginTop: 2 }} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value !== undefined ? (
        <Text style={{ color: t.muted, fontSize: 14.5, fontWeight: '600', marginLeft: 8 }} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right || null}
      {chevron ? <Ionicons name={chevron === true ? 'chevron-forward' : chevron} size={18} color={t.muted} style={{ marginLeft: 6 }} /> : null}
    </View>
  );
  const sep = !last ? (
    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.track, marginLeft: icon ? 62 : 16 }} />
  ) : null;
  if (!onPress) {
    return (
      <View>
        {body}
        {sep}
      </View>
    );
  }
  return (
    <View>
      <Pressable
        onPress={() => {
          if (kind && haptic[kind]) haptic[kind]();
          onPress();
        }}
        android_disableSound
        style={({ pressed }) => ({ backgroundColor: pressed ? t.track : 'transparent' })}
      >
        {body}
      </Pressable>
      {sep}
    </View>
  );
}

function Check({ on }) {
  const { t } = useTheme();
  return on ? (
    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="checkmark" size={16} color={t.onAccent} />
    </View>
  ) : (
    <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: t.track }} />
  );
}

function BigButton({ label, icon, onPress, kind = 'tap', secondary, danger }) {
  const { t } = useTheme();
  const bg = secondary ? t.card : danger ? RED : t.accent;
  const fg = secondary ? t.text : danger ? '#1A0B0E' : t.onAccent;
  return (
    <Press
      onPress={onPress}
      kind={kind}
      scaleTo={0.97}
      style={{
        height: 54,
        borderRadius: 27,
        backgroundColor: bg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: secondary ? StyleSheet.hairlineWidth : 0,
        borderColor: t.track,
      }}
    >
      {icon ? <Ionicons name={icon} size={20} color={fg} style={{ marginRight: 8 }} /> : null}
      <Text style={{ color: fg, fontSize: 16, fontWeight: '800' }}>{label}</Text>
    </Press>
  );
}

// ---------- the export controller (keeps the scan out of the screen's way) ----------
function useExport(songs, sizes) {
  const [st, setSt] = useState({ phase: 'idle' });
  const cancelRef = useRef(false);
  const aliveRef = useRef(true);
  const runningRef = useRef(false);
  const progress = useRef(new Animated.Value(0)).current;
  const lastUi = useRef(0);

  useEffect(
    () => () => {
      aliveRef.current = false;
      cancelRef.current = true;
    },
    []
  );

  const start = useCallback(async () => {
    if (runningRef.current) return;
    if (!songs || songs.length === 0) {
      setSt({ phase: 'error', message: 'No songs found on this phone yet. Open the home screen, let the songs load, then try again.' });
      return;
    }
    runningRef.current = true;
    cancelRef.current = false;
    const t0 = Date.now();
    progress.setValue(0);
    lastUi.current = 0;
    setSt({ phase: 'running', done: 0, total: songs.length, current: '', startedAt: t0, now: t0 });
    try {
      const res = await exportLibrary(songs.slice(), {
        sizes,
        isCancelled: () => cancelRef.current,
        onProgress: (p) => {
          if (!aliveRef.current) return;
          Animated.timing(progress, {
            toValue: p.total ? p.done / p.total : 1,
            duration: 180,
            easing: Easing.linear,
            useNativeDriver: true,
          }).start();
          const now = Date.now();
          if (now - lastUi.current < 90 && p.done < p.total) return;
          lastUi.current = now;
          setSt((prev) => (prev.phase === 'running' ? { ...prev, done: p.done, total: p.total, current: p.current, now } : prev));
        },
      });
      if (!aliveRef.current) return;
      if (res.cancelled) {
        setSt({ phase: 'cancelled', done: res.done });
        return;
      }
      progress.setValue(1);
      setSt((prev) => ({ ...prev, phase: 'saving', done: res.summary.songs }));
      const saved = await saveExport(res.json, res.fileName);
      if (!aliveRef.current) return;
      haptic.success();
      setSt({ phase: 'done', summary: res.summary, saved });
    } catch (e) {
      if (aliveRef.current) {
        haptic.warn();
        setSt({ phase: 'error', message: e && e.message ? String(e.message) : 'Something went wrong while exporting.' });
      }
    } finally {
      runningRef.current = false;
    }
  }, [songs, sizes]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);
  const reset = useCallback(() => setSt({ phase: 'idle' }), []);
  return { st, start, cancel, reset, progress, busy: st.phase === 'running' || st.phase === 'saving' };
}

// ---------- the Export page ----------
function Bullet({ icon, title, text }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 9, paddingHorizontal: 16 }}>
      <Ionicons name={icon} size={20} color={t.accent} style={{ marginTop: 1, marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 14.5, fontWeight: '700' }}>{title}</Text>
        <Text style={{ color: t.muted, fontSize: 12.5, lineHeight: 17, marginTop: 1 }}>{text}</Text>
      </View>
    </View>
  );
}

function Stat({ label, value }) {
  const { t } = useTheme();
  return (
    <View style={{ width: '50%', paddingVertical: 10, paddingHorizontal: 16 }}>
      <Text style={{ color: t.text, fontSize: 20, fontWeight: '800' }} numberOfLines={1}>
        {value}
      </Text>
      <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function ExportPage({ ex, songCount, width, onDone }) {
  const { t } = useTheme();
  const { st } = ex;
  const barW = width - 32 - 40;
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (st.phase === 'done') {
      pop.setValue(0);
      Animated.spring(pop, { toValue: 1, speed: 12, bounciness: 12, useNativeDriver: true }).start();
    }
  }, [st.phase]);

  let body = null;

  if (st.phase === 'idle' || st.phase === 'cancelled' || st.phase === 'error') {
    const failed = st.phase === 'error';
    body = (
      <View>
        <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 18 }}>
          <View
            style={{
              width: 84,
              height: 84,
              borderRadius: 42,
              backgroundColor: failed ? RED : t.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={failed ? 'alert' : st.phase === 'cancelled' ? 'close' : 'document-text'} size={40} color={failed ? '#1A0B0E' : t.onAccent} />
          </View>
          <Text style={{ color: t.text, fontSize: 22, fontWeight: '800', marginTop: 16 }}>
            {failed ? 'Export failed' : st.phase === 'cancelled' ? 'Export cancelled' : 'Export Music Library'}
          </Text>
          <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6, paddingHorizontal: 28 }}>
            {failed
              ? st.message
              : st.phase === 'cancelled'
              ? 'Nothing was saved. You can start again any time.'
              : 'One .json report of all ' + fmtInt(songCount) + ' songs, ready to send for a full library audit.'}
          </Text>
        </View>

        <Section title="What goes in the file">
          <Bullet icon="pricetags-outline" title="Tags" text="Title, artist, album, album artist, genre, year, track and disc numbers, composer." />
          <Bullet icon="hardware-chip-outline" title="Real file info" text="Size, format, codec, bitrate, sample rate, channels, duration and file path / ID." />
          <Bullet icon="image-outline" title="Cover info only" text="Embedded yes / no, format, width and height. The pictures themselves are never included." />
          <Bullet icon="download-outline" title="Saved to Downloads" text="Downloads / Music Plus, as music-library-date.json." />
        </Section>

        <View style={{ marginHorizontal: 16, marginTop: 24 }}>
          {EXPORT_AVAILABLE ? (
            <BigButton
              label={st.phase === 'idle' ? 'Start export' : 'Try again'}
              icon={st.phase === 'idle' ? 'play' : 'refresh'}
              onPress={ex.start}
            />
          ) : (
            <Text style={{ color: RED, textAlign: 'center', fontSize: 14 }}>File access is not part of this build, so the export cannot run.</Text>
          )}
          <Text style={{ color: t.muted, fontSize: 12.5, textAlign: 'center', marginTop: 12 }}>
            Keep this screen open while it scans. Bigger libraries take a bit longer.
          </Text>
        </View>
      </View>
    );
  } else if (st.phase === 'running' || st.phase === 'saving') {
    const running = st.phase === 'running';
    const done = st.done || 0;
    const total = st.total || 1;
    const elapsed = Math.max(1, (st.now || Date.now()) - (st.startedAt || Date.now())) / 1000;
    const rate = done / elapsed;
    const left = running && done > 20 && rate > 0 ? (total - done) / rate : null;
    const pct = Math.min(100, Math.floor((done / total) * 100));
    body = (
      <View>
        <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 20 }}>
          <Text style={{ color: t.text, fontSize: 54, fontWeight: '800', letterSpacing: -1 }}>{running ? pct + '%' : '100%'}</Text>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '700', marginTop: 2 }}>
            {running ? 'Scanning ' + fmtInt(done) + ' / ' + fmtInt(total) + ' songs...' : 'Saving the file...'}
          </Text>
        </View>
        <View style={{ marginHorizontal: 16, borderRadius: 18, backgroundColor: t.card, padding: 20 }}>
          <View style={{ height: 10, borderRadius: 5, backgroundColor: t.track, overflow: 'hidden' }}>
            <Animated.View
              style={{
                width: barW,
                height: 10,
                borderRadius: 5,
                backgroundColor: t.accent,
                transform: [{ translateX: ex.progress.interpolate({ inputRange: [0, 1], outputRange: [-barW, 0] }) }],
              }}
            />
          </View>
          <Text style={{ color: t.muted, fontSize: 13, marginTop: 14 }} numberOfLines={1}>
            {running ? st.current || 'Starting...' : 'Writing to Downloads...'}
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
            <Text style={{ color: t.muted, fontSize: 12.5 }}>Elapsed {fmtClock(elapsed)}</Text>
            <Text style={{ color: t.muted, fontSize: 12.5 }}>{left !== null ? 'About ' + fmtClock(left) + ' left' : 'Working...'}</Text>
          </View>
        </View>
        {running ? (
          <View style={{ marginHorizontal: 16, marginTop: 22 }}>
            <BigButton label="Cancel" icon="close" secondary kind="warn" onPress={ex.cancel} />
          </View>
        ) : null}
      </View>
    );
  } else if (st.phase === 'done') {
    const sm = st.summary;
    const sv = st.saved;
    const okSaved = sv.via !== 'app';
    body = (
      <View>
        <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 20 }}>
          <Animated.View
            style={{
              width: 84,
              height: 84,
              borderRadius: 42,
              backgroundColor: okSaved ? GREEN : '#FF9F0A',
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
              opacity: pop,
            }}
          >
            <Ionicons name={okSaved ? 'checkmark' : 'alert'} size={46} color="#FFFFFF" />
          </Animated.View>
          <Text style={{ color: t.text, fontSize: 22, fontWeight: '800', marginTop: 16 }}>{okSaved ? 'Export saved' : 'Saved inside the app'}</Text>
          <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6, paddingHorizontal: 28 }}>
            {okSaved
              ? fmtInt(sm.songs) + ' songs exported in ' + fmtClock(sm.tookMs / 1000) + '.'
              : 'The phone would not let the app write to Downloads, so the file stayed in the app\'s own storage.'}
          </Text>
        </View>

        <Section title="File">
          <Row icon="document-text" tint="#0A84FF" title={sv.fileName} subtitle={fmtBytes(sv.size)} />
          <Row icon="folder-open" tint="#FF9F0A" title="Location" subtitle={sv.where} last />
        </Section>

        <Section title="Your library">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 6 }}>
            <Stat label="Songs" value={fmtInt(sm.songs)} />
            <Stat label="Total size" value={fmtBytes(sm.bytes)} />
            <Stat label="Total playtime" value={fmtClock(sm.seconds)} />
            <Stat label="With embedded cover" value={fmtInt(sm.withArt)} />
          </View>
          {sm.errors > 0 ? (
            <Text style={{ color: RED, fontSize: 12.5, marginHorizontal: 16, marginBottom: 12 }}>
              {fmtInt(sm.errors)} files could not be read fully (they are marked in the file).
            </Text>
          ) : null}
        </Section>

        <View style={{ marginHorizontal: 16, marginTop: 24 }}>
          <BigButton label="Done" icon="checkmark" onPress={onDone} />
          <View style={{ height: 10 }} />
          <BigButton label="Export again" icon="refresh" secondary onPress={ex.reset} />
        </View>
      </View>
    );
  }
  return body;
}

// ---------- the Settings screen ----------
export default function SettingsScreen({ onClose, settings, sortMode, onChange, info, onRescan, hiddenAlbums, onUnhide, songs, sizes }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const enter = useRef(new Animated.Value(0)).current; // 0 = off screen, 1 = open
  const push = useRef(new Animated.Value(0)).current; // 0 = Settings, 1 = Export page
  const scrollY = useRef(new Animated.Value(0)).current;
  const pageRef = useRef('main');
  const closing = useRef(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const [exportOpen, setExportOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const ex = useExport(songs, sizes);
  const exRef = useRef(ex);
  exRef.current = ex;

  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 280, easing: EASE, useNativeDriver: true }).start();
  }, []);

  const closeAll = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(enter, { toValue: 0, duration: 230, easing: EASE, useNativeDriver: true }).start(() => onClose());
  };
  const openExport = () => {
    pageRef.current = 'export';
    setExportOpen(true);
    Animated.timing(push, { toValue: 1, duration: 300, easing: EASE, useNativeDriver: true }).start();
  };
  const backToMain = () => {
    pageRef.current = 'main';
    Animated.timing(push, { toValue: 0, duration: 260, easing: EASE, useNativeDriver: true }).start();
  };

  const handleBack = () => {
    if (pageRef.current === 'export') {
      if (exRef.current.busy) {
        haptic.warn();
        Alert.alert('Stop the export?', 'The scan is still running. If you leave now it will be cancelled and nothing will be saved.', [
          { text: 'Keep going', style: 'cancel' },
          {
            text: 'Stop and leave',
            style: 'destructive',
            onPress: () => {
              exRef.current.cancel();
              backToMain();
            },
          },
        ]);
        return;
      }
      backToMain();
      return;
    }
    closeAll();
  };
  const handleBackRef = useRef(handleBack);
  handleBackRef.current = handleBack;

  const springBack = () => {
    if (pageRef.current === 'export') Animated.spring(push, { toValue: 1, useNativeDriver: true, bounciness: 0 }).start();
    else Animated.spring(enter, { toValue: 1, useNativeDriver: true, bounciness: 0 }).start();
  };

  // swipe in from the left edge = back
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (e, g) => g.dx > 4 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        enter.stopAnimation();
        push.stopAnimation();
      },
      onPanResponderMove: (e, g) => {
        const f = Math.max(0, Math.min(1, g.dx / widthRef.current));
        if (pageRef.current === 'export') push.setValue(1 - f);
        else enter.setValue(1 - f);
      },
      onPanResponderRelease: (e, g) => {
        if (g.dx / widthRef.current > 0.3 || g.vx > 0.6) {
          if (pageRef.current === 'export' && exRef.current.busy) {
            springBack();
            handleBackRef.current();
          } else handleBackRef.current();
        } else springBack();
      },
      onPanResponderTerminate: springBack,
    })
  ).current;

  const rootX = enter.interpolate({ inputRange: [0, 1], outputRange: [width, 0] });
  const mainX = push.interpolate({ inputRange: [0, 1], outputRange: [0, -width * 0.28] });
  const exportX = push.interpolate({ inputRange: [0, 1], outputRange: [width, 0] });
  const dim = enter.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] });
  const mainDim = push.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] });

  const barTitleOp = scrollY.interpolate({ inputRange: [28, 64], outputRange: [0, 1], extrapolate: 'clamp' });
  const bigTitleOp = scrollY.interpolate({ inputRange: [0, 44], outputRange: [1, 0], extrapolate: 'clamp' });
  const bigTitleY = scrollY.interpolate({ inputRange: [-100, 0, 60], outputRange: [0, 0, -14], extrapolate: 'clamp' });

  const themeNow = getTheme(settings.theme).id;
  const islandOn = settings.island !== false;
  const songCount = songs ? songs.length : info.songCount;

  const lines = [
    'Songs found: ' + info.songCount,
    'Songs with details (artist, album...): ' + info.withDetails,
    'Saving favorites / albums: ' + (info.storageOk ? 'working' : 'NOT working' + (info.storageError ? ' (' + info.storageError + ')' : '')),
    'Details library: ' + (info.metaLoaded ? 'loaded' : 'NOT in this build' + (info.metaLoadError ? ' (' + info.metaLoadError + ')' : '')),
    'Details read OK: ' + info.metaOk + '   failed: ' + info.metaFail,
    'Covers saved: ' + info.artSaved + ' (backup reader: ' + info.artJs + ')   no cover: ' + info.artNone + '   failed: ' + info.artFail,
    'Backup cover reader: ' + (info.backupReader ? 'available' : 'NOT in this build'),
    'Backup details reader: ' + (info.tagReader ? 'available' : 'NOT in this build') + '   used for: ' + info.metaJs + ' songs   untagged: ' + info.metaNone,
  ];
  if (info.lastError) lines.push('Last details error: ' + info.lastError);
  if (info.lastArtError) lines.push('Last cover error: ' + info.lastArtError);

  const headerH = insets.top + 56;

  const backBtn = (
    <Press onPress={handleBack} kind="tick" scaleTo={0.88} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="chevron-back" size={22} color={t.text} />
    </Press>
  );

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={handleBack}>
      <View style={{ flex: 1 }}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000000', opacity: dim }]} />

        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg, transform: [{ translateX: rootX }] }]}>
          {/* ---------- Settings page ---------- */}
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: mainX }] }]}>
            <Animated.ScrollView
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
              contentContainerStyle={{ paddingTop: headerH + 4, paddingBottom: insets.bottom + 48 }}
            >
              <Animated.Text
                style={{
                  color: t.text,
                  fontSize: 34,
                  fontWeight: '800',
                  marginLeft: 22,
                  marginBottom: 2,
                  opacity: bigTitleOp,
                  transform: [{ translateY: bigTitleY }],
                }}
              >
                Settings
              </Animated.Text>

              <Section title="Sorting" footer="How the song list is ordered on the home screen.">
                {SORT_MODES.map((m, i) => (
                  <Row
                    key={m.key}
                    icon={i === 0 ? 'swap-vertical' : undefined}
                    tint="#FF9F0A"
                    title={m.label}
                    right={<Check on={sortMode === m.key} />}
                    onPress={() => onChange({ sort: m.key })}
                    last={i === SORT_MODES.length - 1}
                  />
                ))}
              </Section>

              <Section title="Theme">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 14, paddingHorizontal: 8 }}>
                  {THEMES.map((th) => {
                    const on = themeNow === th.id;
                    return (
                      <View key={th.id} style={{ width: '20%', alignItems: 'center', paddingVertical: 8 }}>
                        <Press onPress={() => onChange({ theme: th.id })} scaleTo={0.9} kind="tap">
                          <View
                            style={{
                              width: 50,
                              height: 50,
                              borderRadius: 25,
                              backgroundColor: th.bg,
                              borderWidth: on ? 3 : 1.5,
                              borderColor: on ? t.text : t.track,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: th.accent, alignItems: 'center', justifyContent: 'center' }}>
                              {on ? <Ionicons name="checkmark" size={16} color={th.onAccent} /> : null}
                            </View>
                          </View>
                        </Press>
                        <Text style={{ color: on ? t.text : t.muted, fontSize: 11, fontWeight: on ? '700' : '500', marginTop: 5 }} numberOfLines={1}>
                          {th.name}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </Section>

              <Section title="Dynamic Island" footer="The mini player that sits at the top of the screen while a song plays.">
                <Row
                  icon="radio-button-on"
                  tint="#30B0C7"
                  title="Dynamic Island"
                  subtitle={islandOn ? 'On' : 'Off'}
                  right={<Toggle value={islandOn} />}
                  kind="tap"
                  onPress={() => onChange({ island: !islandOn })}
                  last
                />
              </Section>

              {hiddenAlbums && hiddenAlbums.length > 0 ? (
                <Section title="Hidden albums">
                  {hiddenAlbums.map((g, i) => (
                    <Row
                      key={g.key}
                      icon={i === 0 ? 'eye-off' : undefined}
                      tint="#8E8E93"
                      title={g.title}
                      subtitle={g.sub || undefined}
                      right={
                        <Press onPress={() => onUnhide(g.key)} kind="tap" scaleTo={0.9} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
                          <Text style={{ color: t.accent, fontWeight: '800', fontSize: 14.5 }}>Show</Text>
                        </Press>
                      }
                      last={i === hiddenAlbums.length - 1}
                    />
                  ))}
                </Section>
              ) : null}

              <Section title="Library">
                <Row icon="musical-notes" tint="#FF375F" title="Songs on this phone" value={fmtInt(info.songCount)} />
                <Row
                  icon="information-circle"
                  tint="#0A84FF"
                  title="Library info"
                  subtitle={'Details read for ' + fmtInt(info.withDetails) + ' of ' + fmtInt(info.songCount) + ' songs'}
                  chevron={showInfo ? 'chevron-up' : 'chevron-down'}
                  onPress={() => setShowInfo(!showInfo)}
                  last={!showInfo}
                />
                {showInfo ? (
                  <View style={{ backgroundColor: t.bg, margin: 12, marginTop: 4, borderRadius: 12, padding: 12 }}>
                    {lines.map((l, i) => (
                      <Text key={i} style={{ color: t.muted, fontSize: 12, lineHeight: 18 }}>
                        {l}
                      </Text>
                    ))}
                  </View>
                ) : null}
                <Row icon="refresh" tint="#64D2FF" title="Rescan library" subtitle="Reads every song on the phone again" onPress={onRescan} kind="tap" last />
              </Section>

              <Section title="Data" footer="Creates a report of every song's tags, file quality and cover info, so the whole collection can be checked.">
                <Row
                  icon="share-outline"
                  tint="#BF5AF2"
                  title="Export Music Library (JSON)"
                  subtitle="Tags, file info and cover info for every song"
                  chevron
                  onPress={openExport}
                  last
                />
              </Section>
            </Animated.ScrollView>

            {/* top bar */}
            <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: headerH, paddingTop: insets.top }}>
              <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg, opacity: barTitleOp }]} />
              <Animated.View
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: t.track, opacity: barTitleOp }}
              />
              <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }}>
                {backBtn}
                <Animated.Text style={{ flex: 1, textAlign: 'center', color: t.text, fontSize: 17, fontWeight: '800', opacity: barTitleOp, marginRight: 40 }}>
                  Settings
                </Animated.Text>
              </View>
            </View>
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000000', opacity: mainDim }]} />
          </Animated.View>

          {/* ---------- Export page ---------- */}
          {exportOpen ? (
            <Animated.View
              style={[StyleSheet.absoluteFill, { backgroundColor: t.bg, transform: [{ translateX: exportX }], borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.track }]}
            >
              <Animated.ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: headerH, paddingBottom: insets.bottom + 48 }}>
                <ExportPage ex={ex} songCount={songCount} width={width} onDone={handleBack} />
              </Animated.ScrollView>
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: headerH, paddingTop: insets.top, backgroundColor: t.bg }}>
                <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }}>
                  {backBtn}
                  <Text style={{ flex: 1, textAlign: 'center', color: t.text, fontSize: 17, fontWeight: '800', marginRight: 40 }}>Export</Text>
                </View>
              </View>
            </Animated.View>
          ) : null}

          {/* left edge: swipe to go back */}
          <View {...pan.panHandlers} style={{ position: 'absolute', left: 0, top: headerH, bottom: 0, width: 22 }} />
        </Animated.View>
      </View>
    </Modal>
  );
}
