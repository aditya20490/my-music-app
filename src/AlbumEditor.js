// The "New album" / "Edit album" screen: type a name, tick the songs, save.
// Your albums live inside the app only. The songs on the phone are never touched.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Modal, FlatList, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme';

const ROW = 58;

export default function AlbumEditor({ visible, album, songs, onClose, onSave }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const st = useMemo(() => makeStyles(t), [t]);

  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [query, setQuery] = useState('');

  const albumId = album ? album.id : null;

  useEffect(() => {
    if (!visible || !album) return;
    setName(album.name || '');
    setPicked(album.songIds || []);
    setQuery('');
  }, [visible, albumId]);

  const pickedSet = useMemo(() => new Set(picked), [picked]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter(
      (x) => x.title.toLowerCase().includes(q) || (x.artist || '').toLowerCase().includes(q)
    );
  }, [songs, query]);

  if (!album) return null;

  const canSave = name.trim().length > 0 && picked.length > 0;

  function toggle(id) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function save() {
    if (!canSave) return;
    onSave({ id: album.id, name: name.trim(), songIds: picked });
  }

  const renderItem = ({ item }) => {
    const on = pickedSet.has(item.id);
    return (
      <TouchableOpacity style={st.row} activeOpacity={0.7} onPress={() => toggle(item.id)}>
        <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? t.accent : t.muted} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={st.rowTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={st.rowSub} numberOfLines={1}>
            {item.artist || 'Unknown artist'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={[st.screen, { paddingTop: insets.top + 8 }]}>
        <View style={st.top}>
          <TouchableOpacity onPress={onClose} style={st.topBtn}>
            <Ionicons name="close" size={26} color={t.text} />
          </TouchableOpacity>
          <Text style={st.topTitle}>{album.id ? 'Edit album' : 'New album'}</Text>
          <TouchableOpacity onPress={save} style={[st.saveBtn, !canSave && { opacity: 0.4 }]} disabled={!canSave}>
            <Text style={st.saveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <View style={st.box}>
          <TextInput
            style={st.input}
            value={name}
            onChangeText={setName}
            placeholder="Album name"
            placeholderTextColor={t.muted}
            autoCorrect={false}
          />
          <View style={[st.input, st.searchRow]}>
            <Ionicons name="search" size={18} color={t.muted} />
            <TextInput
              style={st.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search songs"
              placeholderTextColor={t.muted}
              autoCorrect={false}
            />
          </View>
          <Text style={st.count}>{picked.length + (picked.length === 1 ? ' song selected' : ' songs selected')}</Text>
        </View>

        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          extraData={pickedSet}
          getItemLayout={(data, index) => ({ length: ROW, offset: ROW * index, index })}
          initialNumToRender={20}
          windowSize={9}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        />
      </View>
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
    box: { paddingHorizontal: 16, paddingBottom: 6 },
    input: {
      backgroundColor: t.card,
      color: t.text,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 11,
      fontSize: 15,
      marginTop: 10,
    },
    searchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 0, height: 44 },
    searchInput: { flex: 1, color: t.text, fontSize: 15, marginLeft: 8, paddingVertical: 0 },
    count: { color: t.muted, fontSize: 12, marginTop: 10, marginBottom: 4 },
    row: { height: ROW, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
    rowTitle: { color: t.text, fontSize: 15, fontWeight: '600' },
    rowSub: { color: t.muted, fontSize: 12, marginTop: 2 },
  });
}
