import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  StatusBar,
  Modal,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';

// Songs shorter than this (in seconds) are hidden, so ringtones don't show up.
const MIN_SECONDS = 30;

const BG = '#0B0B10';
const CARD = '#16161D';
const TEXT = '#FFFFFF';
const MUTED = '#9A9AA8';
const ACCENT = '#A78BFA';
const ACCENT2 = '#EC4899';

const GRADIENTS = [
  ['#8B5CF6', '#EC4899'],
  ['#06B6D4', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
  ['#10B981', '#06B6D4'],
  ['#F43F5E', '#8B5CF6'],
  ['#84CC16', '#10B981'],
  ['#6366F1', '#EC4899'],
  ['#F97316', '#F59E0B'],
];

function gradientFor(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  return GRADIENTS[h % GRADIENTS.length];
}

function cleanTitle(filename) {
  const noExt = (filename || 'Unknown').replace(/\.[^/.]+$/, '');
  return noExt.replace(/_/g, ' ').trim() || 'Unknown';
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function Art({ title, size, radius }) {
  const g = gradientFor(title || '?');
  const letter = (title || '?').trim().charAt(0).toUpperCase() || '?';
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

const SongRow = React.memo(function SongRow({ song, index, active, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.7} style={styles.row} onPress={() => onPress(index)}>
      <Art title={song.title} size={48} radius={12} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, active && { color: ACCENT }]} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.rowSub}>{formatTime(song.duration)}</Text>
      </View>
      {active ? <Ionicons name="musical-notes" size={20} color={ACCENT} /> : null}
    </TouchableOpacity>
  );
});

function SeekBar({ progress, onSeek }) {
  const widthRef = useRef(1);
  const [drag, setDrag] = useState(null);

  const getFraction = (e) => {
    const x = e.nativeEvent.locationX / widthRef.current;
    return Math.max(0, Math.min(1, x));
  };

  const shown = drag !== null ? drag : progress;

  return (
    <View
      style={styles.seekTouch}
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
      <View pointerEvents="none" style={styles.seekInner}>
        <View style={styles.seekTrack}>
          <View style={[styles.seekFill, { width: shown * 100 + '%' }]} />
        </View>
        <View style={[styles.seekThumb, { left: shown * 100 + '%' }]} />
      </View>
    </View>
  );
}

function MusicApp() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [permission, setPermission] = useState('checking'); // checking | granted | denied
  const [loading, setLoading] = useState(false);
  const [songs, setSongs] = useState([]);
  const [query, setQuery] = useState('');
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // off | all | one

  const historyRef = useRef([]);

  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  const current = currentIndex >= 0 ? queue[currentIndex] : null;

  // ---------- Start up: audio mode + permissions ----------
  useEffect(() => {
    (async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'doNotMix',
        });
      } catch (e) {}
      await ensurePermission();
    })();
  }, []);

  async function ensurePermission() {
    try {
      let perm = await MediaLibrary.getPermissionsAsync(false, ['audio']);
      if (!perm.granted) {
        perm = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
      }
      if (perm.granted) {
        setPermission('granted');
        if (Platform.OS === 'android' && Platform.Version >= 33) {
          try {
            await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
          } catch (e) {}
        }
        loadSongs();
      } else {
        setPermission('denied');
      }
    } catch (e) {
      setPermission('denied');
    }
  }

  async function loadSongs() {
    setLoading(true);
    try {
      const all = [];
      let after = undefined;
      let hasNext = true;
      while (hasNext) {
        const page = await MediaLibrary.getAssetsAsync({
          mediaType: MediaLibrary.MediaType.audio,
          first: 1000,
          after: after,
        });
        for (const a of page.assets) {
          if (a.duration >= MIN_SECONDS) {
            all.push({
              id: a.id,
              uri: a.uri,
              title: cleanTitle(a.filename),
              duration: a.duration,
            });
          }
        }
        hasNext = page.hasNextPage;
        after = page.endCursor;
      }
      all.sort((x, y) => x.title.localeCompare(y.title));
      setSongs(all);
    } catch (e) {}
    setLoading(false);
  }

  // ---------- Search ----------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) => s.title.toLowerCase().includes(q));
  }, [songs, query]);

  // ---------- Playback ----------
  const playAt = useCallback(
    (list, idx) => {
      const song = list[idx];
      if (!song) return;
      setQueue(list);
      setCurrentIndex(idx);
      try {
        player.replace({ uri: song.uri });
        player.play();
        player.setActiveForLockScreen(true, { title: song.title, artist: 'My Music' });
      } catch (e) {}
    },
    [player]
  );

  const onSongPress = useCallback(
    (index) => {
      historyRef.current = [];
      playAt(filtered, index);
    },
    [filtered, playAt]
  );

  function playAll(shuffleMode) {
    if (filtered.length === 0) return;
    historyRef.current = [];
    setShuffle(shuffleMode);
    const idx = shuffleMode ? Math.floor(Math.random() * filtered.length) : 0;
    playAt(filtered, idx);
  }

  function togglePlay() {
    if (!current) {
      playAll(false);
      return;
    }
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  }

  function goNext(auto) {
    if (queue.length === 0) return;
    if (auto && repeat === 'one') {
      player.seekTo(0);
      player.play();
      return;
    }
    let nextIdx;
    if (shuffle && queue.length > 1) {
      do {
        nextIdx = Math.floor(Math.random() * queue.length);
      } while (nextIdx === currentIndex);
    } else {
      nextIdx = currentIndex + 1;
      if (nextIdx >= queue.length) {
        if (repeat === 'all' || !auto) {
          nextIdx = 0;
        } else {
          player.pause();
          player.seekTo(0);
          return;
        }
      }
    }
    historyRef.current.push(currentIndex);
    playAt(queue, nextIdx);
  }

  function goPrev() {
    if (queue.length === 0) return;
    if (status.currentTime > 3) {
      player.seekTo(0);
      return;
    }
    if (historyRef.current.length > 0) {
      const prevIdx = historyRef.current.pop();
      playAt(queue, prevIdx);
      return;
    }
    let prevIdx = currentIndex - 1;
    if (prevIdx < 0) prevIdx = queue.length - 1;
    playAt(queue, prevIdx);
  }

  // Auto-play the next song when one finishes.
  useEffect(() => {
    if (status.didJustFinish) {
      goNext(true);
    }
  }, [status.didJustFinish]);

  function cycleRepeat() {
    setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'));
  }

  const duration = status.duration || (current ? current.duration : 0) || 0;
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;
  const currentId = current ? current.id : null;

  const renderItem = useCallback(
    ({ item, index }) => (
      <SongRow song={item} index={index} active={item.id === currentId} onPress={onSongPress} />
    ),
    [currentId, onSongPress]
  );

  const artSize = Math.min(width - 72, 340);

  // ---------- Screens ----------
  if (permission === 'checking') {
    return (
      <View style={[styles.center, { backgroundColor: BG }]}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <ActivityIndicator color={ACCENT} size="large" />
      </View>
    );
  }

  if (permission === 'denied') {
    return (
      <View style={[styles.center, { backgroundColor: BG, padding: 32 }]}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <Ionicons name="musical-notes" size={64} color={ACCENT} />
        <Text style={styles.bigTitle}>My Music</Text>
        <Text style={styles.centerText}>
          I need permission to see the music on your phone, so I can play it.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={ensurePermission}>
          <Text style={styles.primaryButtonText}>Allow access</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkButton} onPress={() => Linking.openSettings()}>
          <Text style={styles.linkText}>Open phone settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.bigTitle}>My Music</Text>
        <Text style={styles.headerSub}>{songs.length} songs</Text>
      </View>

      {/* Search */}
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={MUTED} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search songs"
          placeholderTextColor={MUTED}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
        {query.length > 0 ? (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={MUTED} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Play all / Shuffle */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={{ flex: 1 }} onPress={() => playAll(false)} activeOpacity={0.8}>
          <LinearGradient
            colors={[ACCENT, ACCENT2]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.actionButton}
          >
            <Ionicons name="play" size={18} color="#fff" />
            <Text style={styles.actionText}>Play all</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonDark, { flex: 1 }]}
          onPress={() => playAll(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="shuffle" size={18} color={TEXT} />
          <Text style={styles.actionText}>Shuffle</Text>
        </TouchableOpacity>
      </View>

      {/* Song list */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={ACCENT} size="large" />
          <Text style={[styles.centerText, { marginTop: 12 }]}>Finding your music...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          extraData={currentId}
          getItemLayout={(data, index) => ({ length: 64, offset: 64 * index, index })}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={10}
          removeClippedSubviews
          contentContainerStyle={{ paddingBottom: (current ? 96 : 24) + insets.bottom }}
          ListEmptyComponent={
            <Text style={[styles.centerText, { marginTop: 40 }]}>
              {songs.length === 0 ? 'No songs found on your phone.' : 'No songs match your search.'}
            </Text>
          }
        />
      )}

      {/* Mini player */}
      {current ? (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => setPlayerOpen(true)}
          style={[styles.mini, { bottom: insets.bottom + 8 }]}
        >
          <View style={styles.miniProgressBg}>
            <View style={[styles.miniProgressFill, { width: progress * 100 + '%' }]} />
          </View>
          <Art title={current.title} size={44} radius={10} />
          <Text style={styles.miniTitle} numberOfLines={1}>
            {current.title}
          </Text>
          <TouchableOpacity onPress={goPrev} style={styles.miniBtn}>
            <Ionicons name="play-skip-back" size={22} color={TEXT} />
          </TouchableOpacity>
          <TouchableOpacity onPress={togglePlay} style={styles.miniBtn}>
            <Ionicons name={status.playing ? 'pause' : 'play'} size={28} color={TEXT} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => goNext(false)} style={styles.miniBtn}>
            <Ionicons name="play-skip-forward" size={22} color={TEXT} />
          </TouchableOpacity>
        </TouchableOpacity>
      ) : null}

      {/* Full Now Playing screen */}
      <Modal
        visible={playerOpen && !!current}
        animationType="slide"
        onRequestClose={() => setPlayerOpen(false)}
        statusBarTranslucent
        navigationBarTranslucent
      >
        {current ? (
          <LinearGradient
            colors={[gradientFor(current.title)[0] + '88', BG, BG]}
            style={[
              styles.full,
              { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
            ]}
          >
            <View style={styles.fullTop}>
              <TouchableOpacity onPress={() => setPlayerOpen(false)} style={styles.fullTopBtn}>
                <Ionicons name="chevron-down" size={30} color={TEXT} />
              </TouchableOpacity>
              <Text style={styles.fullTopTitle}>Now Playing</Text>
              <View style={styles.fullTopBtn} />
            </View>

            <View style={styles.fullArt}>
              <Art title={current.title} size={artSize} radius={28} />
            </View>

            <View style={styles.fullInfo}>
              <Text style={styles.fullTitle} numberOfLines={2}>
                {current.title}
              </Text>
              <Text style={styles.fullSub}>
                {currentIndex + 1} of {queue.length}
              </Text>
            </View>

            <View style={styles.fullSeek}>
              <SeekBar progress={progress} onSeek={(f) => player.seekTo(f * duration)} />
              <View style={styles.timeRow}>
                <Text style={styles.time}>{formatTime(status.currentTime)}</Text>
                <Text style={styles.time}>{formatTime(duration)}</Text>
              </View>
            </View>

            <View style={styles.controls}>
              <TouchableOpacity onPress={() => setShuffle(!shuffle)} style={styles.ctrlSmall}>
                <Ionicons name="shuffle" size={26} color={shuffle ? ACCENT : MUTED} />
              </TouchableOpacity>
              <TouchableOpacity onPress={goPrev} style={styles.ctrlMid}>
                <Ionicons name="play-skip-back" size={34} color={TEXT} />
              </TouchableOpacity>
              <TouchableOpacity onPress={togglePlay} activeOpacity={0.85}>
                <LinearGradient
                  colors={[ACCENT, ACCENT2]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.bigPlay}
                >
                  <Ionicons
                    name={status.playing ? 'pause' : 'play'}
                    size={38}
                    color="#fff"
                    style={status.playing ? null : { marginLeft: 4 }}
                  />
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => goNext(false)} style={styles.ctrlMid}>
                <Ionicons name="play-skip-forward" size={34} color={TEXT} />
              </TouchableOpacity>
              <TouchableOpacity onPress={cycleRepeat} style={styles.ctrlSmall}>
                <Ionicons name="repeat" size={26} color={repeat === 'off' ? MUTED : ACCENT} />
                {repeat === 'one' ? <Text style={styles.repeatOne}>1</Text> : null}
              </TouchableOpacity>
            </View>
          </LinearGradient>
        ) : null}
      </Modal>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MusicApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { color: MUTED, fontSize: 15, textAlign: 'center' },

  header: { paddingHorizontal: 20, marginBottom: 14 },
  bigTitle: { color: TEXT, fontSize: 32, fontWeight: '800' },
  headerSub: { color: MUTED, fontSize: 14, marginTop: 2 },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    marginHorizontal: 20,
    paddingHorizontal: 14,
    borderRadius: 16,
    height: 48,
  },
  searchInput: { flex: 1, color: TEXT, fontSize: 16, marginLeft: 10 },

  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 14,
    marginBottom: 8,
    gap: 12,
  },
  actionButton: {
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionButtonDark: { backgroundColor: CARD },
  actionText: { color: TEXT, fontSize: 16, fontWeight: '700' },

  row: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  rowText: { flex: 1, marginLeft: 14, marginRight: 10 },
  rowTitle: { color: TEXT, fontSize: 16, fontWeight: '600' },
  rowSub: { color: MUTED, fontSize: 13, marginTop: 3 },

  mini: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 64,
    backgroundColor: CARD,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    overflow: 'hidden',
    elevation: 8,
  },
  miniProgressBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#2A2A35',
  },
  miniProgressFill: { height: 3, backgroundColor: ACCENT },
  miniTitle: { flex: 1, color: TEXT, fontSize: 15, fontWeight: '600', marginLeft: 12 },
  miniBtn: { paddingHorizontal: 8, paddingVertical: 8 },

  full: { flex: 1, paddingHorizontal: 28 },
  fullTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fullTopBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  fullTopTitle: { color: TEXT, fontSize: 16, fontWeight: '700' },
  fullArt: { alignItems: 'center', marginTop: 28 },
  fullInfo: { marginTop: 32 },
  fullTitle: { color: TEXT, fontSize: 24, fontWeight: '800' },
  fullSub: { color: MUTED, fontSize: 14, marginTop: 6 },
  fullSeek: { marginTop: 24 },

  seekTouch: { height: 32, justifyContent: 'center' },
  seekInner: { height: 32, justifyContent: 'center' },
  seekTrack: {
    height: 6,
    backgroundColor: '#33333F',
    borderRadius: 3,
    overflow: 'hidden',
  },
  seekFill: { height: 6, backgroundColor: ACCENT },
  seekThumb: {
    position: 'absolute',
    top: 9,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: '#fff',
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  time: { color: MUTED, fontSize: 12 },

  controls: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ctrlSmall: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ctrlMid: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  bigPlay: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repeatOne: {
    position: 'absolute',
    color: ACCENT,
    fontSize: 10,
    fontWeight: '800',
    top: 14,
  },

  primaryButton: {
    marginTop: 28,
    backgroundColor: ACCENT,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 28,
  },
  primaryButtonText: { color: '#000', fontSize: 16, fontWeight: '800' },
  linkButton: { marginTop: 18, padding: 8 },
  linkText: { color: ACCENT, fontSize: 15 },
});
