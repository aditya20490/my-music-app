// The looks of the app. Every UI style lives in this one file, so adding a new style never means touching the big files again.
// Options > Style picks the look. In Classic, Options > Theme picks the colors.
// The saved theme is "color" (classic look) or "style:color", for example "neu:dark" (the color is ignored by soft styles).

export const UI_STYLES = [
  { key: 'default', label: 'Classic', icon: 'phone-portrait' },
  { key: 'neu', label: 'Neumorphism', icon: 'ellipse' },
];

export function splitThemeId(id) {
  const s = String(id || 'dark');
  const at = s.indexOf(':');
  if (at < 0) return { ui: 'default', base: s };
  const ui = s.slice(0, at);
  return { ui: UI_STYLES.some((u) => u.key === ui) ? ui : 'default', base: s.slice(at + 1) };
}

export function joinThemeId(ui, base) {
  return !ui || ui === 'default' ? base : ui + ':' + base;
}

// True while a soft white style is on (other parts of the app use it to skip dark effects)
let ACTIVE = 'default';
export function isSoftUi() {
  return ACTIVE !== 'default';
}

// ---------- Neumorphism: soft white, raised and pressed-in shapes, one soft blue accent ----------
const NEU = {
  id: 'neu',
  name: 'Neumorphism',
  isDark: false,
  bg: '#E6EBF2',
  bgTop: '#F3F6FB',
  card: '#EEF2F8',
  text: '#3A4358',
  muted: '#8B94A8',
  accent: '#3D6DF2',
  accent2: '#6C98FF',
  track: '#DCE2EC',
  onAccent: '#FFFFFF',
};

const RAISED = '#F3F6FB'; // the surface of things that stand out
const PIT = '#DCE2EC'; // the surface of things pressed in
const SHADOW = '#8F9BB5'; // soft grey-blue shadow
const ACCENT_SHADOW = '#4A63B8'; // shadow under blue buttons

// Changes the colors of the chosen style
export function applyUiTheme(t, ui) {
  ACTIVE = ui;
  if (ui === 'neu') return { ...NEU, ui: 'neu' };
  return { ...t, ui: 'default' };
}

// Changes the shapes and shadows of the chosen style.
// It only uses soft shadows and flat colors (no drawn edges), which keeps the app fast and smooth.
export function applyUiStyles(t, s) {
  if (t.ui !== 'neu') return s;
  const raise = (o) => ({
    backgroundColor: RAISED,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    elevation: 6,
    shadowColor: SHADOW,
    ...o,
  });
  const pit = (o) => ({
    backgroundColor: PIT,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    ...o,
  });
  const lift = (o) => ({ elevation: 8, shadowColor: ACCENT_SHADOW, ...o });
  const m = (k, o) => ({ ...s[k], ...o });
  return {
    ...s,
    headerBtn: m('headerBtn', raise({ width: 40, height: 40, borderRadius: 20 })),
    searchBox: m('searchBox', pit({ borderRadius: 22, height: 44 })),
    segment: m('segment', pit({ borderRadius: 22, padding: 4 })),
    segItem: m('segItem', { borderRadius: 18 }),
    actionButton: m('actionButton', lift({ height: 44, borderRadius: 22 })),
    actionButtonDark: m('actionButtonDark', raise()),
    primaryButton: m('primaryButton', lift({ borderRadius: 30 })),
    rescanButton: m('rescanButton', lift({ borderRadius: 26 })),
    chip: m('chip', raise({ borderRadius: 20, elevation: 3 })),
    mini: m('mini', raise({ borderRadius: 24, elevation: 14 })),
    miniProgressBg: m('miniProgressBg', { backgroundColor: PIT }),
    seekTrack: m('seekTrack', { height: 8, borderRadius: 4, backgroundColor: PIT }),
    seekFill: m('seekFill', { height: 8 }),
    seekThumb: m('seekThumb', raise({ width: 22, height: 22, borderRadius: 11, top: 5, marginLeft: -11, backgroundColor: '#FFFFFF' })),
    fullTopBtn: m('fullTopBtn', raise({ borderRadius: 22 })),
    ctrlSmall: m('ctrlSmall', raise({ borderRadius: 22 })),
    ctrlMid: m('ctrlMid', raise({ borderRadius: 26 })),
    bigPlay: m('bigPlay', lift({ elevation: 12 })),
    sheet: m('sheet', raise({ borderWidth: 0, borderTopLeftRadius: 32, borderTopRightRadius: 32, elevation: 24 })),
    sheetHandle: m('sheetHandle', { backgroundColor: PIT }),
    sheetBackdrop: m('sheetBackdrop', { backgroundColor: 'rgba(40,50,80,0.35)' }),
    infoBox: m('infoBox', pit({ borderRadius: 18 })),
  };
}
