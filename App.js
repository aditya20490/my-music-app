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
  Alert,
  useWindowDimensions,
  BackHandler,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer from 'react-native-track-player';
import * as Engine from './src/audioEngine';

import { ThemeContext, getTheme, makeStyles, useTheme } from './src/theme';
import * as Lib from './src/library';
import * as Collections from './src/collections';
import * as Sizes from './src/sizes';
import { sortByMode, groupSongs, SORT_MODES } from './src/utils';
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
import EditSong from './src/EditSong';
import FastScroll from './src/FastScroll';
import AlbumEditor from './src/AlbumEditor';
import DynamicIsland from './src/DynamicIsland';

// Lets the phone's media notification / island control the player, even with the screen off
TrackPlayer.registerPlaybackService(() => Engine.playbackService);

const PAD = 16;
const GAP = 12;
const GRID_GAP = 2; // tiny gap between grid tiles, none at the screen edges

const TABS = [
  { key: 'songs', label: 'Songs', icon: 'musical-notes' },
  { key: 'albums', label: 'Albums', icon: 'albums' },
  { key: 'artists', label: 'Artists', icon: 'person' },
  { key: 'favs', label: 'Favorites', icon: 'heart' },
];

// Mixes a list into a random order. If firstId is given, that song goes first.
function shuffleList(list, firstId) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  if (firstId !== null && firstId !== undefined) {
    const at = arr.findIndex((x) => x.id === firstId);
    if (at > 0) {
      const item = arr.splice(at, 1)[0];
      arr.unshift(item);
    }
  }
  return arr;
}

function MusicApp({ settings, updateSettings }) {
  const { t, s } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [permission, setPermission] = useState('checking'); // checking | granted | denied
  const [loading, setLoading] = useState(false);
  const [songs, setSongs] = useState([]);
  const [sizes, setSizes] = useState({}); // song id -> file size
  const [scan, setScan] = useState(null); // { done, total } while reading song details
  const [errorText, setErrorText] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('songs');
  const [openGroup, setOpenGroup] = useState(null); // { type, key }
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editSong, setEditSong] = useState(null);
  const [favs, setFavs] = useState(() => new Set()); // favorite song ids (saved inside the app only)
  const [hidden, setHidden] = useState({}); // hidden albums: { key: { title, sub } } (saved inside the app only)
  const [customAlbums, setCustomAlbums] = useState([]); // your own albums: [{ id, name, songIds }]
  const [albumEditor, setAlbumEditor] = useState(null); // null, or { id, name, songIds }
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState({});

  const originalRef = useRef([]); // the song order before shuffle was turned on
  const scanRef = useRef(0);
  const playingIdRef = useRef(null);
  const listRef = useRef(null);
  const fastRef = useRef(null);
  const volumeRef = useRef(1);

  const player = Engine.player;
  const status = Engine.usePlayerStatus();

  // Every song by id. The versions inside a bundle are included too (the bundle's own entry wins for the first version).
  const songsById = useMemo(() => {
    const m = {};
    for (const sg of songs) {
      if (sg.versions) for (const v of sg.versions) m[v.id] = v;
    }
    for (const sg of songs) m[sg.id] = sg;
    return m;
  }, [songs]);

  const queued = currentIndex >= 0 ? queue[currentIndex] : null;
  const current = queued ? songsById[queued.id] || queued : null;

  // ---------- Start up ----------
  useEffect(() => {
    (async () => {
      try {
        await Engine.setupAudio();
      } catch (e) {}
      try {
        const c = await Collections.loadCollections();
        setFavs(c.favs);
        setHidden(c.hidden);
        setCustomAlbums(c.customAlbums);
      } catch (e) {}
      try {
        setSizes(await Sizes.loadSizes());
      } catch (e) {}
      await Lib.loadCaches();
      await ensurePermission();
    })();
  }, []);

  // Android back button: closes the options, cancels selecting, or closes the album / artist page
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sheetOpen) {
        setSheetOpen(false);
        return true;
      }
      if (selecting) {
        setSelecting(false);
        setSelected({});
        return true;
      }
      if (openGroup) {
        setOpenGroup(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [openGroup, selecting, sheetOpen]);

  // Leaving the Albums tab cancels selecting
  useEffect(() => {
    if (tab !== 'albums') {
      setSelecting(false);
      setSelected({});
    }
  }, [tab]);

  // Un-selecting the last album ends selecting
  useEffect(() => {
    if (selecting && Object.keys(selected).length === 0) setSelecting(false);
  }, [selected, selecting]);

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
        if (missing > 0 && Lib.getDiagnostics().metaOk + Lib.getDiagnostics().metaJs === 0) {
          setErrorText('Artist, album and cover info could not be read. Open Options > Library info to see why.');
        }
      }
      // File sizes (for "Largest first / Smallest first"), read quietly in the background
      Sizes.fillSizes(list, () => scanRef.current !== myScan, (m) => setSizes(m));
    }
  }

  async function rescan() {
    setSheetOpen(false);
    await Lib.clearCaches();
    setSongs([]);
    loadSongs();
  }

  // ---------- Favorites ----------
  const toggleFav = useCallback((id) => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      Collections.saveFavs(next);
      return next;
    });
  }, []);

  // ---------- Albums (real ones from the files + the ones you made) ----------
  const realAlbums = useMemo(() => groupSongs(songs, 'album'), [songs]);

  const customGroups = useMemo(
    () =>
      customAlbums
        .map((a) => ({
          key: 'c:' + a.id,
          title: a.name,
          sub: 'My album',
          custom: true,
          id: a.id,
          unknown: false,
          songs: a.songIds.map((id) => songsById[id]).filter(Boolean),
        }))
        .filter((g) => g.songs.length > 0),
    [customAlbums, songsById]
  );

  const allGroups = useMemo(() => [...customGroups, ...realAlbums], [customGroups, realAlbums]);

  // Hidden albums only disappear from the Albums tab. Songs are never hidden.
  const albums = useMemo(() => allGroups.filter((g) => !hidden[g.key]), [allGroups, hidden]);

  const hiddenList = useMemo(
    () => Object.keys(hidden).map((k) => ({ key: k, title: hidden[k].title, sub: hidden[k].sub })),
    [hidden]
  );

  function hideSelected() {
    const byKey = {};
    allGroups.forEach((g) => {
      byKey[g.key] = g;
    });
    const next = { ...hidden };
    Object.keys(selected).forEach((k) => {
      const g = byKey[k];
      next[k] = { title: g ? g.title : k, sub: g ? g.sub : '' };
    });
    setHidden(next);
    Collections.saveHidden(next);
    setSelecting(false);
    setSelected({});
  }

  function unhideAlbum(key) {
    const next = { ...hidden };
    delete next[key];
    setHidden(next);
    Collections.saveHidden(next);
  }

  function cancelSelect() {
    setSelecting(false);
    setSelected({});
  }

  function saveAlbum(a) {
    let next;
    if (a.id) {
      next = customAlbums.map((x) => (x.id === a.id ? { ...x, name: a.name, songIds: a.songIds } : x));
    } else {
      next = [...customAlbums, { id: 'a' + Date.now(), name: a.name, songIds: a.songIds }];
    }
    setCustomAlbums(next);
    Collections.saveCustomAlbums(next);
    setAlbumEditor(null);
  }

  function deleteCustomAlbum(id) {
    Alert.alert('Delete this album?', 'Only the album is removed. The songs stay on your phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const next = customAlbums.filter((a) => a.id !== id);
          setCustomAlbums(next);
          Collections.saveCustomAlbums(next);
          setOpenGroup(null);
        },
      },
    ]);
  }

  // ---------- Lists ----------
  const sortMode = SORT_MODES.some((m) => m.key === settings.sort) ? settings.sort : 'az';
  const sizeDep = sortMode === 'largest' || sortMode === 'smallest' ? sizes : null;

  const sorted = useMemo(() => sortByMode(songs, sortMode, sizes), [songs, sortMode, sizeDep]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    const hit = (x) =>
      x.title.toLowerCase().includes(q) ||
      x.artist.toLowerCase().includes(q) ||
      x.album.toLowerCase().includes(q) ||
      x.genre.toLowerCase().includes(q) ||
      (x.versionLabel || '').toLowerCase().includes(q);
    // A match inside a bundle (an edit, a remix...) shows the bundle's main song, never the version itself
    return sorted.filter((x) => hit(x) || (x.versions && x.versions.some(hit)));
  }, [sorted, query]);

  const favSongs = useMemo(() => filtered.filter((x) => favs.has(x.id)), [filtered, favs]);

  // The songs shown on the current tab (Songs or Favorites)
  const songList = tab === 'favs' ? favSongs : filtered;

  const needArtists = tab === 'artists' || (openGroup && openGroup.type === 'artist');
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
    const list = openGroup.type === 'album' ? allGroups : artists;
    return list.find((g) => g.key === openGroup.key) || null;
  }, [openGroup, allGroups, artists]);

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
        album: song.album || undefined,
      };
      try {
        player.load(song, meta, volumeRef.current).catch(() => {});
      } catch (e) {}
      // Put the cover on the notification / lock screen once it is ready
      Lib.loadArt(song, (u) => {
        if (u && playingIdRef.current === song.id) {
          player.setArtwork(u, meta);
        }
      });
    },
    [player]
  );

  // The player's own volume (swipe up / down on the player screen)
  const setVolume = useCallback(
    (v) => {
      volumeRef.current = v;
      try {
        player.setVolume(v);
      } catch (e) {}
    },
    [player]
  );

  // Tapping a song plays the list in its normal order (shuffle is switched off)
  const onSongPress = useCallback(
    (index) => {
      originalRef.current = songList;
      if (settings.shuffle) updateSettings({ shuffle: false });
      playAt(songList, index);
    },
    [songList, playAt, settings.shuffle, updateSettings]
  );

  const onGroupSongPress = useCallback(
    (index) => {
      if (!openedGroup) return;
      originalRef.current = openedGroup.songs;
      if (settings.shuffle) updateSettings({ shuffle: false });
      playAt(openedGroup.songs, index);
    },
    [openedGroup, playAt, settings.shuffle, updateSettings]
  );

  // Long press a song to edit it
  const onSongLong = useCallback(
    (index) => {
      if (songList[index]) setEditSong(songList[index]);
    },
    [songList]
  );

  const onGroupSongLong = useCallback(
    (index) => {
      if (openedGroup && openedGroup.songs[index]) setEditSong(openedGroup.songs[index]);
    },
    [openedGroup]
  );

  const onEditChange = useCallback((newSong) => {
    setSongs((prev) =>
      prev.map((x) => {
        if (!x.versions) return x.id === newSong.id ? newSong : x;
        if (!x.versions.some((v) => v.id === newSong.id)) return x;
        // a song inside a bundle was edited: keep the bundle's version list in step
        const plain = { ...newSong };
        delete plain.versions;
        const nv = x.versions.map((v) => (v.id === newSong.id ? plain : v));
        if (x.id === newSong.id) return { ...plain, versions: nv };
        return { ...x, versions: nv };
      })
    );
  }, []);

  // Switch the playing song to another version of the same bundle (the queue keeps its place)
  const playVersion = useCallback(
    (v) => {
      if (!v || currentIndex < 0 || queue.length === 0) return;
      const q = queue.slice();
      q[currentIndex] = v;
      playAt(q, currentIndex);
    },
    [queue, currentIndex, playAt]
  );

  function playList(list, shuffleMode) {
    if (list.length === 0) return;
    originalRef.current = list;
    updateSettings({ shuffle: shuffleMode });
    if (shuffleMode) {
      playAt(shuffleList(list, null), 0);
    } else {
      playAt(list, 0);
    }
  }

  // The shuffle button inside the player
  function toggleShuffle() {
    const turnOn = !settings.shuffle;
    updateSettings({ shuffle: turnOn });
    if (!current || queue.length === 0) return;
    if (turnOn) {
      originalRef.current = queue;
      setQueue(shuffleList(queue, current.id));
      setCurrentIndex(0);
    } else {
      const orig = originalRef.current.length > 0 ? originalRef.current : queue;
      const at = orig.findIndex((x) => x.id === (current.bundleId || current.id));
      setQueue(orig);
      setCurrentIndex(at >= 0 ? at : 0);
    }
  }

  function togglePlay() {
    if (!current) {
      playList(songList, false);
      return;
    }
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  }

  // Next song: always the next one in the queue order
  function goNext(auto) {
    if (queue.length === 0) return;
    if (auto && settings.repeat === 'one') {
      player.seekTo(0);
      player.play();
      return;
    }
    let nextIdx = currentIndex + 1;
    if (nextIdx >= queue.length) {
      if (settings.repeat === 'all' || !auto) {
        nextIdx = 0;
      } else {
        player.pause();
        player.seekTo(0);
        return;
      }
    }
    playAt(queue, nextIdx);
  }

  // Previous song: the one before it in the queue order.
  // The button restarts the song first if it already played for 3 seconds. A swipe always goes back (force = true).
  function goPrev(force) {
    if (queue.length === 0) return;
    if (!force && status.currentTime > 3) {
      player.seekTo(0);
      return;
    }
    let prevIdx = currentIndex - 1;
    if (prevIdx < 0) prevIdx = queue.length - 1;
    playAt(queue, prevIdx);
  }

  // Auto-play the next song when one finishes.
  useEffect(() => {
    if (status.finishCount > 0) {
      goNext(true);
    }
  }, [status.finishCount]);

  // The next / previous buttons on the notification and the island call these
  const remoteRef = useRef({});
  remoteRef.current = { next: () => goNext(false), prev: () => goPrev(false) };
  useEffect(() => {
    Engine.setRemoteHandlers({
      next: () => remoteRef.current.next(),
      prev: () => remoteRef.current.prev(),
    });
    return () => Engine.setRemoteHandlers(null);
  }, []);

  function cycleRepeat() {
    const r = settings.repeat;
    updateSettings({ repeat: r === 'off' ? 'all' : r === 'all' ? 'one' : 'off' });
  }

  function cycleView() {
    const v = settings.view;
    updateSettings({ view: v === 'list' ? 'grid3' : 'list' });
  }

  const duration = status.duration || (current ? current.duration : 0) || 0;
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;
  const currentId = current ? current.bundleId || current.id : null; // a playing version lights up its bundle's row
  const currentBundle = current && current.bundleId ? songsById[current.bundleId] : null;
  const versionList = currentBundle && currentBundle.versions && currentBundle.versions.length > 1 ? currentBundle.versions : null;
  const favId = current ? current.bundleId || current.id : null;

  // ---------- Slide bar ----------
  const onListScroll = useCallback((e) => {
    const n = e.nativeEvent;
    if (fastRef.current) {
      fastRef.current.update(n.contentOffset.y, n.contentSize.height, n.layoutMeasurement.height);
    }
  }, []);

  const jumpTo = useCallback((offset) => {
    if (listRef.current) listRef.current.scrollToOffset({ offset: offset, animated: false });
  }, []);

  // ---------- Layout numbers ----------
  const gridMode = tab === 'songs' && settings.view !== 'list';
  const columns = gridMode ? 3 : 1;
  const tileSize = Math.floor((width - GRID_GAP * (columns - 1)) / columns);
  const albumSize = Math.floor((width - PAD * 2 - GAP) / 2);
  const listBottom = (current ? 96 : 24) + insets.bottom;

  const listExtra = useMemo(() => ({ currentId, favs }), [currentId, favs]);

  const renderSong = useCallback(
    ({ item, index }) =>
      gridMode ? (
        <SongTile
          song={item}
          index={index}
          active={item.id === currentId}
          onPress={onSongPress}
          onLongPress={onSongLong}
          size={tileSize}
        />
      ) : (
        <SongRow
          song={item}
          index={index}
          active={item.id === currentId}
          onPress={onSongPress}
          onLongPress={onSongLong}
          fav={favs.has(item.id)}
          onFav={toggleFav}
        />
      ),
    [currentId, onSongPress, onSongLong, gridMode, tileSize, favs, toggleFav]
  );

  const renderGroupSong = useCallback(
    ({ item, index }) => (
      <SongRow
        song={item}
        index={index}
        active={item.id === currentId}
        onPress={onGroupSongPress}
        onLongPress={onGroupSongLong}
        fav={favs.has(item.id)}
        onFav={toggleFav}
      />
    ),
    [currentId, onGroupSongPress, onGroupSongLong, favs, toggleFav]
  );

  // Albums: tap opens (or selects while selecting), long press starts selecting
  const onAlbumPress = useCallback(
    (g) => {
      if (selecting) {
        setSelected((prev) => {
          const n = { ...prev };
          if (n[g.key]) delete n[g.key];
          else n[g.key] = true;
          return n;
        });
      } else {
        setOpenGroup({ type: 'album', key: g.key });
      }
    },
    [selecting]
  );

  const onAlbumLong = useCallback((g) => {
    setSelecting(true);
    setSelected((prev) => ({ ...prev, [g.key]: true }));
  }, []);

  const openArtist = useCallback((g) => setOpenGroup({ type: 'artist', key: g.key }), []);

  const renderAlbum = useCallback(
    ({ item }) => (
      <GroupTile
        group={item}
        size={albumSize}
        onPress={onAlbumPress}
        onLongPress={onAlbumLong}
        selecting={selecting}
        selected={!!selected[item.key]}
      />
    ),
    [albumSize, onAlbumPress, onAlbumLong, selecting, selected]
  );
  const renderArtist = useCallback(({ item }) => <ArtistRow group={item} onPress={openArtist} />, [openArtist]);

  function selectAllAlbums() {
    const all = {};
    visibleAlbums.forEach((g) => {
      all[g.key] = true;
    });
    setSelected(all);
  }

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
  const headerSub = songs.length + ' songs' + (scan ? '  •  reading details ' + scan.done + '/' + scan.total : '');
  const viewIcon = settings.view === 'list' ? 'list' : 'apps';

  let emptyText = 'Nothing matches your search.';
  if (songs.length === 0) emptyText = 'No songs found yet.';
  else if (tab === 'favs' && query.trim() === '') emptyText = 'No favorites yet. Tap the heart on a song.';
  else if (tab === 'albums' && query.trim() === '') emptyText = 'No albums to show. Hidden ones can be shown again in Options.';

  const emptyBlock = (
    <View style={s.emptyWrap}>
      <Text style={s.centerText}>{emptyText}</Text>
      {errorText && songs.length === 0 ? <Text style={s.errorText}>{errorText}</Text> : null}
      {songs.length === 0 ? (
        <TouchableOpacity style={s.primaryButton} onPress={loadSongs}>
          <Text style={s.primaryButtonText}>Scan again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  // Everything at the top. It lives inside the lists, so it scrolls away with them.
  const header = (
    <View style={{ paddingTop: insets.top + 8, paddingBottom: 4 }}>
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

      {tab === 'songs' || tab === 'favs' ? (
        <View style={s.actionRow}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => playList(songList, false)} activeOpacity={0.8}>
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
            onPress={() => playList(songList, true)}
            activeOpacity={0.8}
          >
            <Ionicons name="shuffle" size={18} color={t.text} />
            <Text style={s.actionText}>Shuffle</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {tab === 'albums' ? (
        <View style={s.actionRow}>
          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={() => setAlbumEditor({ id: null, name: '', songIds: [] })}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={[t.accent, t.accent2]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={s.actionButton}
            >
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={s.actionTextWhite}>New album</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      ) : null}
      {tab === 'albums' ? <Text style={s.noteText}>Long-press an album to select it, then hide it.</Text> : null}

      {errorText && songs.length > 0 ? <Text style={s.noteText}>{errorText}</Text> : null}
    </View>
  );

  let body;
  if (loading && songs.length === 0) {
    body = (
      <View style={{ flex: 1 }}>
        {header}
        <View style={s.center}>
          <ActivityIndicator color={t.accent} size="large" />
          <Text style={[s.centerText, { marginTop: 12 }]}>Finding your music...</Text>
        </View>
      </View>
    );
  } else if (tab === 'songs' || tab === 'favs') {
    body = (
      <FlatList
        ref={listRef}
        key={'songs-' + tab + '-' + columns}
        data={songList}
        keyExtractor={(item) => item.id}
        renderItem={renderSong}
        extraData={listExtra}
        numColumns={columns}
        keyboardShouldPersistTaps="handled"
        columnWrapperStyle={gridMode ? { gap: GRID_GAP, marginBottom: GRID_GAP } : undefined}
        initialNumToRender={gridMode ? 12 : 16}
        maxToRenderPerBatch={12}
        windowSize={5}
        removeClippedSubviews
        refreshing={loading && songs.length > 0}
        onRefresh={loadSongs}
        onScroll={onListScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: listBottom }}
        ListHeaderComponent={header}
        ListEmptyComponent={emptyBlock}
      />
    );
  } else if (tab === 'albums') {
    body = (
      <FlatList
        ref={listRef}
        key="albums"
        data={visibleAlbums}
        keyExtractor={(item) => item.key}
        renderItem={renderAlbum}
        extraData={selected}
        numColumns={2}
        keyboardShouldPersistTaps="handled"
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: PAD, marginBottom: 18 }}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews
        onScroll={onListScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: listBottom }}
        ListHeaderComponent={header}
        ListEmptyComponent={emptyBlock}
      />
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        key="artists"
        data={visibleArtists}
        keyExtractor={(item) => item.key}
        renderItem={renderArtist}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={16}
        windowSize={5}
        removeClippedSubviews
        onScroll={onListScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: listBottom }}
        ListHeaderComponent={header}
        ListEmptyComponent={emptyBlock}
      />
    );
  }

  return (
    <LinearGradient colors={[t.bgTop, t.bg]} style={s.container}>
      <StatusBar barStyle={barStyle} backgroundColor="transparent" translucent />

      {body}

      {/* Slide bar on the right edge */}
      <FastScroll ref={fastRef} top={insets.top + 12} bottom={listBottom} onJump={jumpTo} />

      {/* Bar shown while selecting albums */}
      {selecting && tab === 'albums' ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            paddingTop: insets.top + 8,
            paddingBottom: 10,
            paddingHorizontal: 12,
            backgroundColor: t.card,
            flexDirection: 'row',
            alignItems: 'center',
            zIndex: 20,
            elevation: 20,
          }}
        >
          <TouchableOpacity style={s.headerBtn} onPress={cancelSelect}>
            <Ionicons name="close" size={22} color={t.text} />
          </TouchableOpacity>
          <Text style={{ flex: 1, color: t.text, fontSize: 16, fontWeight: '800', marginLeft: 12 }}>
            {Object.keys(selected).length + ' selected'}
          </Text>
          <TouchableOpacity onPress={selectAllAlbums} style={{ paddingHorizontal: 12, height: 38, justifyContent: 'center' }}>
            <Text style={{ color: t.accent, fontSize: 14, fontWeight: '800' }}>All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={hideSelected}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 16,
              height: 38,
              borderRadius: 19,
              backgroundColor: t.accent,
            }}
          >
            <Ionicons name="eye-off" size={18} color={t.onAccent} />
            <Text style={{ color: t.onAccent, fontSize: 14, fontWeight: '800' }}>Hide</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Album / artist page */}
      {openedGroup ? (
        <View style={[s.overlay, { paddingTop: insets.top + 8 }]}>
          <View style={s.overlayTop}>
            <TouchableOpacity style={s.headerBtn} onPress={() => setOpenGroup(null)}>
              <Ionicons name="chevron-back" size={24} color={t.text} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            {openedGroup.custom ? (
              <>
                <TouchableOpacity
                  style={s.headerBtn}
                  onPress={() =>
                    setAlbumEditor({
                      id: openedGroup.id,
                      name: openedGroup.title,
                      songIds: openedGroup.songs.map((x) => x.id),
                    })
                  }
                >
                  <Ionicons name="create-outline" size={22} color={t.text} />
                </TouchableOpacity>
                <TouchableOpacity style={s.headerBtn} onPress={() => deleteCustomAlbum(openedGroup.id)}>
                  <Ionicons name="trash-outline" size={22} color="#F87171" />
                </TouchableOpacity>
              </>
            ) : null}
          </View>
          <FlatList
            data={openedGroup.songs}
            keyExtractor={(item) => item.id}
            renderItem={renderGroupSong}
            extraData={listExtra}
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
          onPrev={() => goPrev(false)}
          onToggle={togglePlay}
          onNext={() => goNext(false)}
        />
      ) : null}

      {/* Dynamic island at the top of the screen (can be switched off in Options) */}
      {current && settings.island !== false ? (
        <DynamicIsland
          song={current}
          playing={status.playing}
          progress={progress}
          currentTime={status.currentTime}
          duration={duration}
          hidden={playerOpen || selecting}
          onOpen={() => setPlayerOpen(true)}
          onPrev={() => goPrev(false)}
          onSwipePrev={() => goPrev(true)}
          onToggle={togglePlay}
          onNext={() => goNext(false)}
          onSeek={(sec) => player.seekTo(sec)}
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
        isFav={favId ? favs.has(favId) : false}
        onToggleFav={() => {
          if (favId) toggleFav(favId);
        }}
        versions={versionList}
        onPickVersion={playVersion}
        onToggleShuffle={toggleShuffle}
        onCycleRepeat={cycleRepeat}
        onPrev={() => goPrev(false)}
        onSwipePrev={() => goPrev(true)}
        onNext={() => goNext(false)}
        onTogglePlay={togglePlay}
        onSeek={(sec) => player.seekTo(sec)}
        onEdit={(sg) => setEditSong(sg)}
        volume={volumeRef.current}
        onVolume={setVolume}
      />

      <EditSong
        visible={!!editSong}
        song={editSong}
        onClose={() => setEditSong(null)}
        onChange={onEditChange}
      />

      <AlbumEditor
        visible={!!albumEditor}
        album={albumEditor}
        songs={sorted}
        onClose={() => setAlbumEditor(null)}
        onSave={saveAlbum}
      />

      {/* Options: only exists while it is open, so it shows up instantly */}
      {sheetOpen ? (
        <OptionsSheet
          onClose={() => setSheetOpen(false)}
          settings={settings}
          sortMode={sortMode}
          onChange={updateSettings}
          info={{ ...Lib.getDiagnostics(), ...Collections.getStorageInfo(), songCount: songs.length, withDetails }}
          onRescan={rescan}
          hiddenAlbums={hiddenList}
          onUnhide={unhideAlbum}
        />
      ) : null}
    </LinearGradient>
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
