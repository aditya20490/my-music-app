// Colors (themes) and all the looks of the app.
import { createContext, useContext } from 'react';
import { StyleSheet } from 'react-native';

export const THEMES = [
  { id: 'dark', name: 'Dark', isDark: true, bg: '#0B0B10', bgTop: '#2B1F55', card: '#1A1A24', text: '#FFFFFF', muted: '#9A9AA8', accent: '#A78BFA', accent2: '#EC4899', track: '#33333F', onAccent: '#0B0B10' },
  { id: 'amoled', name: 'Black', isDark: true, bg: '#000000', bgTop: '#062A33', card: '#111114', text: '#FFFFFF', muted: '#8E8E99', accent: '#22D3EE', accent2: '#6366F1', track: '#2A2A30', onAccent: '#000000' },
  { id: 'red', name: 'Red', isDark: true, bg: '#1C0508', bgTop: '#6B0F1E', card: '#3A111A', text: '#FFFFFF', muted: '#C49A9F', accent: '#FF4D5E', accent2: '#FF8A3D', track: '#5C2230', onAccent: '#FFFFFF' },
  { id: 'pink', name: 'Pink', isDark: true, bg: '#220718', bgTop: '#7A1850', card: '#471331', text: '#FFFFFF', muted: '#C99BB8', accent: '#FF6FB5', accent2: '#C084FC', track: '#64214A', onAccent: '#2A0618' },
  { id: 'blue', name: 'Blue', isDark: true, bg: '#050F26', bgTop: '#123C86', card: '#0F2859', text: '#FFFFFF', muted: '#9FB0D0', accent: '#4DA3FF', accent2: '#22D3EE', track: '#25427A', onAccent: '#04122B' },
  { id: 'green', name: 'Green', isDark: true, bg: '#04180C', bgTop: '#0F6638', card: '#0D3F24', text: '#FFFFFF', muted: '#9CBBA9', accent: '#34D67A', accent2: '#14B8A6', track: '#1F5A39', onAccent: '#03150A' },
  { id: 'orange', name: 'Orange', isDark: true, bg: '#1E0F03', bgTop: '#7A3D08', card: '#47260B', text: '#FFFFFF', muted: '#C9AE95', accent: '#FF9A3D', accent2: '#FACC15', track: '#6B4220', onAccent: '#1E0F03' },
  { id: 'purple', name: 'Purple', isDark: true, bg: '#10052B', bgTop: '#4A1C9A', card: '#2B1259', text: '#FFFFFF', muted: '#B2A3D0', accent: '#B27CFF', accent2: '#6C7BFF', track: '#463078', onAccent: '#10052B' },
  { id: 'light', name: 'Light', isDark: false, bg: '#F6F6FA', bgTop: '#E2D6FF', card: '#FFFFFF', text: '#111118', muted: '#6B6B7B', accent: '#7C3AED', accent2: '#EC4899', track: '#DADAE4', onAccent: '#FFFFFF' },
];

export function getTheme(id) {
  return THEMES.find((th) => th.id === id) || THEMES[0];
}

export const ThemeContext = createContext({ t: THEMES[0], s: null });

export function useTheme() {
  return useContext(ThemeContext);
}

export function makeStyles(t) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    centerText: { color: t.muted, fontSize: 15, textAlign: 'center' },
    errorText: { color: '#F87171', fontSize: 13, textAlign: 'center', marginTop: 14 },
    noteText: { color: t.muted, fontSize: 12, marginHorizontal: 16, marginBottom: 6 },
    emptyWrap: { alignItems: 'center', paddingHorizontal: 32, marginTop: 40 },

    // header
    headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
    bigTitle: { color: t.text, fontSize: 24, fontWeight: '800' },
    headerSub: { color: t.muted, fontSize: 12, marginTop: 0 },
    headerBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.card,
      marginLeft: 8,
    },

    // search + tabs
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.card,
      marginHorizontal: 16,
      paddingHorizontal: 14,
      borderRadius: 14,
      height: 40,
    },
    searchInput: { flex: 1, color: t.text, fontSize: 15, marginLeft: 8, paddingVertical: 0 },
    segment: {
      flexDirection: 'row',
      marginHorizontal: 16,
      marginTop: 8,
      backgroundColor: t.card,
      borderRadius: 14,
      padding: 3,
    },
    segItem: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 7,
      borderRadius: 11,
    },
    segText: { color: t.muted, fontSize: 13, fontWeight: '700' },

    // buttons
    actionRow: { flexDirection: 'row', paddingHorizontal: 16, marginTop: 8, marginBottom: 6, gap: 10 },
    actionButton: {
      height: 40,
      borderRadius: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    actionButtonDark: { backgroundColor: t.card },
    actionText: { color: t.text, fontSize: 14, fontWeight: '700' },
    actionTextWhite: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    primaryButton: {
      marginTop: 28,
      backgroundColor: t.accent,
      paddingVertical: 14,
      paddingHorizontal: 40,
      borderRadius: 28,
    },
    primaryButtonText: { color: t.onAccent, fontSize: 16, fontWeight: '800' },
    linkButton: { marginTop: 18, padding: 8 },
    linkText: { color: t.accent, fontSize: 15 },

    // list rows
    row: { height: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
    rowText: { flex: 1, marginLeft: 14, marginRight: 10 },
    rowTitle: { color: t.text, fontSize: 16, fontWeight: '600' },
    rowSub: { color: t.muted, fontSize: 13, marginTop: 3 },
    rowTime: { color: t.muted, fontSize: 12 },
    rowNote: { marginLeft: 8 },

    // grid tiles (square with round corners, title at the very bottom)
    tile: { overflow: 'hidden', backgroundColor: t.card, borderRadius: 12 },
    tileScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 6, paddingBottom: 5, paddingTop: 22 },
    tileTitle: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
    tileArtist: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 1 },
    badge: {
      position: 'absolute',
      top: 8,
      right: 8,
      backgroundColor: 'rgba(0,0,0,0.6)',
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 8,
    },
    badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
    tileActive: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 3, borderRadius: 12 },

    // albums / artists
    groupTitle: { color: t.text, fontSize: 14, fontWeight: '700', marginTop: 8 },
    groupSub: { color: t.muted, fontSize: 12, marginTop: 2 },
    overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.bg },
    overlayTop: { paddingHorizontal: 12, flexDirection: 'row' },
    groupHead: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
    groupHeadTitle: { color: t.text, fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 16 },
    groupHeadSub: { color: t.muted, fontSize: 14, marginTop: 4, textAlign: 'center' },

    // mini player
    mini: {
      position: 'absolute',
      left: 12,
      right: 12,
      height: 64,
      backgroundColor: t.card,
      borderRadius: 18,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      overflow: 'hidden',
      elevation: 8,
    },
    miniProgressBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: t.track },
    miniProgressFill: { height: 3, backgroundColor: t.accent },
    miniTextWrap: { flex: 1, marginLeft: 12 },
    miniTitle: { color: t.text, fontSize: 15, fontWeight: '600' },
    miniArtist: { color: t.muted, fontSize: 12, marginTop: 2 },
    miniBtn: { paddingHorizontal: 8, paddingVertical: 8 },

    // seek bar
    seekTouch: { height: 32, justifyContent: 'center' },
    seekInner: { height: 32, justifyContent: 'center' },
    seekTrack: { height: 6, backgroundColor: t.track, borderRadius: 3, overflow: 'hidden' },
    seekFill: { height: 6, backgroundColor: t.accent },
    seekThumb: {
      position: 'absolute',
      top: 9,
      width: 14,
      height: 14,
      marginLeft: -7,
      borderRadius: 7,
      backgroundColor: t.text,
    },
    timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
    time: { color: t.muted, fontSize: 12 },

    // full-screen player
    full: { flex: 1, paddingHorizontal: 24 },
    fullTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    fullTopBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    fullTopTitle: { color: t.text, fontSize: 16, fontWeight: '700' },
    pageArea: { flex: 1, marginTop: 8 },
    fullArt: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    pageCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    pageEmptyText: { color: t.muted, fontSize: 15, textAlign: 'center', marginTop: 12 },
    pageErrorText: { color: '#F87171', fontSize: 12, textAlign: 'center', marginTop: 10 },
    lyricsContent: { paddingVertical: 40, paddingHorizontal: 8 },
    lyricLine: { color: t.text, fontSize: 20, fontWeight: '700', textAlign: 'center', lineHeight: 30, paddingVertical: 6 },
    lyricLineDim: { opacity: 0.5 },
    infoRow: {
      flexDirection: 'row',
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.track,
    },
    infoLabel: { color: t.muted, fontSize: 14, width: 110 },
    infoValue: { color: t.text, fontSize: 14, fontWeight: '600', flex: 1 },
    fullInfo: { marginTop: 12 },
    fullTitle: { color: t.text, fontSize: 22, fontWeight: '800' },
    fullArtist: { color: t.muted, fontSize: 15, marginTop: 4 },
    fullSub: { color: t.muted, fontSize: 12, marginTop: 4 },
    fullSeek: { marginTop: 10 },
    controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
    ctrlSmall: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    ctrlMid: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
    bigPlay: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
    repeatOne: { position: 'absolute', fontSize: 10, fontWeight: '800', top: 14 },
    pageTabs: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 6 },
    pageTab: { alignItems: 'center', paddingVertical: 6, width: 90 },
    pageTabText: { color: t.muted, fontSize: 11, fontWeight: '700', marginTop: 2 },

    // options sheet
    sheetWrap: { flex: 1, justifyContent: 'flex-end' },
    sheetBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: {
      backgroundColor: t.card,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingHorizontal: 20,
      paddingTop: 10,
      maxHeight: '88%',
    },
    sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: t.track, alignSelf: 'center', marginBottom: 6 },
    sheetTitle: { color: t.text, fontSize: 15, fontWeight: '800', marginTop: 18, marginBottom: 10 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.track,
    },
    chipText: { color: t.text, fontSize: 14, fontWeight: '600' },
    swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    swatchItem: { alignItems: 'center', width: 64 },
    swatch: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
    swatchName: { color: t.muted, fontSize: 11, marginTop: 6 },
    infoBox: { backgroundColor: t.bg, borderRadius: 14, padding: 12 },
    infoLine: { color: t.muted, fontSize: 12, lineHeight: 18 },
    rescanButton: {
      marginTop: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: t.accent,
      borderRadius: 24,
      paddingVertical: 13,
    },
    rescanText: { color: t.onAccent, fontSize: 15, fontWeight: '800' },
  });
}
