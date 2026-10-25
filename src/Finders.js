// Two online helpers:
//  - CoverFinder: search album covers on the iTunes store (same service as the itunes-artwork-finder project),
//    save the full-size picture to your phone, or use it as the cover of a song.
//  - LyricsFinder: search lyrics (with timed lines when they exist) on LRCLIB and use them for a song.
// Changes for a song are saved inside the app, the audio file is never touched.
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  FlatList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme';
import { saveEdit } from './edits';
import { refreshSong } from './library';

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
if (FS && typeof FS.downloadAsync !== 'function') FS = null;

let ML = null;
try {
  ML = require('expo-media-library/legacy');
} catch (e) {
  try {
    ML = require('expo-media-library');
  } catch (e2) {
    ML = null;
  }
}

async function getJson(url) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => {
    if (ctl) ctl.abort();
  }, 15000);
  try {
    const res = await fetch(url, {
      signal: ctl ? ctl.signal : undefined,
      headers: { 'User-Agent': 'MyMusic/1.0', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('The server answered ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function friendly(e) {
  if (e && e.name === 'AbortError') return 'It took too long. Check your internet and try again.';
  const m = e && e.message ? String(e.message) : '';
  if (/network|failed|fetch/i.test(m)) return 'Could not reach the server. Check your internet.';
  return m || 'Something went wrong.';
}

async function downloadTo(url, dest) {
  const r = await FS.downloadAsync(url, dest);
  if (!r || r.status !== 200) throw new Error('Download failed (' + (r ? r.status : '?') + ')');
  return r.uri;
}

// The store gives a 100px picture link. Changing its last part asks for another size (this is what the artwork finder does).
function sized(url100, size) {
  return String(url100).replace(/\/[^/]*$/, '/' + size + '.jpg');
}

const COUNTRIES = [
  ['us', 'US'],
  ['gb', 'UK'],
  ['in', 'India'],
  ['jp', 'Japan'],
  ['kr', 'Korea'],
  ['de', 'Germany'],
  ['fr', 'France'],
  ['br', 'Brazil'],
];

function Header({ title, onClose }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginBottom: 8 }}>
      <TouchableOpacity onPress={onClose} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="close" size={26} color={t.text} />
      </TouchableOpacity>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: '800', marginLeft: 6 }}>{title}</Text>
    </View>
  );
}

function SearchBar({ value, onChange, onGo, placeholder }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, gap: 8 }}>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: t.card,
          borderRadius: 14,
          paddingHorizontal: 12,
          height: 44,
        }}
      >
        <Ionicons name="search" size={18} color={t.muted} />
        <TextInput
          style={{ flex: 1, color: t.text, fontSize: 15, marginLeft: 8, paddingVertical: 0 }}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={t.muted}
          returnKeyType="search"
          onSubmitEditing={onGo}
          autoCorrect={false}
        />
      </View>
      <TouchableOpacity
        onPress={onGo}
        style={{ height: 44, paddingHorizontal: 18, borderRadius: 14, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: t.onAccent, fontWeight: '800' }}>Search</Text>
      </TouchableOpacity>
    </View>
  );
}

function Pill({ label, icon, onPress, busy, primary, disabled }) {
  const { t } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || busy}
      activeOpacity={0.8}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 46,
        borderRadius: 23,
        backgroundColor: primary ? t.accent : t.card,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator color={primary ? t.onAccent : t.text} />
      ) : (
        <>
          <Ionicons name={icon} size={18} color={primary ? t.onAccent : t.text} />
          <Text style={{ color: primary ? t.onAccent : t.text, fontWeight: '800', fontSize: 14 }}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ======================= Album cover finder =======================
export function CoverFinder({ visible, onClose, song, onApplied }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [term, setTerm] = useState('');
  const [country, setCountry] = useState('us');
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  async function search(q, cc) {
    const text = String(q || '').trim();
    if (!text) return;
    setLoading(true);
    setErr('');
    setSel(null);
    setNote('');
    try {
      const data = await getJson(
        'https://itunes.apple.com/search?media=music&entity=album&limit=40&country=' + cc + '&term=' + encodeURIComponent(text)
      );
      const list = (data.results || [])
        .filter((r) => r.artworkUrl100)
        .map((r) => ({
          id: String(r.collectionId),
          name: r.collectionName,
          artist: r.artistName,
          year: r.releaseDate ? String(r.releaseDate).slice(0, 4) : '',
          tracks: r.trackCount || 0,
          thumb: sized(r.artworkUrl100, '300x300bb'),
          preview: sized(r.artworkUrl100, '600x600bb'),
          art100: r.artworkUrl100,
        }));
      setItems(list);
    } catch (e) {
      setErr(friendly(e));
      setItems([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!visible) return;
    const q = song ? [song.album || song.title, song.artist].filter(Boolean).join(' ') : '';
    setTerm(q);
    setItems(null);
    setSel(null);
    setErr('');
    setNote('');
    setBusy('');
    if (q) search(q, country);
  }, [visible]);

  async function saveToPhone() {
    if (!sel || !FS) return;
    setBusy('save');
    setNote('');
    try {
      const file = (FS.cacheDirectory || FS.documentDirectory) + 'cover_' + Date.now() + '.jpg';
      await downloadTo(sized(sel.art100, '100000x100000-999'), file); // the biggest size the store has
      let saved = false;
      if (ML && ML.saveToLibraryAsync) {
        try {
          const perm = await ML.requestPermissionsAsync(true);
          if (perm && perm.granted) {
            await ML.saveToLibraryAsync(file);
            saved = true;
          }
        } catch (e) {}
      }
      setNote(saved ? 'Saved to your gallery in full size.' : 'Could not save to the gallery. Allow photo access for the app and try again.');
    } catch (e) {
      setNote(friendly(e));
    }
    setBusy('');
  }

  async function useCover() {
    if (!song || !sel || !FS) return;
    setBusy('use');
    setNote('');
    try {
      const dir = (FS.documentDirectory || FS.cacheDirectory) + 'covers/';
      try {
        await FS.makeDirectoryAsync(dir, { intermediates: true });
      } catch (e) {}
      const safe = String(song.id).replace(/[^A-Za-z0-9_-]/g, '_');
      const dest = dir + 'custom_' + safe + '_' + Date.now() + '.jpg';
      await downloadTo(sized(sel.art100, '1400x1400bb'), dest);
      await saveEdit(song.id, { cover: dest });
      if (onApplied) onApplied(refreshSong(song));
      setNote('Done. This is now the cover of "' + song.title + '".');
    } catch (e) {
      setNote(friendly(e));
    }
    setBusy('');
  }

  const cell = Math.floor((width - 32 - 16) / 3);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => (sel ? setSel(null) : onClose())} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 8 }}>
        <Header title="Find album cover" onClose={onClose} />
        <SearchBar value={term} onChange={setTerm} onGo={() => search(term, country)} placeholder="Album or artist" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {COUNTRIES.map((c) => {
            const on = country === c[0];
            return (
              <TouchableOpacity
                key={c[0]}
                onPress={() => {
                  setCountry(c[0]);
                  search(term, c[0]);
                }}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: 16,
                  backgroundColor: on ? t.accent : t.card,
                }}
              >
                <Text style={{ color: on ? t.onAccent : t.text, fontWeight: '700', fontSize: 13 }}>{c[1]}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={t.accent} size="large" />
          </View>
        ) : (
          <FlatList
            data={items || []}
            keyExtractor={(i) => i.id}
            numColumns={3}
            keyboardShouldPersistTaps="handled"
            columnWrapperStyle={{ gap: 8, paddingHorizontal: 16, marginTop: 12 }}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            ListEmptyComponent={
              <Text style={{ color: err ? '#F87171' : t.muted, textAlign: 'center', marginTop: 50, paddingHorizontal: 30 }}>
                {err || (items ? 'No covers found. Try other words or another country.' : 'Search for an album to see its covers.')}
              </Text>
            }
            renderItem={({ item }) => (
              <TouchableOpacity activeOpacity={0.8} onPress={() => { setSel(item); setNote(''); }} style={{ width: cell }}>
                <Image source={{ uri: item.thumb }} style={{ width: cell, height: cell, borderRadius: 12, backgroundColor: t.card }} />
                <Text numberOfLines={1} style={{ color: t.text, fontSize: 12, fontWeight: '700', marginTop: 5 }}>
                  {item.name}
                </Text>
                <Text numberOfLines={1} style={{ color: t.muted, fontSize: 11 }}>
                  {item.artist}
                </Text>
              </TouchableOpacity>
            )}
          />
        )}

        {sel ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 }}>
            <TouchableOpacity activeOpacity={1} onPress={() => setSel(null)} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
            <View style={{ backgroundColor: t.card, borderRadius: 24, padding: 16, alignItems: 'center' }}>
              <Image source={{ uri: sel.preview }} style={{ width: width - 72, height: width - 72, borderRadius: 16, backgroundColor: t.bg }} />
              <Text style={{ color: t.text, fontSize: 17, fontWeight: '800', marginTop: 12, textAlign: 'center' }} numberOfLines={2}>
                {sel.name}
              </Text>
              <Text style={{ color: t.muted, fontSize: 13, marginTop: 2, textAlign: 'center' }} numberOfLines={1}>
                {sel.artist + (sel.year ? '  •  ' + sel.year : '') + (sel.tracks ? '  •  ' + sel.tracks + ' tracks' : '')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, width: '100%' }}>
                <Pill label="Save to phone" icon="download" onPress={saveToPhone} busy={busy === 'save'} />
                <Pill
                  label={song ? 'Use for song' : 'No song'}
                  icon="image"
                  primary
                  onPress={useCover}
                  busy={busy === 'use'}
                  disabled={!song}
                />
              </View>
              {note ? <Text style={{ color: t.muted, fontSize: 12, marginTop: 10, textAlign: 'center' }}>{note}</Text> : null}
              <TouchableOpacity onPress={() => setSel(null)} style={{ marginTop: 10, padding: 6 }}>
                <Text style={{ color: t.accent, fontWeight: '800' }}>Back to results</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

// ======================= Lyrics finder =======================
export function LyricsFinder({ visible, onClose, song, onApplied }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function search(tt, aa) {
    const name = String(tt || '').trim();
    if (!name) return;
    setLoading(true);
    setErr('');
    setSel(null);
    setNote('');
    try {
      const a = String(aa || '').trim();
      let data = await getJson(
        'https://lrclib.net/api/search?track_name=' + encodeURIComponent(name) + (a ? '&artist_name=' + encodeURIComponent(a) : '')
      );
      if (!Array.isArray(data) || data.length === 0) {
        data = await getJson('https://lrclib.net/api/search?q=' + encodeURIComponent((name + ' ' + a).trim()));
      }
      const list = (Array.isArray(data) ? data : [])
        .filter((r) => r.instrumental || r.syncedLyrics || r.plainLyrics)
        .map((r) => ({
          id: String(r.id),
          name: r.trackName,
          artist: r.artistName,
          album: r.albumName,
          dur: r.duration || 0,
          synced: r.syncedLyrics || '',
          plain: r.plainLyrics || '',
          instrumental: !!r.instrumental,
        }));
      setItems(list);
    } catch (e) {
      setErr(friendly(e));
      setItems([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!visible) return;
    const tt = song ? song.title || '' : '';
    const aa = song ? song.artist || '' : '';
    setTitle(tt);
    setArtist(aa);
    setItems(null);
    setSel(null);
    setErr('');
    setNote('');
    setBusy(false);
    if (tt) search(tt, aa);
  }, [visible]);

  async function useLyrics() {
    if (!song || !sel) return;
    const text = sel.synced || sel.plain;
    if (!text) return;
    setBusy(true);
    setNote('');
    try {
      await saveEdit(song.id, { lyrics: text });
      if (onApplied) onApplied(refreshSong(song));
      setNote('Done. These lyrics are now saved for "' + song.title + '".');
    } catch (e) {
      setNote(friendly(e));
    }
    setBusy(false);
  }

  const shown = sel ? (sel.plain || sel.synced.replace(/\[\d+:\d+(?:[.:]\d+)?\]\s?/g, '')) : '';
  const mm = (s) => Math.floor(s / 60) + ':' + ('0' + Math.floor(s % 60)).slice(-2);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => (sel ? setSel(null) : onClose())} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 8 }}>
        <Header title="Find lyrics" onClose={onClose} />
        <SearchBar value={title} onChange={setTitle} onGo={() => search(title, artist)} placeholder="Song name" />
        <View style={{ marginHorizontal: 16, marginTop: 8, backgroundColor: t.card, borderRadius: 14, paddingHorizontal: 12, height: 44, justifyContent: 'center' }}>
          <TextInput
            style={{ color: t.text, fontSize: 15, paddingVertical: 0 }}
            value={artist}
            onChangeText={setArtist}
            placeholder="Artist (optional)"
            placeholderTextColor={t.muted}
            returnKeyType="search"
            onSubmitEditing={() => search(title, artist)}
            autoCorrect={false}
          />
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={t.accent} size="large" />
          </View>
        ) : (
          <FlatList
            data={items || []}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 10 }}
            ListEmptyComponent={
              <Text style={{ color: err ? '#F87171' : t.muted, textAlign: 'center', marginTop: 50, paddingHorizontal: 30 }}>
                {err || (items ? 'No lyrics found. Try fewer words or leave the artist empty.' : 'Search for a song to find its lyrics.')}
              </Text>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  setSel(item);
                  setNote('');
                }}
                style={{ marginHorizontal: 16, marginTop: 8, padding: 12, borderRadius: 14, backgroundColor: t.card }}
              >
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {[item.artist, item.album, item.dur ? mm(item.dur) : ''].filter(Boolean).join('  •  ')}
                </Text>
                <Text style={{ color: t.accent, fontSize: 11, fontWeight: '800', marginTop: 4 }}>
                  {item.instrumental ? 'INSTRUMENTAL' : item.synced ? 'TIMED LYRICS' : 'TEXT ONLY'}
                </Text>
              </TouchableOpacity>
            )}
          />
        )}

        {sel ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: t.bg, paddingTop: insets.top + 8 }}>
            <Header title={sel.name} onClose={() => setSel(null)} />
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
              <Text style={{ color: t.muted, fontSize: 12, marginBottom: 10 }}>
                {[sel.artist, sel.album].filter(Boolean).join('  •  ')}
              </Text>
              {sel.instrumental ? (
                <Text style={{ color: t.text, fontSize: 15 }}>This song is marked as instrumental.</Text>
              ) : (
                <Text style={{ color: t.text, fontSize: 15, lineHeight: 24 }}>{shown}</Text>
              )}
            </ScrollView>
            <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 14 }}>
              {note ? <Text style={{ color: t.muted, fontSize: 12, textAlign: 'center', marginBottom: 8 }}>{note}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pill label="Back" icon="arrow-back" onPress={() => setSel(null)} />
                <Pill
                  label={song ? 'Use these lyrics' : 'No song'}
                  icon="checkmark"
                  primary
                  onPress={useLyrics}
                  busy={busy}
                  disabled={!song || sel.instrumental || !(sel.synced || sel.plain)}
                />
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
