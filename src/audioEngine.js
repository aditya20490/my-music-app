// The audio engine. It uses react-native-track-player, which runs a real Android media session
// (a foreground service + a media notification with previous / play / pause / next / seek).
// That is the same thing the built-in phone music app uses, and it is what OriginOS turns into the real dynamic island.
import { useState, useEffect, useRef } from 'react';
import { NativeModules } from 'react-native';
import TrackPlayer, {
  Capability,
  AppKilledPlaybackBehavior,
  Event,
  State,
  useProgress,
  usePlaybackState,
  useTrackPlayerEvents,
} from 'react-native-track-player';

// App.js fills these in, so the buttons on the notification / island can skip songs
const remote = { next: null, prev: null };
export function setRemoteHandlers(h) {
  remote.next = h && h.next ? h.next : null;
  remote.prev = h && h.prev ? h.prev : null;
}

// Runs in the background service: handles the buttons on the notification and the island
export async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => player.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => player.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => player.pause());
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    if (remote.next) remote.next();
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    if (remote.prev) remote.prev();
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => player.seekTo(e.position));
}

let setupPromise = null;
export function setupAudio() {
  if (!setupPromise) {
    setupPromise = (async () => {
      try {
        await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
      } catch (e) {
        // already set up
      }
      const caps = [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ];
      await TrackPlayer.updateOptions({
        android: { appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback },
        capabilities: caps,
        notificationCapabilities: caps,
        progressUpdateEventInterval: 1,
      });
    })().catch((e) => {
      setupPromise = null;
    });
  }
  return setupPromise;
}

// ---------- 8D audio ----------
// The normal player keeps running (muted while 8D is on) as the clock and the notification.
// The native EightD module plays the same file with the 8D effect and follows the normal player.
const Native = NativeModules ? NativeModules.EightD : null;
export const eightDSupported = !!Native;
const eight = { on: false, song: null, volume: 1, playing: true };

async function eightStart(positionSec) {
  if (!Native || !eight.on || !eight.song) return;
  try {
    await Native.start(eight.song.uri, Math.max(0, positionSec) * 1000, eight.volume, eight.playing);
  } catch (e) {
    eight.on = false;
    try {
      await TrackPlayer.setVolume(eight.volume);
    } catch (e2) {}
  }
}

let loadId = 0;

export const player = {
  // Start a song. meta = { title, artist, album }
  async load(song, meta, volume) {
    const my = ++loadId;
    await setupAudio();
    if (my !== loadId) return;
    await TrackPlayer.reset();
    if (my !== loadId) return;
    await TrackPlayer.add({
      id: String(song.id),
      url: song.uri,
      title: meta.title,
      artist: meta.artist,
      album: meta.album || undefined,
      // duration lets the phone's island / notification show a real progress bar
      duration: song.duration > 0 ? song.duration : undefined,
    });
    if (my !== loadId) return;
    eight.volume = volume === undefined ? 1 : volume;
    eight.song = song;
    eight.playing = true;
    try {
      await TrackPlayer.setVolume(eight.on ? 0 : eight.volume);
    } catch (e) {}
    await TrackPlayer.play();
    if (eight.on) await eightStart(0);
  },
  // Turn 8D on / off. Returns true if it is on afterwards.
  async setEightD(on) {
    if (!Native) return false;
    if (on) {
      if (!eight.song) return false;
      let pos = 0;
      try {
        pos = (await TrackPlayer.getProgress()).position || 0;
      } catch (e) {}
      try {
        const st = await TrackPlayer.getPlaybackState();
        const s = st && st.state !== undefined ? st.state : st;
        eight.playing = s === State.Playing || s === State.Buffering || s === State.Loading;
      } catch (e) {}
      eight.on = true;
      try {
        await TrackPlayer.setVolume(0);
      } catch (e) {}
      await eightStart(pos);
      return eight.on;
    }
    eight.on = false;
    try {
      Native.stop();
    } catch (e) {}
    try {
      await TrackPlayer.setVolume(eight.volume);
    } catch (e) {}
    return false;
  },
  isEightD() {
    return eight.on;
  },
  // Put the cover on the notification / island
  async setArtwork(uri, meta) {
    try {
      await TrackPlayer.updateMetadataForTrack(0, {
        title: meta.title,
        artist: meta.artist,
        album: meta.album || undefined,
        artwork: uri,
        duration: meta.duration > 0 ? meta.duration : undefined,
      });
    } catch (e) {}
  },
  play() {
    eight.playing = true;
    if (eight.on && Native) Native.setPlaying(true);
    TrackPlayer.play().catch(() => {});
  },
  pause() {
    eight.playing = false;
    if (eight.on && Native) Native.setPlaying(false);
    TrackPlayer.pause().catch(() => {});
  },
  seekTo(sec) {
    if (eight.on && Native) Native.seekTo(Math.max(0, sec) * 1000);
    TrackPlayer.seekTo(sec).catch(() => {});
  },
  setVolume(v) {
    eight.volume = v;
    if (eight.on && Native) {
      Native.setVolume(v);
      return;
    }
    TrackPlayer.setVolume(v).catch(() => {});
  },
};

// Same shape the app used before: playing, currentTime, duration, plus a counter that goes up when a song ends
export function usePlayerStatus() {
  const ps = usePlaybackState();
  const st = ps && ps.state !== undefined ? ps.state : ps;
  const progress = useProgress(500);
  const [finishCount, setFinishCount] = useState(0);

  useTrackPlayerEvents([Event.PlaybackQueueEnded], () => {
    setFinishCount((n) => n + 1);
  });

  const playingNow = st === State.Playing || st === State.Buffering || st === State.Loading;
  const posRef = useRef(0);
  posRef.current = progress.position || 0;

  // keep the 8D player in step with the main player (system pause / audio focus, small drifts)
  useEffect(() => {
    if (!eight.on || !Native) return;
    eight.playing = playingNow;
    Native.setPlaying(playingNow);
  }, [playingNow]);
  useEffect(() => {
    const id = setInterval(async () => {
      if (!eight.on || !Native) return;
      try {
        const np = await Native.getPosition();
        if (np < 0) return;
        const diff = Math.abs(np / 1000 - posRef.current);
        if (diff > 0.6) Native.seekTo(posRef.current * 1000);
      } catch (e) {}
    }, 2000);
    return () => clearInterval(id);
  }, []);

  return {
    playing: st === State.Playing || st === State.Buffering || st === State.Loading,
    currentTime: progress.position || 0,
    duration: progress.duration || 0,
    finishCount,
  };
}
