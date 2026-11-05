// The look of the For You page: playlist tiles with a cover collage, and the top block with the learning status.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { Art } from '../ui';
import { gradientFor } from '../utils';

const KIND_ICON = {
  now: 'time',
  daily: 'sparkles',
  tag: 'pulse',
  artist: 'person',
  decade: 'calendar',
  rediscover: 'compass',
  oldfav: 'heart',
  repeat: 'repeat',
  fresh: 'flash',
};

function Cover({ mix, size }) {
  // 4 different covers as a collage when we can, else one big cover
  const seen = new Set();
  const picks = [];
  for (const sg of mix.songs) {
    const k = (sg.album || '') + '|' + (sg.artist || '') + (sg.album ? '' : sg.id);
    if (seen.has(k)) continue;
    seen.add(k);
    picks.push(sg);
    if (picks.length === 4) break;
  }
  if (picks.length < 4) return <Art song={mix.songs[0]} size={size} radius={0} />;
  const h = Math.floor(size / 2);
  return (
    <View style={{ width: h * 2, height: h * 2, flexDirection: 'row', flexWrap: 'wrap' }}>
      {picks.map((sg) => (
        <Art key={sg.id} song={sg} size={h} radius={0} />
      ))}
    </View>
  );
}

export const MixTile = React.memo(function MixTile({ mix, size, onPress }) {
  const { t, s } = useTheme();
  const g = gradientFor(mix.title);
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={() => onPress(mix)} style={{ width: size }}>
      <View style={{ width: size, height: size, borderRadius: 16, overflow: 'hidden', backgroundColor: t.card }}>
        <Cover mix={mix} size={size} />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.55)']}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: size * 0.4 }}
        />
        <LinearGradient
          colors={g}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: 'absolute',
            left: 8,
            top: 8,
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={KIND_ICON[mix.kind] || 'musical-notes'} size={15} color="#fff" />
        </LinearGradient>
        <Text style={{ position: 'absolute', right: 8, bottom: 6, color: '#fff', fontSize: 11, fontWeight: '700' }}>
          {mix.songs.length} songs
        </Text>
      </View>
      <Text style={[s.groupTitle, { marginTop: 8 }]} numberOfLines={2}>
        {mix.title}
      </Text>
      <Text style={s.groupSub} numberOfLines={2}>
        {mix.sub}
      </Text>
    </TouchableOpacity>
  );
});

export function ForYouHeader({ status, count, onRefresh }) {
  const { t, s } = useTheme();
  let line = 'Playlists made from the way you listen. They change through the day.';
  if (status.running) line = 'Learning your artists online… ' + status.done + '/' + status.total;
  else if (status.offline) line = 'Offline right now. Playlists use what is on your phone and your listening.';
  return (
    <View style={{ marginTop: 12, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 20, fontWeight: '800' }}>Made for you</Text>
          <Text style={[s.noteText, { marginHorizontal: 0, marginTop: 3, marginBottom: 0 }]}>{line}</Text>
        </View>
        <TouchableOpacity style={s.headerBtn} onPress={onRefresh}>
          <Ionicons name="refresh" size={22} color={t.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
