import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StatusBar,
  ActivityIndicator,
  Linking,
  useWindowDimensions,
  BackHandler,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';

import { ThemeContext, getTheme, makeStyles, useTheme } from './src/theme';
import * as Lib from './src/library';
import { sortSongs, groupSongs } from './src/utils';
import {
  Art,
  SongRow,
  SongTile,
  GroupTile,
  ArtistRow,
  Segmented,
  MiniPlayer,
  OptionsSheet,
  ROW_H,
} from './src/ui';
import NowPlaying from './src/NowPlaying';

const PAD = 16;
const GAP = 12;

const TABS = [
  { key: 'songs', label: 'Songs', icon: 'musical-notes' },
  { key: 'albums', label: 'Albums', icon: 'albums' },
  { key: 'artists', label: 'Artists', icon: 'person' },
];

function MusicApp({ settings, updateSettings }) {
  const { t, s } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [permission, setPermission] = useState('checking'); // checking | granted | denied
  const [loading, setLoading] = useState(false);
  const [songs, setSongs] = useState([]);
  const [scan, setScan] = useState(null); // { done, total } while reading song details
  const [errorText, setErrorText] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('songs');
  const [openGroup, setOpenGroup] = useState(null); // { type, key }
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const historyRef = useRef([]);
  const scanRef = useRef(0);
  const playingIdRef = useRef(null);

  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  const songsById = useMemo(() => {
    const m = {};
    for (const sg of songs) m[sg.id] = sg;
    return m;
  }, [songs]);

  const queued = currentIndex >= 0 ? queue[currentIndex] : null;
  const current = queued ? songsById[queued.id] || queued : null;

  // ---------- Start up ----------
  useEffect(() => {
    (async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'doNotMix',
        });
      } catch (e) {}
      await Lib.loadCaches();
      await ensurePermission();
    })();
  }, []);

  // Android back button closes the album / artist page
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (openGroup) {
        setOpenGroup(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [openGroup]);

  async function ensurePermission() {
    try {
      const ok = await Lib.ensureMediaPermission();
      if (ok) {
        setPermission('granted');
        Lib.requestNotificationPermission();
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
      list = await Lib.scanSongs();
      setSongs(list);
      if (list.length === 0) {
        setErrorText('The phone returned 0 audio files. Tap "Scan again" or check the music permission.');
      }
    } catch (e) {
      setErrorText('Could not read songs: ' + (e && e.message ? e.message : String(e)));
    }
    setLoading(false);

    if (list.length > 0) {
      const out = await Lib.enrichSongs(
        list,
        () => scanRef.current !== myScan,
        (partial, done, total) => {
          if (scanRef.current === myScan) {
            setSongs(partial);
            setScan({ done, total });
          }
        }
      );
      if (scanRef.current === myScan) {
        setSongs(out);
        setScan(null);
        const missing = out.filter((x) => !x.hasMeta).length;
        if (missing > 0 && Lib.getDiagnostics().metaOk === 0) {
          setErrorText('Artist, album and cover info could not be read. Open Options > Library to see why.');
        }
      }
    }
  }

  async function rescan() {
    setSheetOpen(false);
    await Lib.clearCaches();
    setSongs([]);
    loadSongs();
  }

  // ---------- Lists ----------
  const sorted = useMemo(
    () => sortSongs(songs, settings.sort, settings.dir),
    [songs, settings.sort, settings.dir]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (x) =>
        x.title.toLowerCase().includes(q) ||
        x.artist.toLowerCase().includes(q) ||
        x.album.toLowerCase().includes(q) ||
        x.genre.toLowerCase().includes(q)
    );
  }, [sorted, query]);

  const needAlbums = tab === 'albums' || (openGroup && openGroup.type === 'album');
  const needArtists = tab === 'artists' || (openGroup && openGroup.type === 'artist');
  const albums = useMemo(() => (needAlbums ? groupSongs(songs, 'album') : []), [songs, needAlbums]);
  const artists = useMemo(() => (needArtists ? groupSongs(songs, 'artist') : []), [songs, needArtists]);

  const visibleAlbums = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return albums;
    return albums.filter((g) => g.title.toLowerCase().includes(q) || g.sub.toLowerCase().includes(q));
  }, [albums, query]);

  const visibleArtists = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return artists;
    return artists.filter((g) => g.title.toLowerCase().includes(q));
  }, [artists, query]);

  const openedGroup = useMemo(() => {
    if (!openGroup) return null;
    const list = openGroup.type === 'album' ? albums : artists;
    return list.find((g) => g.key === openGroup.key) || null;
  }, [openGroup, albums, artists]);

  // ---------- Playback ----------
  const playAt = useCallback(
    (list, idx) => {
      const song = list[idx];
      if (!song) return;
      playingIdRef.current = song.id;
      setQueue(list);
      setCurrentIndex(idx);
      const meta = {
        title: song.title,
        artist: song.artist || 'My Music',
        albumTitle: song.album || undefined,
      };
      try {
        player.replace({ uri: song.uri });
        player.play();
        player.setActiveForLockScreen(true, meta);
      } catch (e) {}
      // Put the cover on the notification / lock screen once it is ready
      Lib.loadArt(song, (u) => {
        if (u && playingIdRef.current === song.id && typeof player.updateLockScreenMetadata === 'function') {
          try {
            player.updateLockScreenMetadata({ ...meta, artworkUrl: u });
          } catch (e) {}
        }
      });
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

  const onGroupSongPress = useCallback(
    (index) => {
      if (!openedGroup) return;
      historyRef.current = [];
      playAt(openedGroup.songs, index);
    },
    [openedGroup, playAt]
  );

  function playList(list, shuffleMode) {
    if (list.length === 0) return;
    historyRef.current = [];
    updateSettings({ shuffle: shuffleMode });
    const idx = shuffleMode ? Math.floor(Math.random() * list.length) : 0;
    playAt(list, idx);
  }

  function togglePlay() {
    if (!current) {
      playList(filtered, false);
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
    if (auto && settings.repeat === 'one') {
      player.seekTo(0);
      player.play();
      return;
    }
    let nextIdx;
    if (settings.shuffle && queue.length > 1) {
      do {
        nextIdx = Math.floor(Math.random() * queue.length);
      } while (nextIdx === currentIndex);
    } else {
      nextIdx = currentIndex + 1;
      if (nextIdx >= queue.length) {
        if (settings.repeat === 'all' || !auto) {
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
    const r = settings.repeat;
    updateSettings({ repeat: r === 'off' ? 'all' : r === 'all' ? 'one' : 'off' });
  }

  function cycleView() {
    const v = settings.view;
    updateSettings({ view: v === 'list' ? 'grid2' : v === 'grid2' ? 'grid3' : 'list' });
  }

  const duration = status.duration || (current ? current.duration : 0) || 0;
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;
  const currentId = current ? current.id : null;

  // ---------- Layout numbers ----------
  const columns = settings.view === 'grid3' ? 3 : settings.view === 'grid2' ? 2 : 1;
  const gridMode = columns > 1;
  const tileSize = Math.floor((width - PAD * 2 - GAP * (columns - 1)) / columns);
  const albumSize = Math.floor((width - PAD * 2 - GAP) / 2);
  const listBottom = (current ? 96 : 24) + insets.bottom;

  const renderSong = useCallback(
    ({ item, index }) =>
      gridMode ? (
        <SongTile song={item} index={index} active={item.id === currentId} onPress={onSongPress} size={tileSize} />
      ) : (
        <SongRow song={item} index={index} active={item.id === currentId} onPress={onSongPress} />
      ),
    [currentId, onSongPress, gridMode, tileSize]
  );

  const renderGroupSong = useCallback(
    ({ item, index }) => (
      <SongRow song={item} index={index} active={item.id === currentId} onPress={onGroupSongPress} />
    ),
    [currentId, onGroupSongPress]
  );

  const openAlbum = useCallback((g) => setOpenGroup({ type: 'album', key: g.key }), []);
  const openArtist = useCallback((g) => setOpenGroup({ type: 'artist', key: g.key }), []);

  const renderAlbum = useCallback(
    ({ item }) => <GroupTile group={item} size={albumSize} onPress={openAlbum} />,
    [albumSize, openAlbum]
  );
  const renderArtist = useCallback(({ item }) => <ArtistRow group={item} onPress={openArtist} />, [openArtist]);

  // ---------- Screens ----------
  const barStyle = t.isDark ? 'light-content' : 'dark-content';

  if (permission === 'checking') {
    return (
      <View style={[s.center, { backgroundColor: t.bg }]}>
        <StatusBar barStyle={barStyle} backgroundColor="transparent" translucent />
        <ActivityIndicator color={t.accent} size="large" />
      </View>
    );
  }

  if (permission === 'denied') {
    return (
      <View style={[s.center, { backgroundColor: t.bg, padding: 32 }]}>
        <StatusBar barStyle={barStyle} backgroundColor="transparent" translucent />
        <Ionicons name="musical-notes" size={64} color={t.accent} />
        <Text style={s.bigTitle}>My Music</Text>
        <Text style={s.centerText}>I need permission to see the music on your phone, so I can play it.</Text>
        {errorText ? <Text style={s.errorText}>{errorText}</Text> : null}
        <TouchableOpacity style={s.primaryButton} onPress={ensurePermission}>
          <Text style={s.primaryButtonText}>Allow access</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.linkButton} onPress={() => Linking.openSettings()}>
          <Text style={s.linkText}>Open phone settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const withDetails = songs.filter((x) => x.hasMeta).length;
  const headerSub =
    songs.length + ' songs' + (scan ? '  •  reading details ' + scan.done + '/' + scan.total : '');
  const viewIcon = settings.view === 'list' ? 'list' : settings.view === 'grid2' ? 'grid' : 'apps';

  const emptyBlock = (
    <View style={s.emptyWrap}>
      <Text style={s.centerText}>
        {songs.length === 0 ? 'No songs found yet.' : 'Nothing matches your search.'}
      </Text>
      {errorText && songs.length === 0 ? <Text style={s.errorText}>{errorText}</Text> : null}
      {songs.length === 0 ? (
        <TouchableOpacity style={s.primaryButton} onPress={loadSongs}>
          <Text style={s.primaryButtonText}>Scan again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  let body;
  if (loading && songs.length === 0) {
    body = (
      <View style={s.center}>
        <ActivityIndicator color={t.accent} size="large" />
        <Text style={[s.centerText, { marginTop: 12 }]}>Finding your music...</Text>
      </View>
    );
  } else if (tab === 'songs') {
    body = (
      <FlatList
        key={'songs-' + columns}
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderSong}
        extraData={currentId}
        numColumns={columns}
        columnWrapperStyle={gridMode ? { gap: GAP, paddingHorizontal: PAD } : undefined}
        getItemLayout={gridMode ? undefined : (data, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
        initialNumToRender={gridMode ? 12 : 16}
        maxToRenderPerBatch={12}
        windowSize={5}
        removeClippedSubviews
        refreshing={loading && songs.length > 0}
        onRefresh={loadSongs}
        contentContainerStyle={{ paddingBottom: listBottom, paddingTop: gridMode ? 4 : 0 }}
        ListEmptyComponent={emptyBlock}
      />
    );
  } else if (tab === 'albums') {
    body = (
      <FlatList
        key="albums"
        data={visibleAlbums}
        keyExtractor={(item) => item.key}
        renderItem={renderAlbum}
        numColumns={2}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: PAD, marginBottom: 18 }}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews
        contentContainerStyle={{ paddingBottom: listBottom, paddingTop: 6 }}
        ListEmptyComponent={emptyBlock}
      />
    );
  } else {
    body = (
      <FlatList
        key="artists"
        data={visibleArtists}
        keyExtractor={(item) => item.key}
        renderItem={renderArtist}
        getItemLayout={(data, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
        initialNumToRender={16}
        windowSize={5}
        removeClippedSubviews
        contentContainerStyle={{ paddingBottom: listBottom }}
        ListEmptyComponent={emptyBlock}
      />
    );
  }

  return (
    <View style={[s.container, { paddingTop: insets.top + 12 }]}>
      <StatusBar barStyle={barStyle} backgroundColor="transparent" translucent />

      {/* Header */}
      <View style={s.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.bigTitle}>My Music</Text>
          <Text style={s.headerSub} numberOfLines={1}>
            {headerSub}
          </Text>
        </View>
        {tab === 'songs' ? (
          <TouchableOpacity style={s.headerBtn} onPress={cycleView}>
            <Ionicons name={viewIcon} size={22} color={t.text} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={s.headerBtn} onPress={() => setSheetOpen(true)}>
          <Ionicons name="options" size={22} color={t.text} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={s.searchBox}>
        <Ionicons name="search" size={18} color={t.muted} />
        <TextInput
          style={s.searchInput}
          placeholder="Search songs, artists, albums"
          placeholderTextColor={t.muted}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
        {query.length > 0 ? (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={t.muted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <Segmented items={TABS} value={tab} onChange={setTab} />

      {tab === 'songs' ? (
        <View style={s.actionRow}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => playList(filtered, false)} activeOpacity={0.8}>
            <LinearGradient
              colors={[t.accent, t.accent2]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={s.actionButton}
            >
              <Ionicons name="play" size={18} color="#fff" />
              <Text style={s.actionTextWhite}>Play all</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionButton, s.actionButtonDark, { flex: 1 }]}
            onPress={() => playList(filtered, true)}
            activeOpacity={0.8}
          >
            <Ionicons name="shuffle" size={18} color={t.text} />
            <Text style={s.actionText}>Shuffle</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {errorText && songs.length > 0 ? <Text style={s.noteText}>{errorText}</Text> : null}

      {body}

      {/* Album / artist page */}
      {openedGroup ? (
        <View style={[s.overlay, { paddingTop: insets.top + 8 }]}>
          <View style={s.overlayTop}>
            <TouchableOpacity style={s.headerBtn} onPress={() => setOpenGroup(null)}>
              <Ionicons name="chevron-back" size={24} color={t.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={openedGroup.songs}
            keyExtractor={(item) => item.id}
            renderItem={renderGroupSong}
            extraData={currentId}
            getItemLayout={(data, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
            windowSize={5}
            contentContainerStyle={{ paddingBottom: listBottom }}
            ListHeaderComponent={
              <View style={s.groupHead}>
                <Art
                  song={openedGroup.songs[0]}
                  size={Math.min(width * 0.55, 240)}
                  radius={openGroup && openGroup.type === 'artist' ? 999 : 20}
                />
                <Text style={s.groupHeadTitle} numberOfLines={2}>
                  {openedGroup.title}
                </Text>
                <Text style={s.groupHeadSub}>
                  {(openedGroup.sub ? openedGroup.sub + '  •  ' : '') +
                    openedGroup.songs.length +
                    (openedGroup.songs.length === 1 ? ' song' : ' songs')}
                </Text>
                <View style={[s.actionRow, { width: '100%' }]}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => playList(openedGroup.songs, false)} activeOpacity={0.8}>
                    <LinearGradient
                      colors={[t.accent, t.accent2]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={s.actionButton}
                    >
                      <Ionicons name="play" size={18} color="#fff" />
                      <Text style={s.actionTextWhite}>Play</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.actionButton, s.actionButtonDark, { flex: 1 }]}
                    onPress={() => playList(openedGroup.songs, true)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="shuffle" size={18} color={t.text} />
                    <Text style={s.actionText}>Shuffle</Text>
                  </TouchableOpacity>
                </View>
              </View>
            }
          />
        </View>
      ) : null}

      {/* Mini player */}
      {current ? (
        <MiniPlayer
          song={current}
          progress={progress}
          playing={status.playing}
          bottom={insets.bottom + 8}
          onOpen={() => setPlayerOpen(true)}
          onPrev={goPrev}
          onToggle={togglePlay}
          onNext={() => goNext(false)}
        />
      ) : null}

      <NowPlaying
        visible={playerOpen && !!current}
        onClose={() => setPlayerOpen(false)}
        song={current}
        index={currentIndex}
        total={queue.length}
        playing={status.playing}
        currentTime={status.currentTime}
        duration={duration}
        shuffle={settings.shuffle}
        repeat={settings.repeat}
        onToggleShuffle={() => updateSettings({ shuffle: !settings.shuffle })}
        onCycleRepeat={cycleRepeat}
        onPrev={goPrev}
        onNext={() => goNext(false)}
        onTogglePlay={togglePlay}
        onSeek={(sec) => player.seekTo(sec)}
      />

      <OptionsSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        settings={settings}
        onChange={updateSettings}
        info={{ ...Lib.getDiagnostics(), songCount: songs.length, withDetails }}
        onRescan={rescan}
      />
    </View>
  );
}

function Root() {
  const [settings, setSettings] = useState(null);
  const settingsRef = useRef(null);

  useEffect(() => {
    Lib.loadSettings().then((loaded) => {
      settingsRef.current = loaded;
      setSettings(loaded);
    });
  }, []);

  const themeId = settings ? settings.theme : 'dark';
  const ctx = useMemo(() => {
    const theme = getTheme(themeId);
    return { t: theme, s: makeStyles(theme) };
  }, [themeId]);

  const updateSettings = useCallback((patch) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    Lib.saveSettings(next);
  }, []);

  if (!settings) {
    return <View style={{ flex: 1, backgroundColor: '#0B0B10' }} />;
  }

  return (
    <ThemeContext.Provider value={ctx}>
      <MusicApp settings={settings} updateSettings={updateSettings} />
    </ThemeContext.Provider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}
