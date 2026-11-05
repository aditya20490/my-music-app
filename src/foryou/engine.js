// The brain of "For You". It builds playlists from three things:
//   1) what is on your phone (artist, genre, year, when you added it)
//   2) how you listen (plays, skips, favorites, time of day)
//   3) what the internet knows about your artists (mood, style, language), saved by enrich.js
// Nothing is hard coded: the playlists, their songs and their names are worked out again from your data.
// They stay steady for a few hours, then rotate, and "Refresh" mixes them again.
import * as Store from './store';
import { artistKeyOf, normTag } from './enrich';

const DAY = 86400000;

// ---------- small helpers ----------
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand01(seedText) {
  let a = hashStr(seedText) + 0x6d2b79f5;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

function pickName(list, seedText) {
  return list[Math.floor(rand01(seedText) * list.length) % list.length];
}

function cap(s) {
  return String(s)
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function addedMs(song) {
  const a = song.added || 0;
  if (a <= 0) return 0;
  return a < 1e12 ? a * 1000 : a;
}

function primaryArtistName(song) {
  const n = String(song.artist || '').trim();
  if (!n) return '';
  return n.split(/\s*(?:,|&|;|\/|\sfeat\.?\s|\sft\.?\s|\sfeaturing\s|\sx\s|\swith\s)\s*/i)[0].trim();
}

// ---------- names (picked by the engine, never typed per playlist) ----------
const TAG_NAMES = {
  chill: ['Chill Vibes', 'Easy Evenings', 'Slow Down'],
  romantic: ['Love Notes', 'Heart Season', 'Hopeless Romantic'],
  party: ['Party Starters', 'Turn It Up', 'Main Character Energy'],
  sad: ['Heartbreak Hours', 'Feels Heavy', 'Rainy Mood'],
  workout: ['Workout Energy', 'Gym Fuel', 'Push Harder'],
  dance: ['Dance Floor', 'Move Your Feet', 'Beat Drop'],
  'hip-hop': ['Hip-Hop Heat', 'Bars & Beats', 'Cypher Mode'],
  rock: ['Rock Room', 'Loud & Proud', 'Guitar Heroes'],
  pop: ['Pop Rush', 'Pure Pop', 'Pop Favourites'],
  bollywood: ['Bollywood Beats', 'Desi Favourites', 'Filmi Feels'],
  punjabi: ['Punjabi Pulse', 'Punjabi Swag', 'Desi Beats'],
  acoustic: ['Unplugged', 'Acoustic Afternoons', 'Stripped Back'],
  instrumental: ['Instrumental Focus', 'No Words Needed', 'Deep Focus'],
  electronic: ['Electronic Pulse', 'Neon Nights', 'Synth City'],
  indie: ['Indie Discoveries', 'Indie Room', 'Off the Beaten Path'],
  classical: ['Classical Calm', 'Timeless Strings', 'Concert Hall'],
  lofi: ['Lo-Fi Corner', 'Study Beats', 'Lo-Fi Late Hours'],
  sufi: ['Sufi Soul', 'Soulful Sufi', 'Rooh Se'],
  devotional: ['Devotional Peace', 'Divine Calm', 'Bhakti Hours'],
  ghazal: ['Ghazal Evenings', 'Ghazal Nights', 'Poetry in Music'],
  rnb: ['R&B Smooth', 'Late Night R&B', 'Smooth Grooves'],
  jazz: ['Jazz Lounge', 'Smoky Jazz', 'Jazz After Hours'],
  metal: ['Heavy Hitters', 'Metal Core', 'Turn the Amps Up'],
  country: ['Country Roads', 'Country Heart', 'Down Home'],
  soundtrack: ['Soundtrack Moods', 'Cinema Sounds', 'Scenes & Scores'],
  retro: ['Retro Gold', 'Golden Oldies', 'Vintage Vibes'],
  folk: ['Folk Tales', 'Folk Fireside', 'Roots'],
  reggae: ['Reggae Rhythms', 'Island Time', 'Easy Skank'],
  latin: ['Latin Heat', 'Latin Nights', 'Ritmo'],
  'k-pop': ['K-Pop Rush', 'K-Pop Favourites', 'Seoul Sounds'],
};

const SLOT_NAMES = [
  ['Late Night Vibes', 'After Midnight', 'Night Owl'],
  ['Morning Boost', 'Rise & Shine', 'Fresh Start'],
  ['Afternoon Flow', 'Midday Groove', 'Keep Going'],
  ['Evening Wind-Down', 'Golden Hour', 'Evening Glow'],
];
const SLOT_WORDS = ['your night', 'your morning', 'your afternoon', 'your evening'];
const SLOT_TAGS = [
  ['chill', 'romantic', 'sad', 'acoustic', 'lofi', 'instrumental'],
  ['pop', 'acoustic', 'dance', 'indie', 'chill'],
  ['pop', 'dance', 'hip-hop', 'rock', 'party', 'electronic'],
  ['chill', 'romantic', 'acoustic', 'sad', 'indie', 'bollywood'],
];

function decadeName(dec, seedText) {
  const yy = String(dec % 100).padStart(2, '0');
  if (dec < 2000) return pickName([yy + 's Throwbacks', yy + 's Gold', 'Back to the ' + yy + 's'], seedText);
  if (dec < 2010) return pickName(['2000s Replay', 'Y2K Era', '2000s Memories'], seedText);
  if (dec < 2020) return pickName(['2010s Rewind', '2010s Anthems', 'Remember 2010s'], seedText);
  return pickName(['Fresh from the 2020s', '2020s Right Now', 'Latest Decade'], seedText);
}

// ---------- the engine ----------
// songs: the library list. favs: Set of favorite ids. opts: { now, refresh }
export function buildMixes(songs, favs, opts) {
  const now = (opts && opts.now) || Date.now();
  const refresh = (opts && opts.refresh) || 0;
  const hour = new Date(now).getHours();
  const slot = Store.slotOfHour(hour);
  const dayNo = Math.floor((now - new Date(now).getTimezoneOffset() * 60000) / DAY);
  const seed = dayNo + ':' + slot + ':' + refresh; // changes 4 times a day, or when you press Refresh

  const taste = Store.getTaste().plays;
  const tagMap = Store.getArtistTags();
  const meta = Store.getMeta();

  const list = songs.filter((s) => s && s.id);
  if (list.length < 8) return [];

  // 1) tags of every song
  const info = new Map(); // id -> { song, tags: Map, aKey, aName, dec }
  const artistNames = new Map(); // key -> display name
  const artistSongs = new Map(); // key -> [song]
  const tagCount = new Map();
  for (const sg of list) {
    const tags = new Map();
    const raw = String(sg.genre || '');
    for (const part of raw.split(/[;,/]/)) {
      if (/^\(?\d+\)?$/.test(part.trim())) continue;
      const tg = normTag(part);
      if (tg) tags.set(tg, Math.max(tags.get(tg) || 0, 1.2));
    }
    const aKey = artistKeyOf(sg.artist);
    if (aKey) {
      if (!artistNames.has(aKey)) artistNames.set(aKey, primaryArtistName(sg));
      if (!artistSongs.has(aKey)) artistSongs.set(aKey, []);
      artistSongs.get(aKey).push(sg);
      const online = tagMap[aKey];
      if (Array.isArray(online)) {
        for (const pair of online) {
          const w = 0.35 + 0.65 * pair[1];
          tags.set(pair[0], Math.max(tags.get(pair[0]) || 0, w));
        }
      }
    }
    let dec = 0;
    if (sg.year >= 1950 && sg.year <= 2035) {
      dec = Math.floor(sg.year / 10) * 10;
      tags.set('d:' + dec, 0.6);
    }
    tags.forEach((w, tg) => tagCount.set(tg, (tagCount.get(tg) || 0) + 1));
    info.set(sg.id, { song: sg, tags: tags, aKey: aKey, dec: dec });
  }

  // 2) how much you like each song (plays, favorites, skips, how recent)
  const aff = new Map();
  for (const sg of list) {
    const e = taste[sg.id];
    let a = favs && favs.has(sg.id) ? 1.5 : 0;
    if (e) {
      const rec = e.last ? Math.exp(-(now - e.last) / (60 * DAY)) : 0.4;
      a += Math.log(1 + e.n) * (0.5 + 0.5 * rec);
      a -= Math.min(e.sk, 5) * 0.3;
    }
    aff.set(sg.id, Math.max(-1, a));
  }

  // 3) your taste: which tags you lean towards
  const profile = new Map();
  let hasSignal = false;
  info.forEach((it, id) => {
    const a = aff.get(id);
    if (a === 0) return;
    hasSignal = true;
    it.tags.forEach((w, tg) => profile.set(tg, (profile.get(tg) || 0) + a * w));
  });
  // a little of the library itself is always mixed in, so a new user still gets playlists
  const libWeight = hasSignal ? 0.04 : 1;
  tagCount.forEach((c, tg) => profile.set(tg, (profile.get(tg) || 0) + libWeight * Math.log(1 + c)));
  let maxP = 0;
  profile.forEach((v) => {
    if (v > maxP) maxP = v;
  });
  if (maxP <= 0) maxP = 1;
  profile.forEach((v, tg) => profile.set(tg, v / maxP));

  const tasteOf = new Map();
  info.forEach((it, id) => {
    let sum = 0;
    let wsum = 0;
    it.tags.forEach((w, tg) => {
      sum += w * Math.max(0, profile.get(tg) || 0);
      wsum += w;
    });
    let v = wsum > 0 ? sum / (wsum + 0.5) : 0.05;
    const a = aff.get(id);
    v += Math.max(-0.3, Math.min(0.6, a * 0.2));
    tasteOf.set(id, v);
  });

  const jit = (id, salt) => rand01(seed + salt + id);
  const rank = (items, score, salt, amount) =>
    items
      .map((sg) => ({ sg: sg, v: score(sg) * (1 - amount / 2 + amount * jit(sg.id, salt)) }))
      .sort((a, b) => b.v - a.v)
      .map((x) => x.sg);

  // keeps the same artist from playing twice in a row where possible
  const spread = (items) => {
    const left = items.slice();
    const out = [];
    let lastKey = '';
    while (left.length > 0) {
      let at = 0;
      const look = Math.min(left.length, 6);
      for (let i = 0; i < look; i++) {
        if (info.get(left[i].id).aKey !== lastKey || !lastKey) {
          at = i;
          break;
        }
      }
      const pick = left.splice(at, 1)[0];
      out.push(pick);
      lastKey = info.get(pick.id).aKey;
    }
    return out;
  };

  const featuring = (items) => {
    const count = new Map();
    for (const sg of items) {
      const k = info.get(sg.id).aKey;
      if (k) count.set(k, (count.get(k) || 0) + 1);
    }
    const top = Array.from(count.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map((x) => artistNames.get(x[0]))
      .filter(Boolean);
    return top.length > 0 ? 'Featuring ' + top.join(', ') + ' and more' : '';
  };

  const cands = [];
  const push = (kind, key, title, sub, items, base, keepOrder) => {
    if (!items || items.length < (kind === 'repeat' || kind === 'fresh' ? 6 : 8)) return;
    cands.push({
      id: kind + ':' + key,
      kind: kind,
      title: title,
      sub: sub,
      songs: keepOrder ? items : spread(items),
      base: base,
    });
  };

  // ----- A) right now (time of day) -----
  {
    const withSlot = list.filter((sg) => taste[sg.id] && taste[sg.id].sl && taste[sg.id].sl[slot] > 0);
    let items;
    if (withSlot.length >= 8) {
      items = rank(list, (sg) => (taste[sg.id] && taste[sg.id].sl ? taste[sg.id].sl[slot] : 0) * 1.0 + tasteOf.get(sg.id) * 0.8 + 0.01, 'now', 0.4).slice(0, 30);
    } else {
      const want = SLOT_TAGS[slot];
      const match = list.filter((sg) => want.some((tg) => info.get(sg.id).tags.has(tg)));
      items = rank(match, (sg) => tasteOf.get(sg.id) + 0.05, 'now', 0.5).slice(0, 30);
    }
    push('now', 'slot' + slot, pickName(SLOT_NAMES[slot], seed + 'nowname'), 'Picked for ' + SLOT_WORDS[slot], items, 3);
  }

  // ----- B) daily mix, across everything you like -----
  {
    const items = rank(list, (sg) => tasteOf.get(sg.id) + 0.05, 'daily', 0.7).slice(0, 40);
    push('daily', 'mix', pickName(['Made For You', 'Your Daily Mix', "Today's Picks"], seed + 'dailyname'), featuring(items), items, 1.7);
  }

  // ----- C) one playlist per tag you lean towards -----
  {
    const tags = Array.from(profile.entries())
      .filter((x) => x[0].indexOf('d:') !== 0 && (tagCount.get(x[0]) || 0) >= 10)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    for (const pair of tags) {
      const tg = pair[0];
      const match = list.filter((sg) => (info.get(sg.id).tags.get(tg) || 0) >= 0.3);
      const items = rank(match, (sg) => tasteOf.get(sg.id) * 0.7 + (info.get(sg.id).tags.get(tg) || 0) * 0.5 + 0.02, 'tag' + tg, 0.5).slice(0, 40);
      const names = TAG_NAMES[tg];
      const title = names ? pickName(names, seed + 'n' + tg) : pickName([cap(tg) + ' Mix', cap(tg) + ' Essentials', 'Your ' + cap(tg)], seed + 'n' + tg);
      push('tag', tg, title, featuring(items), items, 1.0 + pair[1] * 0.8);
    }
  }

  // ----- D) artist mixes -----
  {
    const arts = [];
    artistSongs.forEach((ss, key) => {
      if (ss.length < 3) return;
      let a = 0;
      for (const sg of ss) a += Math.max(0, aff.get(sg.id));
      arts.push({ key: key, score: a + 0.4 * Math.log(1 + ss.length), ss: ss });
    });
    arts.sort((a, b) => b.score - a.score);
    const maxS = arts.length > 0 ? arts[0].score || 1 : 1;
    for (const ar of arts.slice(0, 5)) {
      const name = artistNames.get(ar.key);
      const own = rank(ar.ss, (sg) => tasteOf.get(sg.id) + 0.3 + Math.max(0, aff.get(sg.id)) * 0.2, 'art' + ar.key, 0.3).slice(0, 25);
      // similar songs: same top tag, other artists
      const tagOfArtist = Array.from(info.get(ar.ss[0].id).tags.entries())
        .filter((x) => x[0].indexOf('d:') !== 0)
        .sort((a, b) => b[1] - a[1])[0];
      let items = own;
      if (tagOfArtist && own.length < 30) {
        const sim = list.filter((sg) => info.get(sg.id).aKey !== ar.key && (info.get(sg.id).tags.get(tagOfArtist[0]) || 0) >= 0.5);
        const extra = rank(sim, (sg) => tasteOf.get(sg.id) + 0.05, 'sim' + ar.key, 0.5).slice(0, 30 - own.length);
        // blend: own songs first, similar ones sprinkled in
        items = [];
        let j = 0;
        own.forEach((sg, i) => {
          items.push(sg);
          if (i % 2 === 1 && j < extra.length) items.push(extra[j++]);
        });
        while (j < extra.length) items.push(extra[j++]);
      }
      const title = pickName([name + ' Mix', 'Best of ' + name, 'All ' + name], seed + 'an' + ar.key);
      push('artist', ar.key, title, 'Because you love ' + name, items, 1.0 + (ar.score / maxS) * 0.7);
    }
  }

  // ----- E) decades -----
  {
    const decs = Array.from(tagCount.entries())
      .filter((x) => x[0].indexOf('d:') === 0 && x[1] >= 15)
      .map((x) => [parseInt(x[0].slice(2), 10), profile.get(x[0]) || 0])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    for (const d of decs) {
      const match = list.filter((sg) => info.get(sg.id).dec === d[0]);
      const items = rank(match, (sg) => tasteOf.get(sg.id) + 0.05, 'dec' + d[0], 0.5).slice(0, 40);
      push('decade', String(d[0]), decadeName(d[0], seed + 'dn' + d[0]), featuring(items), items, 0.8 + d[1] * 0.5);
    }
  }

  // ----- F) rediscover (not heard for a long time) -----
  {
    const old = list.filter((sg) => {
      const e = taste[sg.id];
      const added = addedMs(sg);
      const longAgo = !e || !e.last || now - e.last > 90 * DAY;
      return longAgo && (!added || now - added > 45 * DAY) && (!e || e.sk <= e.n);
    });
    const items = rank(old, (sg) => tasteOf.get(sg.id) + 0.05, 'redis', 0.6).slice(0, 30);
    push('rediscover', 'old', pickName(['Rediscover', 'Dust Off These', 'Forgotten Gems'], seed + 'rn'), "Songs you haven't played in a while that fit you", items, hasSignal ? 1.25 : 0.7);
  }

  // ----- G) old favorites -----
  {
    const olds = list.filter((sg) => aff.get(sg.id) >= 1 && !(taste[sg.id] && taste[sg.id].last > now - 21 * DAY));
    const items = rank(olds, (sg) => aff.get(sg.id) + 0.1, 'oldfav', 0.5).slice(0, 30);
    push('oldfav', 'fav', pickName(['Old Favourites', 'Back in Rotation', 'Take Me Back'], seed + 'on'), 'The ones you loved, waiting for you', items, 1.3);
  }

  // ----- H) on repeat (last 2 weeks) -----
  {
    const rep = list
      .filter((sg) => taste[sg.id] && taste[sg.id].n >= 2 && taste[sg.id].last > now - 14 * DAY)
      .sort((a, b) => taste[b.id].n - taste[a.id].n)
      .slice(0, 30);
    push('repeat', 'recent', 'On Repeat', 'What you keep coming back to', rep, 1.8, false);
  }

  // ----- I) fresh additions -----
  {
    const fresh = list
      .filter((sg) => addedMs(sg) > now - 45 * DAY)
      .sort((a, b) => addedMs(b) - addedMs(a))
      .slice(0, 40);
    push('fresh', 'new', pickName(['Fresh Additions', 'New in Your Library'], seed + 'fn'), 'Recently added to your phone', fresh, 1.1, true);
  }

  // ---------- choose what to show ----------
  const shown = meta.shown || {};
  for (const c of cands) {
    const times = (shown[c.id] || []).filter((x) => x > now - 3 * DAY).length;
    c.score = c.base * (0.88 + 0.24 * rand01(seed + c.id)) - times * 0.12;
  }
  cands.sort((a, b) => b.score - a.score);

  const chosen = [];
  const caps = { tag: 4, artist: 3, decade: 1 }; // keeps one kind from filling the whole page
  const used = {};
  for (const c of cands) {
    if (chosen.length >= 10) break;
    if (caps[c.kind] !== undefined && (used[c.kind] || 0) >= caps[c.kind]) continue;
    const set = new Set(c.songs.map((x) => x.id));
    let bad = false;
    for (const o of chosen) {
      let same = 0;
      for (const sg of o.songs) if (set.has(sg.id)) same++;
      if (same / Math.min(set.size, o.songs.length) > 0.6) {
        bad = true;
        break;
      }
    }
    if (!bad) {
      chosen.push(c);
      used[c.kind] = (used[c.kind] || 0) + 1;
    }
  }
  // "right now" always first, the rest by score
  chosen.sort((a, b) => (a.kind === 'now' ? -1 : 0) - (b.kind === 'now' ? -1 : 0));

  return chosen.map((c) => ({
    key: 'mix:' + c.id,
    mixId: c.id,
    kind: c.kind,
    title: c.title,
    sub: c.sub,
    songs: c.songs,
    unknown: false,
    isMix: true,
  }));
}
