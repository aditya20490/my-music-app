import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

// Temporary test track, just to check that audio works. We'll replace it later.
const TEST_TRACK = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';

function formatTime(seconds) {
  const total = Math.floor(seconds || 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

export default function App() {
  const player = useAudioPlayer(TEST_TRACK);
  const status = useAudioPlayerStatus(player);

  const toggle = () => {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  const progress = status.duration > 0 ? (status.currentTime / status.duration) * 100 : 0;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.appName}>My Music</Text>

      <View style={styles.cover}>
        <Text style={styles.coverEmoji}>🎵</Text>
      </View>

      <Text style={styles.title}>Test Track</Text>

      <View style={styles.barBackground}>
        <View style={[styles.barFill, { width: progress + '%' }]} />
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.time}>{formatTime(status.currentTime)}</Text>
        <Text style={styles.time}>{formatTime(status.duration)}</Text>
      </View>

      <TouchableOpacity style={styles.playButton} onPress={toggle}>
        <Text style={styles.playText}>{status.playing ? 'Pause' : 'Play'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  appName: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
    position: 'absolute',
    top: 60,
  },
  cover: {
    width: 240,
    height: 240,
    borderRadius: 20,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  coverEmoji: {
    fontSize: 80,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    marginBottom: 24,
  },
  barBackground: {
    width: '100%',
    height: 6,
    backgroundColor: '#333333',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    backgroundColor: '#1db954',
  },
  timeRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 32,
  },
  time: {
    color: '#aaaaaa',
    fontSize: 12,
  },
  playButton: {
    backgroundColor: '#1db954',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 30,
  },
  playText: {
    color: '#000000',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
