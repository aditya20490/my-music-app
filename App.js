import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Image,
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
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';

// The newest Expo moved the song-scanning functions into "expo-media-library/legacy".
let MediaLibrary;
try {
  MediaLibrary = require('expo-media-library/legacy');
} catch (e) {
  MediaLibrary = require('expo-media-library');
}

// Reads artist, album and cover art from the song files (optional, app still works without it).
let Meta = null;
try {
  Meta = require('@missingcore/react-native-metadata-retriever');
} catch (e) {
  Meta = null;
}

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

// ---------- Cover art loading (a few at a time, small cache) ----------
const artCache = new Map();
const artPending = new Map();
const artQueue = [];
let artActive = 0;

function runArtQueue() {
  while (artActive < 3 && artQueue.length > 0) {
    const job = artQueue.shift();
    artActive++;
    job().finally(() => {
      artActive--;
      runArtQueue();
    });
  }
}

function loadArt(uri) {
  if (!Meta || !Meta.getArtwork) return Promise.resolve(null);
  if (artCache.has(uri)) return Promise.resolve(artCache.get(uri));
  if (artPending.has(uri)) return artPending.get(uri);
  const p = new Promise((resolve) => {
    artQueue.push(async () => {
      try {
        const b64 = await Meta.getArtwork(uri);
        const value = b64 ? 'data:image/jpeg;base64,' + b64 : null;
        artCache.set(uri, value);
        if (artCache.size > 60) {
          artCache.delete(artCache.keys().next().value);
        }
        resolve(value);
      } catch (e) {
        artCache.set(uri, null);
        resolve(null);
      } finally {
        artPending.delete(uri);
      }
    });
    runArtQueue();
  });
  artPending.set(uri, p);
  return p;
}

function Art({ song, size, radius }) {
  const [img, setImg] = useState(artCache.has(song.uri) ? artCache.get(song.uri) : null);

  useEffect(() => {
    let alive = true;
    setImg(artCache.has(song.uri) ? artCache.get(song.uri) : null);
    loadArt(song.uri).then((v) => {
      if (alive) setImg(v);
    });
    return () => {
      alive = false;
    };
  }, [song.uri]);

  if (img) {
    return (
      <Image
        source={{ uri: img }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: CARD }}
        resizeMode="cover"
        resizeMethod="resize"
      />
    );
  }

  const g = gradientFor(song.title || '?');
  const letter = (song.title || '?').trim().charAt(0).toUpperCase() || '?';
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
  const sub = (song.artist ? song.artist + '  •  ' : '') + formatTime(song.duration);
  return (
    <TouchableOpacity activeOpacity={0.7} style={styles.row} onPress={() => onPress(index)}>
      <Art song={song} size={52} radius={12} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, active && { color: ACCENT }]} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {sub}
        </Text>
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
  const [scan, setScan] = useState(null); // { done, total } while reading song details
  const [errorText, setErrorText] = useState('');
  const [query, setQuery] = useState('');
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // off | all | one

  const historyRef = useRef([]);
  const scanRef = useRef(0);

  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  const songsById = useMemo(() => {
    const m = {};
    for (const s of songs) m[s.id] = s;
    return m;
  }, [songs]);

  const queued = currentIndex >= 0 ? queue[currentIndex] : null;
  const current = queued ? songsById[queued.id] || queued : null;

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
      setErrorText('Permission problem: ' + (e && e.message ? e.message : String(e)));
      setPermission('denied');
    }
  }

  async function loadSongs() {
    const myScan = ++scanRef.current;
    setLoading(true);
    setErrorText('');
    setScan(null);
    let list = [];
    try {
      let after = undefined;
      let hasNext = true;
      while (hasNext) {
        const page = await MediaLibrary.getAssetsAsync({
          mediaType: MediaLibrary.MediaType.audio,
          first: 1000,
          after: after,
        });
        for (const a of page.assets) {
          if (!(a.duration > 0) || a.duration >= MIN_SECONDS) {
            list.push({
              id: a.id,
              uri: a.uri,
              title: cleanTitle(a.filename),
              artist: '',
              album: '',
              duration: a.duration || 0,
            });
          }
        }
        hasNext = page.hasNextPage;
        after = page.endCursor;
      }
      list.sort((x, y) => x.title.localeCompare(y.title));
      setSongs(list);
      if (list.length === 0) {
        setErrorText('The phone returned 0 audio files. Tap "Scan again" or check the music permission.');
      }
    } catch (e) {
      setErrorText('Could not read songs: ' + (e && e.message ? e.message : String(e)));
    }
    setLoading(false);
    if (list.length > 0) {
      enrich(list, myScan);
    }
  }

  // Reads artist / album / real title for every song in the background.
  async function enrich(list, myScan) {
    if (!Meta || !Meta.getMetadata) return;
    const preset = Meta.MetadataPresets ? Meta.MetadataPresets.standard : undefined;
    const out = list.slice();
    const CHUNK = 16;
    let okCount = 0;
    for (let i = 0; i < out.length; i += CHUNK) {
      if (scanRef.current !== myScan) return;
      const part = out.slice(i, i + CHUNK);
      await Promise.all(
        part.map(async (s, k) => {
          try {
            const m = await Meta.getMetadata(s.uri, preset);
            if (m) {
              okCount++;
              out[i + k] = {
                ...s,
                title: (m.title && String(m.title).trim()) || s.title,
                artist: m.artist ? String(m.artist).trim() : '',
                album: m.albumTitle ? String(m.albumTitle).trim() : '',
              };
            }
          } catch (e) {}
        })
      );
      setScan({ done: Math.min(i + CHUNK, out.length), total: out.length });
      if ((i / CHUNK) % 12 === 11) {
        setSongs(out.slice());
      }
    }
    if (scanRef.current !== myScan) return;
    out.sort((x, y) => x.title.localeCompare(y.title));
    setSongs(out);
    setScan(null);
    if (okCount === 0) {
      setErrorText('Artist names and covers could not be read from your files.');
    }
  }

  // ---------- Search ----------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        s.album.toLowerCase().includes(q)
    );
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
        player.setActiveForLockScreen(true, {
          title: song.title,
          artist: song.artist || 'My Music',
          albumTitle: song.album || undefined,
        });
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
        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        <TouchableOpacity style={styles.primaryButton} onPress={ensurePermission}>
          <Text style={styles.primaryButtonText}>Allow access</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkButton} onPress={() => Linking.openSettings()}>
          <Text style={styles.linkText}>Open phone settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const headerSub =
    songs.length + ' songs' + (scan ? '  •  reading details ' + scan.done + '/' + scan.total : '');

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.bigTitle}>My Music</Text>
        <Text style={styles.headerSub}>{headerSub}</Text>
      </View>

      {/* Search */}
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={MUTED} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search songs, artists, albums"
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

      {errorText && songs.length > 0 ? <Text style={styles.noteText}>{errorText}</Text> : null}

      {/* Song list */}
      {loading && songs.length === 0 ? (
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
          getItemLayout={(data, index) => ({ length: 68, offset: 68 * index, index })}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={7}
          removeClippedSubviews
          refreshing={loading && songs.length > 0}
          onRefresh={loadSongs}
          contentContainerStyle={{ paddingBottom: (current ? 96 : 24) + insets.bottom }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingHorizontal: 32, marginTop: 40 }}>
              <Text style={styles.centerText}>
                {songs.length === 0 ? 'No songs found yet.' : 'No songs match your search.'}
              </Text>
              {errorText && songs.length === 0 ? (
                <Text style={styles.errorText}>{errorText}</Text>
              ) : null}
              {songs.length === 0 ? (
                <TouchableOpacity style={styles.primaryButton} onPress={loadSongs}>
                  <Text style={styles.primaryButtonText}>Scan again</Text>
                </TouchableOpacity>
              ) : null}
            </View>
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
          <Art song={current} size={44} radius={10} />
          <View style={styles.miniTextWrap}>
            <Text style={styles.miniTitle} numberOfLines={1}>
              {current.title}
            </Text>
            {current.artist ? (
              <Text style={styles.miniArtist} numberOfLines={1}>
                {current.artist}
              </Text>
            ) : null}
          </View>
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
              <Art song={current} size={artSize} radius={28} />
            </View>

            <View style={styles.fullInfo}>
              <Text style={styles.fullTitle} numberOfLines={2}>
                {current.title}
              </Text>
              <Text style={styles.fullArtist} numberOfLines={1}>
                {current.artist || 'Unknown artist'}
                {current.album ? '  •  ' + current.album : ''}
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
  errorText: { color: '#F87171', fontSize: 13, textAlign: 'center', marginTop: 14 },
  noteText: { color: MUTED, fontSize: 12, marginHorizontal: 20, marginBottom: 6 },

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
    height: 68,
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
  miniTextWrap: { flex: 1, marginLeft: 12 },
  miniTitle: { color: TEXT, fontSize: 15, fontWeight: '600' },
  miniArtist: { color: MUTED, fontSize: 12, marginTop: 2 },
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
  fullArtist: { color: '#D4D4DE', fontSize: 16, marginTop: 6 },
  fullSub: { color: MUTED, fontSize: 13, marginTop: 6 },
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
