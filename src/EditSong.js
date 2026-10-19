// The "Edit song" screen: change title, artist, album... and the cover picture.
// Changes are saved inside the app. The audio file is never touched.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Alert,
  Platform,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme';
import { Art } from './ui';
import { saveEdit, clearEdit, pickCoverFile, PICKER_AVAILABLE } from './edits';
import { refreshSong, fetchLyrics } from './library';

const TEXT_FIELDS = [
  { k: 'title', label: 'Title' },
  { k: 'artist', label: 'Artist' },
  { k: 'album', label: 'Album' },
  { k: 'albumArtist', label: 'Album artist' },
  { k: 'genre', label: 'Genre' },
  { k: 'composer', label: 'Composer' },
];
const NUM_FIELDS = [
  { k: 'year', label: 'Year' },
  { k: 'track', label: 'Track' },
  { k: 'disc', label: 'Disc' },
];

function startValues(song) {
  const v = {};
  TEXT_FIELDS.forEach((f) => {
    v[f.k] = song ? String(song[f.k] || '') : '';
  });
  NUM_FIELDS.forEach((f) => {
    v[f.k] = song && song[f.k] ? String(song[f.k]) : '';
  });
  return v;
}

export default function EditSong({ visible, song, onClose, onChange }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const st = useMemo(() => makeStyles(t), [t]);

  const [vals, setVals] = useState(startValues(null));
  const [lyrics, setLyrics] = useState('');
  const [cover, setCover] = useState(undefined); // undefined = unchanged, null = original, '' = none, string = new picture
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const initial = useRef({ vals: startValues(null), lyrics: '' });

  const songId = song ? song.id : null;

  useEffect(() => {
    if (!visible || !song) return undefined;
    const v = startValues(song);
    initial.current = { vals: v, lyrics: '' };
    setVals(v);
    setLyrics('');
    setCover(undefined);
    setNote('');
    setBusy(false);
    let alive = true;
    if (song.lyricsEdit !== undefined) {
      initial.current.lyrics = song.lyricsEdit;
      setLyrics(song.lyricsEdit);
    } else {
      fetchLyrics(song.uri).then((r) => {
        if (alive && r && r.text) {
          initial.current.lyrics = r.text;
          setLyrics(r.text);
        }
      });
    }
    return () => {
      alive = false;
    };
  }, [visible, songId]);

  if (!song) return null;

  const setField = (k, text) => setVals((prev) => ({ ...prev, [k]: text }));

  async function chooseCover() {
    setNote('');
    const r = await pickCoverFile(song.id);
    if (r.uri) setCover(r.uri);
    else if (r.error) setNote(r.error);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const patch = {};
      TEXT_FIELDS.forEach((f) => {
        const now = vals[f.k].trim();
        if (now !== initial.current.vals[f.k].trim()) patch[f.k] = now;
      });
      NUM_FIELDS.forEach((f) => {
        const now = vals[f.k].trim();
        if (now !== initial.current.vals[f.k].trim()) patch[f.k] = now ? parseInt(now, 10) || 0 : 0;
      });
      if (lyrics !== initial.current.lyrics) patch.lyrics = lyrics.trim() ? lyrics : null;
      if (cover !== undefined) patch.cover = cover;

      if (Object.keys(patch).length > 0) {
        await saveEdit(song.id, patch);
        onChange(refreshSong(song));
      }
      onClose();
    } catch (e) {
      setNote('Could not save: ' + (e && e.message ? e.message : String(e)));
      setBusy(false);
    }
  }

  function resetAll() {
    Alert.alert('Reset this song?', 'All your changes to this song (details and cover) will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await clearEdit(song.id);
          onChange(refreshSong(song));
          onClose();
        },
      },
    ]);
  }

  let preview;
  if (typeof cover === 'string' && cover) {
    preview = (
      <View style={st.previewBox}>
        <Image source={{ uri: cover }} style={st.previewImg} resizeMode="contain" />
      </View>
    );
  } else if (cover === '' || cover === null) {
    preview = (
      <View style={[st.previewBox, st.previewEmpty]}>
        <Ionicons name={cover === '' ? 'image-outline' : 'refresh'} size={40} color={t.muted} />
        <Text style={st.previewText}>{cover === '' ? 'No cover' : 'Original cover will come back'}</Text>
      </View>
    );
  } else {
    preview = (
      <View style={st.previewBox}>
        <Art song={song} size={200} radius={16} />
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <KeyboardAvoidingView
        style={[st.screen, { paddingTop: insets.top + 8 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={st.top}>
          <TouchableOpacity onPress={onClose} style={st.topBtn}>
            <Ionicons name="close" size={26} color={t.text} />
          </TouchableOpacity>
          <Text style={st.topTitle}>Edit song</Text>
          <TouchableOpacity onPress={save} style={st.saveBtn} disabled={busy}>
            <Text style={st.saveText}>{busy ? 'Saving...' : 'Save'}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}
        >
          <Text style={st.info}>Changes are saved inside this app. The audio file itself is never touched.</Text>

          <View style={st.coverRow}>{preview}</View>
          <View style={st.coverBtns}>
            <TouchableOpacity style={[st.btn, { backgroundColor: t.accent }]} onPress={chooseCover} disabled={!PICKER_AVAILABLE}>
              <Ionicons name="image" size={16} color={t.onAccent} />
              <Text style={[st.btnText, { color: t.onAccent }]}>Change cover</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.btn} onPress={() => setCover('')}>
              <Ionicons name="trash-outline" size={16} color={t.text} />
              <Text style={st.btnText}>Remove</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.btn} onPress={() => setCover(null)}>
              <Ionicons name="refresh" size={16} color={t.text} />
              <Text style={st.btnText}>Original</Text>
            </TouchableOpacity>
          </View>
          {!PICKER_AVAILABLE ? <Text style={st.warn}>The picture picker is not part of this build.</Text> : null}
          {note ? <Text style={st.warn}>{note}</Text> : null}

          {TEXT_FIELDS.map((f) => (
            <View key={f.k} style={st.field}>
              <Text style={st.label}>{f.label}</Text>
              <TextInput
                style={st.input}
                value={vals[f.k]}
                onChangeText={(x) => setField(f.k, x)}
                placeholder={f.label}
                placeholderTextColor={t.muted}
                autoCorrect={false}
              />
            </View>
          ))}

          <View style={st.numRow}>
            {NUM_FIELDS.map((f) => (
              <View key={f.k} style={[st.field, { flex: 1 }]}>
                <Text style={st.label}>{f.label}</Text>
                <TextInput
                  style={st.input}
                  value={vals[f.k]}
                  onChangeText={(x) => setField(f.k, x.replace(/[^0-9]/g, ''))}
                  placeholder="0"
                  placeholderTextColor={t.muted}
                  keyboardType="number-pad"
                />
              </View>
            ))}
          </View>

          <View style={st.field}>
            <Text style={st.label}>Lyrics</Text>
            <TextInput
              style={[st.input, { minHeight: 140, textAlignVertical: 'top' }]}
              value={lyrics}
              onChangeText={setLyrics}
              placeholder="Lyrics"
              placeholderTextColor={t.muted}
              multiline
            />
          </View>

          <TouchableOpacity style={st.resetBtn} onPress={resetAll}>
            <Ionicons name="arrow-undo" size={16} color="#F87171" />
            <Text style={st.resetText}>Reset this song to original</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: 8 },
    topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    topTitle: { color: t.text, fontSize: 18, fontWeight: '800' },
    saveBtn: { backgroundColor: t.accent, paddingHorizontal: 18, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
    saveText: { color: t.onAccent, fontSize: 14, fontWeight: '800' },
    info: { color: t.muted, fontSize: 12, textAlign: 'center', marginBottom: 14 },
    coverRow: { alignItems: 'center' },
    previewBox: { width: 200, height: 200, borderRadius: 16, overflow: 'hidden', backgroundColor: t.card },
    previewImg: { width: 200, height: 200 },
    previewEmpty: { alignItems: 'center', justifyContent: 'center', padding: 12 },
    previewText: { color: t.muted, fontSize: 13, marginTop: 8, textAlign: 'center' },
    coverBtns: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' },
    btn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      height: 38,
      borderRadius: 19,
      backgroundColor: t.card,
    },
    btnText: { color: t.text, fontSize: 13, fontWeight: '700' },
    warn: { color: '#F87171', fontSize: 12, textAlign: 'center', marginTop: 8 },
    field: { marginTop: 14 },
    label: { color: t.muted, fontSize: 12, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' },
    input: {
      backgroundColor: t.card,
      color: t.text,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 11,
      fontSize: 15,
    },
    numRow: { flexDirection: 'row', gap: 10 },
    resetBtn: {
      marginTop: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: '#F87171',
    },
    resetText: { color: '#F87171', fontSize: 14, fontWeight: '700' },
  });
}
