// The audio engine. It uses react-native-track-player, which runs a real Android media session
// (a foreground service + a media notification with previous / play / pause / next / seek).
// That is the same thing the built-in phone music app uses, and it is what OriginOS turns into the real dynamic island.
import { useState } from 'react';
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
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    if (remote.next) remote.next();
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    if (remote.prev) remote.prev();
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => TrackPlayer.seekTo(e.position));
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
    });
    if (my !== loadId) return;
    try {
      await TrackPlayer.setVolume(volume === undefined ? 1 : volume);
    } catch (e) {}
    await TrackPlayer.play();
  },
  // Put the cover on the notification / island
  async setArtwork(uri, meta) {
    try {
      await TrackPlayer.updateMetadataForTrack(0, {
        title: meta.title,
        artist: meta.artist,
        album: meta.album || undefined,
        artwork: uri,
      });
    } catch (e) {}
  },
  play() {
    TrackPlayer.play().catch(() => {});
  },
  pause() {
    TrackPlayer.pause().catch(() => {});
  },
  seekTo(sec) {
    TrackPlayer.seekTo(sec).catch(() => {});
  },
  setVolume(v) {
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

  return {
    playing: st === State.Playing || st === State.Buffering || st === State.Loading,
    currentTime: progress.position || 0,
    duration: progress.duration || 0,
    finishCount,
  };
}
