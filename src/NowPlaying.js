// The full-screen player: cover, lyrics, song details and the big controls.
// Swipe left / right = change song (the card slides). Swipe up / down = volume.
// If the song has lyrics: swipe up anywhere except on the cover opens the lyrics.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
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
import { fetchLyrics, fetchDetails } from './library';
import { formatTime, parseLyrics, lyricIndexAt } from './utils';

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
  if (det.bitrate) add('Bitrate', Math.round(det.bitrate / 1000) + ' kbps');
  if (det.sampleRate) add('Sample rate', (det.sampleRate / 1000).toFixed(1) + ' kHz');
  if (det.channelCount) add('Channels', det.channelCount === 1 ? 'Mono' : det.channelCount === 2 ? 'Stereo' : det.channelCount);
  add('Format', det.codecs);
  add('File name', song.filename);
  return rows;
}

function volumeIcon(v) {
  if (v <= 0.01) return 'volume-mute';
  if (v < 0.4) return 'volume-low';
  if (v < 0.75) return 'volume-medium';
  return 'volume-high';
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
}) {
  const { t, s } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [page, setPage] = useState('player'); // player | lyrics | info
  const [lyr, setLyr] = useState({ id: null, loading: false, text: '', error: '' });
  const [det, setDet] = useState({ id: null, loading: false, data: null });
  const [vol, setVol] = useState(typeof volume === 'number' ? volume : 1);
  const [volShown, setVolShown] = useState(false);
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

  const measureCover = () => {
    if (coverBox.current && coverBox.current.measureInWindow) {
      coverBox.current.measureInWindow((x, y, w, h) => {
        coverRect.current = { x, y, w, h };
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

  // Load the lyrics for the playing song (so we know if it has lyrics at all)
  useEffect(() => {
    if (!visible || !song) return undefined;
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
  }, [visible, songId, song ? song.lyricsEdit : undefined]);

  // Load technical details when the info page is open
  useEffect(() => {
    if (!visible || page !== 'info' || !song) return undefined;
    let alive = true;
    setDet({ id: song.id, loading: true, data: null });
    fetchDetails(song.uri).then((d) => {
      if (alive) setDet({ id: song.id, loading: false, data: d });
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
  const artSize = Math.max(150, Math.min(width - 72, 340, height - 560));
  const infoRows = buildInfoRows(song, det.id === song.id ? det.data : null);
  const lyricsLoading = lyr.id !== songId || lyr.loading;
  const cardOpacity = tx.interpolate({ inputRange: [-width, 0, width], outputRange: [0.15, 1, 0.15], extrapolate: 'clamp' });

  const tabs = [
    { key: 'player', icon: 'image', label: 'Cover' },
    { key: 'lyrics', icon: 'document-text', label: 'Lyrics' },
    { key: 'info', icon: 'information-circle', label: 'Info' },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <LinearGradient
        colors={[t.accent + '66', t.bg, t.bg]}
        style={[s.full, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}
      >
        <View style={s.fullTop}>
          <TouchableOpacity onPress={onClose} style={s.fullTopBtn}>
            <Ionicons name="chevron-down" size={30} color={t.text} />
          </TouchableOpacity>
          <Text style={s.fullTopTitle}>Now Playing</Text>
          {onEdit ? (
            <TouchableOpacity onPress={() => onEdit(song)} style={s.fullTopBtn}>
              <Ionicons name="create-outline" size={24} color={t.text} />
            </TouchableOpacity>
          ) : (
            <View style={s.fullTopBtn} />
          )}
        </View>

        {/* The card: cover / lyrics / info plus the song name. It slides when you swipe left or right. */}
        <Animated.View style={{ flex: 1, opacity: cardOpacity, transform: [{ translateX: tx }] }} {...pan.panHandlers}>
          <View style={s.pageArea}>
            {page === 'player' ? (
              <View style={s.fullArt}>
                <View ref={coverBox} collapsable={false} onLayout={measureCover}>
                  <Art song={song} size={artSize} radius={28} />
                </View>
              </View>
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
                <Text style={s.fullTitle} numberOfLines={2}>
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
            <Text style={s.fullSub}>
              {index + 1} of {total}
            </Text>
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
    </Modal>
  );
}
