// The full-screen player: cover, lyrics, song details and the big controls.
// Swipe left / right = change song (the card slides). Swipe up / down = volume.
// Double tap the cover: left side = back 10 seconds, right side = forward 10 seconds.
// The 8D pill turns the 8D effect on / off. The slider button next to it opens the 8D settings
// (automatic rotation or phone tilt, hall presets, room size, rotation speed, movement intensity, reverb, bass).
// If the song has lyrics: swipe up anywhere except on the cover opens the lyrics.
// When it opens, the cover grows out of the mini player and the buttons fade in.
// Smooth opening: the Modal is transparent (the song list stays visible instead of a white window),
// the cover grows first on its own, and the heavy parts (animated glow, extra covers, lyrics) load only after it lands.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  PanResponder,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme';
import { Art, SeekBar } from './ui';
import { CoverShow, CoverSheet, useCovers, usePin } from './CoverShow';
import { fetchLyrics, fetchDetails } from './library';
import { formatTime, parseLyrics, lyricIndexAt } from './utils';
import * as Engine from './audioEngine';
import { GlowBackground, GLOW_DEFAULT, GLOW_STYLES, GLOW_COLORS, loadGlow, saveGlow } from './PlayerGlow';

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
if (FS && typeof FS.getInfoAsync !== 'function') FS = null;

async function fileSizeOf(uri) {
  try {
    if (!FS) return 0;
    const i = await FS.getInfoAsync(uri);
    return i && i.size ? i.size : 0;
  } catch (e) {
    return 0;
  }
}

function fmtSize(b) {
  const mb = b / 1048576;
  if (mb >= 1) return mb.toFixed(mb >= 100 ? 0 : 1) + ' MB';
  return Math.max(1, Math.round(b / 1024)) + ' KB';
}

function buildInfoRows(song, d) {
  const rows = [];
  const add = (label, value) => {
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (text === '' || text === '0') return;
    rows.push([label, text]);
  };
  const det = d && !d._error ? d : {};
  const ed = !!song.edited; // your own changes win over what is stored in the file
  add('Title', ed ? song.title : det.title || song.title);
  add('Artist', ed ? song.artist : det.artist || song.artist);
  add('Album artist', ed ? song.albumArtist : det.albumArtist || song.albumArtist);
  add('Album', ed ? song.album : det.albumTitle || song.album);
  add('Genre', ed ? song.genre : det.genre || song.genre);
  add('Year', ed ? song.year : det.year || song.year);
  const track = ed ? song.track : det.trackNumber || song.track;
  if (track) add('Track', det.totalTrackCount ? track + ' / ' + det.totalTrackCount : track);
  add('Disc', ed ? song.disc : det.discNumber || song.disc);
  add('Composer', ed ? song.composer : det.composer || song.composer);
  add('Length', song.duration ? formatTime(song.duration) : '');
  if (d && d._fileSize) add('File size', fmtSize(d._fileSize));
  if (det.bitrate) add('Bitrate', Math.round(det.bitrate / 1000) + ' kbps');
  if (det.sampleRate) add('Sample rate', (det.sampleRate / 1000).toFixed(1) + ' kHz');
  if (det.channelCount) add('Channels', det.channelCount === 1 ? 'Mono' : det.channelCount === 2 ? 'Stereo' : det.channelCount);
  add('Format', det.codecs);
  add('File name', song.filename);
  return rows;
}

// A slider that tells you its value all the time while you drag (the 8D sound changes live)
function EightSlider({ label, value, onChange, disabled, note, format }) {
  const { t, s } = useTheme();
  const wRef = useRef(1);
  const frac = (e) => Math.max(0, Math.min(1, e.nativeEvent.locationX / wRef.current));
  return (
    <View style={{ marginTop: 14, opacity: disabled ? 0.4 : 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: t.text, fontSize: 14, fontWeight: '700' }}>{label}</Text>
        <Text style={{ color: t.muted, fontSize: 13, fontWeight: '700' }}>{format ? format(value) : Math.round(value * 100) + '%'}</Text>
      </View>
      <View
        style={s.seekTouch}
        onLayout={(e) => {
          wRef.current = e.nativeEvent.layout.width || 1;
        }}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => onChange(frac(e))}
        onResponderMove={(e) => onChange(frac(e))}
      >
        <View pointerEvents="none" style={s.seekInner}>
          <View style={s.seekTrack}>
            <View style={[s.seekFill, { width: value * 100 + '%' }]} />
          </View>
          <View style={[s.seekThumb, { left: value * 100 + '%' }]} />
        </View>
      </View>
      {note ? <Text style={{ color: t.muted, fontSize: 11, marginTop: -2 }}>{note}</Text> : null}
    </View>
  );
}

// Bass slider: the middle is normal, left is less bass, right is more (-12 dB .. +12 dB)
function bassLabel(v) {
  const db = Math.round((v - 0.5) * 24);
  return (db > 0 ? '+' : '') + db + ' dB';
}

// Quick hall sizes
const HALLS = [
  { key: 'club', icon: 'home', label: 'Club', patch: { room: 0.25, reverb: 0.5 } },
  { key: 'hall', icon: 'business', label: 'Auditorium', patch: { room: 0.65, reverb: 0.6, intensity: 0.85 } },
  { key: 'cathedral', icon: 'star', label: 'Cathedral', patch: { room: 1, reverb: 0.75 } },
];

function volumeIcon(v) {
  if (v <= 0.01) return 'volume-mute';
  if (v < 0.4) return 'volume-low';
  if (v < 0.75) return 'volume-medium';
  return 'volume-high';
}

// Fades its children in when it appears (the glow, so it does not pop in after the opening animation)
function FadeIn({ children }) {
  const op = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(op, { toValue: 1, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: op }}>
      {children}
    </Animated.View>
  );
}

export default function NowPlaying({
  visible,
  onClose,
  song,
  index,
  total,
  playing,
  currentTime,
  duration,
  shuffle,
  repeat,
  isFav,
  onToggleFav,
  onToggleShuffle,
  onCycleRepeat,
  onPrev,
  onSwipePrev,
  onNext,
  onTogglePlay,
  onSeek,
  onEdit,
  volume,
  onVolume,
  versions,
  onPickVersion,
}) {
  const { t, s } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [page, setPage] = useState('player'); // player | lyrics | info
  const [lyr, setLyr] = useState({ id: null, loading: false, text: '', error: '' });
  const [det, setDet] = useState({ id: null, loading: false, data: null });
  const [vol, setVol] = useState(typeof volume === 'number' ? volume : 1);
  const [volShown, setVolShown] = useState(false);
  const [eightD, setEightD] = useState(() => Engine.player.isEightD());
  const [eightPanel, setEightPanel] = useState(false); // the 8D settings sheet
  const [verPanel, setVerPanel] = useState(false); // the list of versions (only for .mka bundles)
  const [coverPanel, setCoverPanel] = useState(false); // choose one of the covers inside the song
  const [eset, setEset] = useState(() => Engine.getEightSettings());
  const [glow, setGlow] = useState(GLOW_DEFAULT); // the glowing background (style and color)
  const [glowPanel, setGlowPanel] = useState(false);
  const [heavy, setHeavy] = useState(false); // true once the opening animation is done: now the heavy parts may load
  const glowRef = useRef(GLOW_DEFAULT);

  useEffect(() => {
    let alive = true;
    loadGlow().then((g) => {
      if (alive) {
        glowRef.current = g;
        setGlow(g);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // ----- opening / closing animation: the cover grows out of the mini player and the buttons fade in -----
  const open = useRef(new Animated.Value(0)).current; // 0 = closed, 1 = open
  const [coverReady, setCoverReady] = useState(false);
  const [finalBox, setFinalBox] = useState(null);
  const pendingOpen = useRef(false);
  const startQueued = useRef(false);
  const closing = useRef(false);

  function startOpen() {
    pendingOpen.current = false;
    open.stopAnimation();
    Animated.timing(open, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished) {
        setCoverReady(true);
        setHeavy(true); // the animation is done: now the glow, extra covers and lyrics can load
      }
    });
  }

  // Waits two frames so the flying cover is really on screen before the animation starts (no stutter at the start)
  function queueOpen() {
    if (startQueued.current) return;
    startQueued.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        startQueued.current = false;
        if (pendingOpen.current) startOpen();
      });
    });
  }

  const requestClose = () => {
    if (closing.current) return;
    closing.current = true;
    setCoverReady(false);
    open.stopAnimation();
    Animated.timing(open, { toValue: 0, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      closing.current = false;
      onClose();
    });
  };

  useEffect(() => {
    if (!visible) {
      pendingOpen.current = false;
      startQueued.current = false;
      setHeavy(false);
      return undefined;
    }
    closing.current = false;
    setCoverReady(false);
    setFinalBox(null);
    open.setValue(0);
    pendingOpen.current = true;
    const t1 = setTimeout(() => measureCover(), 30);
    const t2 = setTimeout(() => {
      if (pendingOpen.current) startOpen(); // safety: start anyway if the cover could not be measured
    }, 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [visible]);

  const changeGlow = (patch) => {
    const n = { ...glowRef.current, ...patch };
    glowRef.current = n;
    setGlow(n);
    saveGlow(n);
  };

  const changeEight = (patch) => {
    setEset((old) => ({ ...old, ...patch }));
    Engine.setEightSettings(patch);
  };

  // Switch between automatic rotation and phone tilt
  const chooseMode = async (mode) => {
    if (mode === eset.mode) return;
    if (mode === 'tilt') {
      // Android does not ask for any permission to read the tilt sensor, but the phone must have one
      const ok = await Engine.tiltAvailable();
      if (!ok) {
        Alert.alert('Tilt mode not available', 'This phone does not have a motion sensor the app can use, so tilt mode cannot work here.');
        return;
      }
    }
    changeEight({ mode });
  };

  const onToggleEightD = async () => {
    if (!Engine.eightDSupported) {
      Alert.alert('8D not available', 'This build of the app does not include the 8D engine. Install the newest build from GitHub Releases.');
      return;
    }
    const want = !Engine.player.isEightD();
    const on = await Engine.player.setEightD(want);
    setEightD(on);
    if (!on) setEightPanel(false);
    if (want && !on) Alert.alert('8D failed', 'Could not start 8D for this song.');
  };
  const scrollRef = useRef(null);
  const lineY = useRef({});

  // ----- gesture bookkeeping (refs, so the gesture code always sees fresh values) -----
  const tx = useRef(new Animated.Value(0)).current; // the card slides with this
  const widthRef = useRef(width);
  widthRef.current = width;
  const pageRef = useRef(page);
  pageRef.current = page;
  const hasLyricsRef = useRef(false);
  const coverBox = useRef(null);
  const coverRect = useRef(null);
  const startPt = useRef({ x: 0, y: 0 });
  const axis = useRef('h');
  const onCover = useRef(false);
  const volRef = useRef(typeof volume === 'number' ? volume : 1);
  const volStart = useRef(1);
  const volTimer = useRef(null);
  const busy = useRef(false);
  const act = useRef({});
  act.current = { next: onNext, prev: onSwipePrev || onPrev, volume: onVolume };

  // ----- double tap to seek 10 seconds -----
  const lastTap = useRef({ t: 0, side: 0 });
  const timeRef = useRef({ cur: 0, dur: 0, seek: onSeek });
  timeRef.current = { cur: currentTime, dur: duration, seek: onSeek };
  const [flash, setFlash] = useState(0); // -1 back, 1 forward, 0 none
  const flashTimer = useRef(null);
  const onCoverTap = (e) => {
    const side = e.nativeEvent.pageX < widthRef.current / 2 ? -1 : 1;
    const now = Date.now();
    const last = lastTap.current;
    if (now - last.t < 320 && last.side === side) {
      lastTap.current = { t: 0, side: 0 };
      const { cur, dur, seek } = timeRef.current;
      let target = cur + side * 10;
      target = Math.max(0, dur > 0 ? Math.min(dur - 0.5, target) : target);
      if (seek) seek(target);
      setFlash(side);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(0), 650);
    } else {
      lastTap.current = { t: now, side };
    }
  };

  const measureCover = () => {
    if (coverBox.current && coverBox.current.measureInWindow) {
      coverBox.current.measureInWindow((x, y, w, h) => {
        coverRect.current = { x, y, w, h };
        if (w > 0) {
          setFinalBox((old) => (old && old.x === x && old.y === y && old.w === w && old.h === h ? old : { x, y, w, h }));
          if (pendingOpen.current) queueOpen();
        }
      });
    }
  };

  const applyVolume = (v) => {
    const nv = Math.max(0, Math.min(1, v));
    volRef.current = nv;
    setVol(nv);
    if (act.current.volume) act.current.volume(nv);
    setVolShown(true);
    if (volTimer.current) clearTimeout(volTimer.current);
    volTimer.current = setTimeout(() => setVolShown(false), 900);
  };

  // The card flies out, the song changes, the new card flies in from the other side
  const fly = (dir) => {
    busy.current = true;
    const w = widthRef.current;
    Animated.timing(tx, { toValue: dir * w, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
      if (dir < 0) {
        if (act.current.next) act.current.next();
      } else if (act.current.prev) {
        act.current.prev();
      }
      tx.setValue(-dir * w);
      Animated.timing(tx, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
        busy.current = false;
      });
    });
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (e) => {
        startPt.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
        measureCover();
        return false;
      },
      onMoveShouldSetPanResponder: (e, g) => {
        if (busy.current) return false;
        const adx = Math.abs(g.dx);
        const ady = Math.abs(g.dy);
        if (adx > 14 && adx > ady * 1.3) {
          axis.current = 'h';
          return true;
        }
        if (pageRef.current === 'player' && ady > 14 && ady > adx * 1.3) {
          axis.current = 'v';
          return true;
        }
        return false;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        volStart.current = volRef.current;
        const r = coverRect.current;
        const p = startPt.current;
        onCover.current =
          !!r && p.x >= r.x - 6 && p.x <= r.x + r.w + 6 && p.y >= r.y - 6 && p.y <= r.y + r.h + 6;
      },
      onPanResponderMove: (e, g) => {
        if (axis.current === 'h') {
          tx.setValue(g.dx);
          return;
        }
        const lyricsElsewhere = hasLyricsRef.current && !onCover.current;
        let delta = -g.dy / 260;
        if (lyricsElsewhere && delta > 0) delta = 0; // swipe up here opens lyrics instead
        if (lyricsElsewhere && delta === 0) return;
        applyVolume(volStart.current + delta);
      },
      onPanResponderRelease: (e, g) => {
        if (axis.current === 'h') {
          if (g.dx < -70 || (g.dx < -30 && g.vx < -0.6)) fly(-1);
          else if (g.dx > 70 || (g.dx > 30 && g.vx > 0.6)) fly(1);
          else Animated.spring(tx, { toValue: 0, useNativeDriver: true }).start();
          return;
        }
        if (hasLyricsRef.current && !onCover.current && g.dy < -60) {
          setPage('lyrics');
        }
      },
      onPanResponderTerminate: () => {
        if (axis.current === 'h') Animated.spring(tx, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  const songId = song ? song.id : null;

  // All covers stored inside this song (empty when it has one or none), and the one you picked.
  // They are only read after the opening animation is done, so the animation stays smooth.
  const covers = useCovers(song, visible && heavy);
  const [pinnedCover, setPinnedCover] = usePin(songId);
  useEffect(() => {
    setCoverPanel(false);
  }, [songId]);

  // Start from the player's current volume each time the player opens
  useEffect(() => {
    if (visible) {
      const v = typeof volume === 'number' ? volume : 1;
      volRef.current = v;
      setVol(v);
      tx.setValue(0);
      busy.current = false;
    }
  }, [visible]);

  // Load the lyrics for the playing song (so we know if it has lyrics at all). Starts after the opening animation.
  useEffect(() => {
    if (!visible || !heavy || !song) return undefined;
    let alive = true;
    lineY.current = {};
    if (song.lyricsEdit !== undefined) {
      setLyr({ id: song.id, loading: false, text: song.lyricsEdit, error: '' });
      return undefined;
    }
    setLyr({ id: song.id, loading: true, text: '', error: '' });
    fetchLyrics(song.uri).then((r) => {
      if (alive) setLyr({ id: song.id, loading: false, text: r.text, error: r.error });
    });
    return () => {
      alive = false;
    };
  }, [visible, heavy, songId, song ? song.lyricsEdit : undefined]);

  // Load technical details (and the file size) when the info page is open
  useEffect(() => {
    if (!visible || page !== 'info' || !song) return undefined;
    let alive = true;
    setDet({ id: song.id, loading: true, data: null });
    Promise.all([fetchDetails(song.uri), fileSizeOf(song.uri)]).then(([d, size]) => {
      if (alive) setDet({ id: song.id, loading: false, data: { ...(d || {}), _fileSize: size } });
    });
    return () => {
      alive = false;
    };
  }, [visible, page, songId]);

  const lyrText = lyr.id === songId ? lyr.text : '';
  const parsed = useMemo(() => parseLyrics(lyrText), [lyrText]);
  const hasLyrics = parsed.lines.length > 0;
  hasLyricsRef.current = hasLyrics;
  const activeLine = parsed.synced ? lyricIndexAt(parsed.lines, currentTime) : -1;

  // Keep the current synced lyric line in view
  useEffect(() => {
    if (page !== 'lyrics' || activeLine < 0 || !scrollRef.current) return;
    const y = lineY.current[activeLine];
    if (typeof y === 'number') {
      scrollRef.current.scrollTo({ y: Math.max(0, y - 140), animated: true });
    }
  }, [activeLine, page]);

  if (!song) return null;

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const artSize = Math.max(160, Math.min(width - 56, 380, height - 520));
  const infoRows = buildInfoRows(song, det.id === song.id ? det.data : null);
  const lyricsLoading = lyr.id !== songId || lyr.loading;
  const cardOpacity = tx.interpolate({ inputRange: [-width, 0, width], outputRange: [0.15, 1, 0.15], extrapolate: 'clamp' });
  const bgOp = open.interpolate({ inputRange: [0, 0.6], outputRange: [0, 1], extrapolate: 'clamp' });
  const contentOp = open.interpolate({ inputRange: [0.3, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const contentY = open.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });

  // The cover that flies between the mini player and its place on the player screen
  let floating = null;
  if (visible && page === 'player' && !coverReady && finalBox) {
    const ox = 44; // the mini player's cover (centre)
    const oy = height - insets.bottom - 40;
    const cx = finalBox.x + finalBox.w / 2;
    const cy = finalBox.y + finalBox.h / 2;
    floating = (
      <Animated.View
        pointerEvents="none"
        renderToHardwareTextureAndroid
        shouldRasterizeIOS
        style={{
          position: 'absolute',
          left: finalBox.x,
          top: finalBox.y,
          width: finalBox.w,
          height: finalBox.h,
          transform: [
            { translateX: open.interpolate({ inputRange: [0, 1], outputRange: [ox - cx, 0] }) },
            { translateY: open.interpolate({ inputRange: [0, 1], outputRange: [oy - cy, 0] }) },
            { scale: open.interpolate({ inputRange: [0, 1], outputRange: [44 / finalBox.w, 1] }) },
          ],
        }}
      >
        <Art song={song} size={finalBox.w} radius={28} />
      </Animated.View>
    );
  }

  const tabs = [
    { key: 'player', icon: 'image', label: 'Cover' },
    { key: 'lyrics', icon: 'document-text', label: 'Lyrics' },
    { key: 'info', icon: 'information-circle', label: 'Info' },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => {
        if (coverPanel) setCoverPanel(false);
        else if (verPanel) setVerPanel(false);
        else if (glowPanel) setGlowPanel(false);
        else if (eightPanel) setEightPanel(false);
        else requestClose();
      }}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={{ flex: 1 }}>
      <Animated.View style={{ flex: 1, opacity: bgOp, backgroundColor: '#FFFFFF' }} renderToHardwareTextureAndroid={!coverReady}>
      <LinearGradient
        colors={[t.accent + '66', t.bg, t.bg]}
        style={[s.full, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}
      >
        {/* The glowing background: behind everything, never blocks touches. It loads after the opening animation and fades in. */}
        {heavy ? (
          <FadeIn>
            <GlowBackground
              glow={glow}
              playing={playing}
              visible={visible}
              colors={{ accent: t.accent, accent2: t.accent2, bg: t.bg }}
              song={song}
              covers={covers}
              pinned={pinnedCover}
              currentTime={currentTime}
              nudge={page + (glowPanel ? 'g' : '') + (eightPanel ? 'e' : '') + (verPanel ? 'v' : '') + (coverPanel ? 'c' : '')}
            />
          </FadeIn>
        ) : null}

        <Animated.View style={{ flex: 1, opacity: contentOp, transform: [{ translateY: contentY }] }} renderToHardwareTextureAndroid={!coverReady}>
        <View style={s.fullTop}>
          <View style={{ width: 88, flexDirection: 'row' }}>
            <TouchableOpacity onPress={requestClose} style={s.fullTopBtn}>
              <Ionicons name="chevron-down" size={30} color={t.text} />
            </TouchableOpacity>
          </View>
          <Text style={s.fullTopTitle}>Now Playing</Text>
          <View style={{ width: 88, flexDirection: 'row', justifyContent: 'flex-end' }}>
            <TouchableOpacity onPress={() => setGlowPanel(true)} style={s.fullTopBtn}>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: t.accent,
                  borderWidth: 2,
                  borderColor: 'rgba(255,255,255,0.85)',
                }}
              >
                <Ionicons name="color-wand" size={20} color={t.onAccent} />
              </View>
            </TouchableOpacity>
            {onEdit ? (
              <TouchableOpacity onPress={() => onEdit(song)} style={s.fullTopBtn}>
                <Ionicons name="create-outline" size={24} color={t.text} />
              </TouchableOpacity>
            ) : (
              <View style={s.fullTopBtn} />
            )}
          </View>
        </View>

        {/* The card: cover / lyrics / info plus the song name. It slides when you swipe left or right. */}
        <Animated.View style={{ flex: 1, opacity: cardOpacity, transform: [{ translateX: tx }] }} {...pan.panHandlers}>
          <View style={s.pageArea}>
            {page === 'player' ? (
              <TouchableOpacity
                activeOpacity={1}
                onPress={onCoverTap}
                onLongPress={() => {
                  if (covers.length >= 2) setCoverPanel(true);
                }}
                delayLongPress={450}
                style={{ flex: 1 }}
              >
                <View style={s.fullArt}>
                  <View ref={coverBox} collapsable={false} onLayout={measureCover} style={{ opacity: coverReady ? 1 : 0 }}>
                    {covers.length >= 2 ? (
                      <CoverShow
                        key={song.id}
                        covers={covers}
                        size={artSize}
                        radius={28}
                        currentTime={currentTime}
                        pinned={pinnedCover}
                      />
                    ) : (
                      <Art song={song} size={artSize} radius={28} />
                    )}
                  </View>
                </View>
                {flash !== 0 ? (
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      [flash < 0 ? 'left' : 'right']: 0,
                      width: '40%',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <View style={{ alignItems: 'center', padding: 14, borderRadius: 40, backgroundColor: 'rgba(0,0,0,0.55)' }}>
                      <Ionicons name={flash < 0 ? 'play-back' : 'play-forward'} size={28} color="#fff" />
                      <Text style={{ color: '#fff', fontWeight: '800', marginTop: 2 }}>{flash < 0 ? '-10s' : '+10s'}</Text>
                    </View>
                  </View>
                ) : null}
              </TouchableOpacity>
            ) : null}

            {page === 'lyrics' ? (
              lyricsLoading ? (
                <View style={s.pageCenter}>
                  <ActivityIndicator color={t.accent} size="large" />
                </View>
              ) : parsed.lines.length === 0 ? (
                <View style={s.pageCenter}>
                  <Ionicons name="document-text-outline" size={44} color={t.muted} />
                  <Text style={s.pageEmptyText}>No lyrics found inside this song's file.</Text>
                  {lyr.error ? <Text style={s.pageErrorText}>{lyr.error}</Text> : null}
                </View>
              ) : (
                <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={s.lyricsContent}>
                  {parsed.lines.map((line, i) => {
                    const on = parsed.synced && i === activeLine;
                    const wordMode = on && line.words && line.words.length > 0;
                    return (
                      <TouchableOpacity
                        key={i}
                        activeOpacity={parsed.synced ? 0.6 : 1}
                        onPress={() => {
                          if (parsed.synced) onSeek(line.t);
                        }}
                        onLayout={(e) => {
                          lineY.current[i] = e.nativeEvent.layout.y;
                        }}
                      >
                        <Text
                          style={[
                            s.lyricLine,
                            parsed.synced && !on && s.lyricLineDim,
                            on && !wordMode && { color: t.accent, fontWeight: '800' },
                            on && wordMode && { fontWeight: '800' },
                          ]}
                        >
                          {wordMode
                            ? line.words.map((w, wi) => {
                                const sung = currentTime + 0.05 >= w.t;
                                return (
                                  <Text key={wi} style={{ color: sung ? t.accent : t.text, opacity: sung ? 1 : 0.55 }}>
                                    {w.text}
                                  </Text>
                                );
                              })
                            : line.text === ''
                            ? ' '
                            : line.text}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )
            ) : null}

            {page === 'info' ? (
              det.loading ? (
                <View style={s.pageCenter}>
                  <ActivityIndicator color={t.accent} size="large" />
                </View>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {infoRows.map((r, i) => (
                    <View key={i} style={s.infoRow}>
                      <Text style={s.infoLabel}>{r[0]}</Text>
                      <Text style={s.infoValue}>{r[1]}</Text>
                    </View>
                  ))}
                  {det.data && det.data._error ? <Text style={s.pageErrorText}>{det.data._error}</Text> : null}
                </ScrollView>
              )
            ) : null}
          </View>

          {/* Title, artist, album, and the favorite heart */}
          <View style={s.fullInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 44 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.fullTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {song.title}
                </Text>
                <Text style={s.fullArtist} numberOfLines={1}>
                  {song.artist || 'Unknown artist'}
                  {song.album ? '  •  ' + song.album : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={onToggleFav}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={28} color={isFav ? t.accent : t.text} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
              <Text style={s.fullSub}>
                {index + 1} of {total}
              </Text>
              <TouchableOpacity
                onPress={onToggleEightD}
                activeOpacity={0.8}
                style={{
                  marginLeft: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderRadius: 16,
                  borderWidth: 1.5,
                  borderColor: eightD ? t.accent : t.muted,
                  backgroundColor: eightD ? t.accent : 'transparent',
                }}
              >
                <Ionicons name="headset" size={15} color={eightD ? '#fff' : t.muted} />
                <Text style={{ marginLeft: 5, fontSize: 13, fontWeight: '800', color: eightD ? '#fff' : t.muted }}>8D</Text>
              </TouchableOpacity>
              {eightD ? (
                <TouchableOpacity
                  onPress={() => setEightPanel(true)}
                  activeOpacity={0.8}
                  style={{
                    marginLeft: 8,
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1.5,
                    borderColor: t.accent,
                  }}
                >
                  <Ionicons name="options" size={17} color={t.accent} />
                </TouchableOpacity>
              ) : null}
            </View>
            {versions && versions.length > 1 ? (
              <View style={{ alignItems: 'center', marginTop: 10 }}>
                <TouchableOpacity
                  onPress={() => setVerPanel(true)}
                  activeOpacity={0.8}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                    borderRadius: 18,
                    borderWidth: 1.5,
                    borderColor: t.accent,
                  }}
                >
                  <Ionicons name="layers" size={16} color={t.accent} />
                  <Text style={{ marginLeft: 6, fontSize: 13, fontWeight: '800', color: t.accent }} numberOfLines={1}>
                    {'Versions · ' + versions.length + (song.versionLabel ? '  (' + song.versionLabel + ')' : '')}
                  </Text>
                  <Ionicons name="chevron-up" size={15} color={t.accent} style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </Animated.View>

        <View style={s.fullSeek}>
          <SeekBar progress={progress} onSeek={(f) => onSeek(f * duration)} />
          <View style={s.timeRow}>
            <Text style={s.time}>{formatTime(currentTime)}</Text>
            <Text style={s.time}>{formatTime(duration)}</Text>
          </View>
        </View>

        <View style={s.controls}>
          <TouchableOpacity onPress={onToggleShuffle} style={s.ctrlSmall}>
            <Ionicons name="shuffle" size={26} color={shuffle ? t.accent : t.muted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onPrev} style={s.ctrlMid}>
            <Ionicons name="play-skip-back" size={34} color={t.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onTogglePlay} activeOpacity={0.85}>
            <LinearGradient
              colors={[t.accent, t.accent2]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.bigPlay}
            >
              <Ionicons
                name={playing ? 'pause' : 'play'}
                size={38}
                color="#fff"
                style={playing ? null : { marginLeft: 4 }}
              />
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity onPress={onNext} style={s.ctrlMid}>
            <Ionicons name="play-skip-forward" size={34} color={t.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onCycleRepeat} style={s.ctrlSmall}>
            <Ionicons name="repeat" size={26} color={repeat === 'off' ? t.muted : t.accent} />
            {repeat === 'one' ? <Text style={[s.repeatOne, { color: t.accent }]}>1</Text> : null}
          </TouchableOpacity>
        </View>

        <View style={s.pageTabs}>
          {tabs.map((tab) => {
            const on = page === tab.key;
            return (
              <TouchableOpacity key={tab.key} style={s.pageTab} onPress={() => setPage(tab.key)} activeOpacity={0.7}>
                <Ionicons name={tab.icon} size={22} color={on ? t.accent : t.muted} />
                <Text style={[s.pageTabText, on && { color: t.accent }]}>{tab.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        </Animated.View>

        {/* Cover sheet: hold the cover to choose which of the covers inside the song is shown */}
        <CoverSheet
          visible={coverPanel}
          covers={covers}
          pinned={pinnedCover}
          bottomInset={insets.bottom}
          onClose={() => setCoverPanel(false)}
          onPick={(i) => {
            setPinnedCover(i);
            setCoverPanel(false);
          }}
        />

        {/* Versions sheet: every version in the bundle, each with its own cover, title, artist and writer */}
        {verPanel && versions ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' }}>
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setVerPanel(false)}
              style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}
            />
            <View
              style={{
                backgroundColor: t.card,
                borderTopLeftRadius: 26,
                borderTopRightRadius: 26,
                paddingHorizontal: 16,
                paddingTop: 14,
                paddingBottom: insets.bottom + 18,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: t.text, fontSize: 18, fontWeight: '800' }}>Versions</Text>
                <TouchableOpacity onPress={() => setVerPanel(false)} style={{ padding: 6 }}>
                  <Ionicons name="close" size={24} color={t.muted} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: height * 0.65, marginTop: 6 }} showsVerticalScrollIndicator={false}>
                {versions.map((v) => {
                  const on = v.id === song.id;
                  const sub = [v.artist, v.composer ? 'Writer: ' + v.composer : ''].filter(Boolean).join('  •  ');
                  return (
                    <TouchableOpacity
                      key={v.id}
                      activeOpacity={0.7}
                      onPress={() => {
                        setVerPanel(false);
                        if (!on && onPickVersion) onPickVersion(v);
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginTop: 10,
                        padding: 10,
                        borderRadius: 16,
                        borderWidth: 1.5,
                        borderColor: on ? t.accent : t.track,
                      }}
                    >
                      <Art song={v} size={56} radius={12} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ color: t.accent, fontSize: 11, fontWeight: '800' }} numberOfLines={1}>
                          {String(v.versionLabel || 'Version').toUpperCase()}
                        </Text>
                        <Text style={{ color: t.text, fontSize: 15, fontWeight: '700', marginTop: 1 }} numberOfLines={1}>
                          {v.title}
                        </Text>
                        {sub ? (
                          <Text style={{ color: t.muted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
                            {sub}
                          </Text>
                        ) : null}
                      </View>
                      {on ? <Ionicons name="volume-high" size={20} color={t.accent} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        ) : null}

        {/* Background glow settings sheet */}
        {glowPanel ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' }}>
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setGlowPanel(false)}
              style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)' }}
            />
            <View
              style={{
                backgroundColor: t.card,
                borderTopLeftRadius: 26,
                borderTopRightRadius: 26,
                paddingHorizontal: 20,
                paddingTop: 14,
                paddingBottom: insets.bottom + 18,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: t.text, fontSize: 18, fontWeight: '800' }}>Background glow</Text>
                <TouchableOpacity onPress={() => setGlowPanel(false)} style={{ padding: 6 }}>
                  <Ionicons name="close" size={24} color={t.muted} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: height * 0.7 }} showsVerticalScrollIndicator={false}>
                <Text style={{ color: t.text, fontSize: 14, fontWeight: '700', marginTop: 14 }}>Style</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 8 }}>
                  {GLOW_STYLES.map((g) => {
                    const on = glow.style === g.key;
                    return (
                      <TouchableOpacity
                        key={g.key}
                        onPress={() => changeGlow({ style: g.key })}
                        activeOpacity={0.8}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 14,
                          borderWidth: 1,
                          borderColor: on ? t.accent : t.track,
                          backgroundColor: on ? t.accent : 'transparent',
                        }}
                      >
                        <Ionicons name={g.icon} size={15} color={on ? t.onAccent : t.muted} />
                        <Text style={{ marginLeft: 5, fontSize: 13, fontWeight: '800', color: on ? t.onAccent : t.muted }}>{g.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={{ color: t.text, fontSize: 14, fontWeight: '700', marginTop: 16 }}>Color</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 12 }}>
                  {GLOW_COLORS.map((c) => {
                    const on = glow.color === c.key;
                    const wide = c.key === 'cover';
                    return (
                      <TouchableOpacity
                        key={c.key}
                        onPress={() => changeGlow({ color: c.key })}
                        activeOpacity={0.8}
                        style={{
                          width: wide ? 150 : 38,
                          height: 38,
                          borderRadius: 19,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: c.swatch || t.accent,
                          borderWidth: on ? 3 : 1,
                          borderColor: on ? '#FFFFFF' : 'rgba(255,255,255,0.25)',
                        }}
                      >
                        {c.icon ? <Ionicons name={c.icon} size={18} color="#FFFFFF" /> : null}
                        {wide ? <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 13, marginLeft: 6 }}>{c.label}</Text> : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          </View>
        ) : null}

        {/* 8D settings sheet */}
        {eightPanel ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' }}>
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setEightPanel(false)}
              style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}
            />
            <View
              style={{
                backgroundColor: t.card,
                borderTopLeftRadius: 26,
                borderTopRightRadius: 26,
                paddingHorizontal: 20,
                paddingTop: 14,
                paddingBottom: insets.bottom + 18,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: t.text, fontSize: 18, fontWeight: '800' }}>8D settings</Text>
                <TouchableOpacity onPress={() => setEightPanel(false)} style={{ padding: 6 }}>
                  <Ionicons name="close" size={24} color={t.muted} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: height * 0.7 }} showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', marginTop: 12, backgroundColor: t.track, borderRadius: 14, padding: 3 }}>
                {[
                  { key: 'auto', icon: 'sync', label: 'Automatic' },
                  { key: 'tilt', icon: 'phone-portrait', label: 'Tilt' },
                ].map((m) => {
                  const on = eset.mode === m.key;
                  return (
                    <TouchableOpacity
                      key={m.key}
                      onPress={() => chooseMode(m.key)}
                      activeOpacity={0.8}
                      style={{
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingVertical: 9,
                        borderRadius: 11,
                        backgroundColor: on ? t.accent : 'transparent',
                      }}
                    >
                      <Ionicons name={m.icon} size={16} color={on ? t.onAccent : t.muted} />
                      <Text style={{ marginLeft: 6, fontSize: 14, fontWeight: '800', color: on ? t.onAccent : t.muted }}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ color: t.muted, fontSize: 12, marginTop: 8 }}>
                {eset.mode === 'tilt'
                  ? 'Tilt your phone left or right to move the sound. Hold it level for the center.'
                  : 'The sound keeps rotating around you by itself.'}
              </Text>

              <Text style={{ color: t.text, fontSize: 14, fontWeight: '700', marginTop: 16 }}>Hall</Text>
              <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
                {HALLS.map((h) => {
                  const on = Math.abs(eset.room - h.patch.room) < 0.03 && Math.abs(eset.reverb - h.patch.reverb) < 0.03;
                  return (
                    <TouchableOpacity
                      key={h.key}
                      onPress={() => changeEight(h.patch)}
                      activeOpacity={0.8}
                      style={{
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingVertical: 10,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: on ? t.accent : t.track,
                        backgroundColor: on ? t.accent : 'transparent',
                      }}
                    >
                      <Ionicons name={h.icon} size={15} color={on ? t.onAccent : t.muted} />
                      <Text style={{ marginLeft: 5, fontSize: 13, fontWeight: '800', color: on ? t.onAccent : t.muted }}>{h.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <EightSlider label="Room size" value={eset.room} onChange={(v) => changeEight({ room: v })} />
              <EightSlider
                label="Rotation speed"
                value={eset.speed}
                onChange={(v) => changeEight({ speed: v })}
                disabled={eset.mode === 'tilt'}
                note={eset.mode === 'tilt' ? 'Not used in tilt mode' : null}
              />
              <EightSlider label="Movement intensity" value={eset.intensity} onChange={(v) => changeEight({ intensity: v })} />
              <EightSlider label="Reverb" value={eset.reverb} onChange={(v) => changeEight({ reverb: v })} />
              <EightSlider
                label="Bass"
                value={eset.bass}
                onChange={(v) => changeEight({ bass: Math.abs(v - 0.5) < 0.025 ? 0.5 : v })}
                format={bassLabel}
                note="The middle is the normal bass. Left = less, right = more."
              />
              </ScrollView>
            </View>
          </View>
        ) : null}

        {/* Volume pill, shows while you swipe up / down */}
        {volShown ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 80, alignItems: 'center' }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 22,
                backgroundColor: 'rgba(0,0,0,0.7)',
              }}
            >
              <Ionicons name={volumeIcon(vol)} size={22} color="#fff" />
              <View style={{ width: 120, height: 5, borderRadius: 3, marginHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.25)' }}>
                <View style={{ width: vol * 120, height: 5, borderRadius: 3, backgroundColor: '#fff' }} />
              </View>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', width: 38 }}>{Math.round(vol * 100) + '%'}</Text>
            </View>
          </View>
        ) : null}
      </LinearGradient>
      </Animated.View>
      {floating}
      </View>
    </Modal>
  );
}
