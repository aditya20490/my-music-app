// The full-screen player: cover, lyrics, song details and the big controls.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  PanResponder,
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
  onNext,
  onSwipePrev,
  onTogglePlay,
  onSeek,
  onEdit,
}) {
  const { t, s } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [page, setPage] = useState('player'); // player | lyrics | info
  const [lyr, setLyr] = useState({ id: null, loading: false, text: '', error: '' });
  const [det, setDet] = useState({ id: null, loading: false, data: null });
  const scrollRef = useRef(null);
  const lineY = useRef({});

  // Swipe left = next song, swipe right = previous song
  const swipeActions = useRef({ next: null, prev: null });
  swipeActions.current.next = onNext;
  swipeActions.current.prev = onSwipePrev || onPrev;
  const swipe = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (e, g) => Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => true,
      onPanResponderRelease: (e, g) => {
        if (g.dx < -60) {
          if (swipeActions.current.next) swipeActions.current.next();
        } else if (g.dx > 60) {
          if (swipeActions.current.prev) swipeActions.current.prev();
        }
      },
    })
  ).current;

  const songId = song ? song.id : null;

  // Load lyrics when the lyrics page is open
  useEffect(() => {
    if (!visible || page !== 'lyrics' || !song) return undefined;
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
  }, [visible, page, songId, song ? song.lyricsEdit : undefined]);

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

  const parsed = useMemo(() => parseLyrics(lyr.text), [lyr.text]);
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

        {/* Middle area: cover, lyrics or info. Swipe left / right here to change the song. */}
        <View style={s.pageArea} {...swipe.panHandlers}>
          {page === 'player' ? (
            <View style={s.fullArt}>
              <Art song={song} size={artSize} radius={28} />
            </View>
          ) : null}

          {page === 'lyrics' ? (
            lyr.loading ? (
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
                          on && { color: t.accent, fontWeight: '800' },
                        ]}
                      >
                        {line.text === '' ? ' ' : line.text}
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
        <View style={s.fullInfo} {...swipe.panHandlers}>
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
      </LinearGradient>
    </Modal>
  );
}
