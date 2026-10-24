// The looks of the app. Every UI style lives in this one file, so adding a new style never means touching the big files again.
// Options > Style picks the look. Options > Theme still picks the colors.
// The saved theme is "color" (classic look) or "style:color", for example "neu:blue".

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

// ---------- color helpers ----------
function hexToRgb(h) {
  const n = parseInt(String(h).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, k) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const f = (x, y) => ('0' + Math.round(x + (y - x) * k).toString(16)).slice(-2);
  return '#' + f(A[0], B[0]) + f(A[1], B[1]) + f(A[2], B[2]);
}

// ---------- Neumorphism ----------
// One soft color for everything. Things that stand out have a light edge on the top left and a dark edge on the bottom right.
// Things that are pressed in (search, tabs, seek bar) are the other way around. The chosen color theme tints the surface.
function neuColors(t) {
  const dark = t.isDark;
  const base = dark ? mix(t.bg, '#9AA0B5', 0.2) : mix(t.bg, '#C8CFDF', 0.55);
  return {
    base,
    hi: dark ? mix(base, '#FFFFFF', 0.09) : '#FFFFFF',
    lo: dark ? mix(base, '#000000', 0.5) : mix(base, '#7C88A8', 0.5),
    pit: dark ? mix(base, '#000000', 0.28) : mix(base, '#8E99B5', 0.22),
  };
}

// Changes the colors of the chosen theme for the chosen style
export function applyUiTheme(t, ui) {
  if (ui !== 'neu') return { ...t, ui: 'default' };
  const c = neuColors(t);
  return { ...t, ui: 'neu', neu: c, bg: c.base, bgTop: c.base, card: c.base, track: c.pit };
}

// Changes the shapes and shadows of the chosen style
export function applyUiStyles(t, s) {
  if (t.ui !== 'neu') return s;
  const { base, hi, lo, pit } = t.neu;
  const up = (o) => ({
    backgroundColor: base,
    borderWidth: 1.5,
    borderTopColor: hi,
    borderLeftColor: hi,
    borderBottomColor: lo,
    borderRightColor: lo,
    elevation: 5,
    shadowColor: lo,
    ...o,
  });
  const down = (o) => ({
    backgroundColor: pit,
    borderWidth: 1.5,
    borderTopColor: lo,
    borderLeftColor: lo,
    borderBottomColor: hi,
    borderRightColor: hi,
    ...o,
  });
  // a raised button that keeps its own color (the colored buttons)
  const glow = {
    elevation: 7,
    shadowColor: lo,
    borderWidth: 1.5,
    borderTopColor: 'rgba(255,255,255,0.4)',
    borderLeftColor: 'rgba(255,255,255,0.4)',
    borderBottomColor: 'rgba(0,0,0,0.25)',
    borderRightColor: 'rgba(0,0,0,0.25)',
  };
  const m = (k, o) => ({ ...s[k], ...o });
  return {
    ...s,
    headerBtn: m('headerBtn', up()),
    searchBox: m('searchBox', down()),
    segment: m('segment', down()),
    actionButton: m('actionButton', glow),
    actionButtonDark: m('actionButtonDark', up()),
    primaryButton: m('primaryButton', glow),
    rescanButton: m('rescanButton', glow),
    bigPlay: m('bigPlay', { ...glow, elevation: 10 }),
    ctrlSmall: m('ctrlSmall', up({ borderRadius: 22, elevation: 4 })),
    ctrlMid: m('ctrlMid', up({ borderRadius: 26, elevation: 5 })),
    mini: m('mini', up({ elevation: 10 })),
    miniProgressBg: m('miniProgressBg', { backgroundColor: pit }),
    seekTrack: m('seekTrack', { backgroundColor: pit }),
    seekThumb: m('seekThumb', up({ borderWidth: 1, elevation: 4 })),
    chip: m('chip', up({ elevation: 3 })),
    sheet: m('sheet', up({ borderWidth: 0, borderTopWidth: 2, borderTopColor: hi, elevation: 20 })),
    sheetHandle: m('sheetHandle', { backgroundColor: pit }),
    infoBox: m('infoBox', down({ borderRadius: 14 })),
  };
}
