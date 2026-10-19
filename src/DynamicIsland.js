// The "dynamic island": a little black pill at the top of the screen that shows the song playing.
// Tap it = it grows (cover, name, seek bar, buttons). Tap again, or swipe up = it shrinks.
// Collapsed: swipe left = next song, swipe right = previous song, swipe down = grow.
// When the song changes, it grows by itself for a moment, then shrinks again.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  PanResponder,
  Easing,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme';
import { Art } from './ui';
import { formatTime } from './utils';

const COLLAPSED_W = 150;
const COLLAPSED_H = 36;

// Four little bars that dance while the song plays
function EqBars({ playing, color, height }) {
  const vals = useRef([0, 1, 2, 3].map(() => new Animated.Value(0.25))).current;

  useEffect(() => {
    const loops = [];
    if (playing) {
      vals.forEach((v, i) => {
        const dur = 240 + i * 85;
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            Animated.timing(v, { toValue: 0.25, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          ])
        );
        loops.push(loop);
        loop.start();
      });
    } else {
      vals.forEach((v) => {
        Animated.timing(v, { toValue: 0.25, duration: 220, useNativeDriver: true }).start();
      });
    }
    return () => loops.forEach((l) => l.stop());
  }, [playing]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: height }}>
      {vals.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: 3,
            height: height,
            borderRadius: 2,
            marginLeft: i === 0 ? 0 : 3,
            backgroundColor: color,
            transform: [{ scaleY: v }],
          }}
        />
      ))}
    </View>
  );
}

// Thin seek bar for the big (open) island
function IslandSeek({ progress, onSeek, onTouch, color }) {
  const wRef = useRef(1);
  const [drag, setDrag] = useState(null);
  const frac = (e) => Math.max(0, Math.min(1, e.nativeEvent.locationX / wRef.current));
  const shown = drag !== null ? drag : progress;

  return (
    <View
      style={{ flex: 1, height: 28, justifyContent: 'center' }}
      onLayout={(e) => {
        wRef.current = e.nativeEvent.layout.width || 1;
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        if (onTouch) onTouch();
        setDrag(frac(e));
      }}
      onResponderMove={(e) => setDrag(frac(e))}
      onResponderRelease={(e) => {
        onSeek(frac(e));
        setDrag(null);
      }}
      onResponderTerminate={() => setDrag(null)}
    >
      <View pointerEvents="none" style={{ height: 28, justifyContent: 'center' }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' }}>
          <View style={{ height: 4, width: shown * 100 + '%', backgroundColor: color }} />
        </View>
        <View
          style={{
            position: 'absolute',
            left: shown * 100 + '%',
            width: 10,
            height: 10,
            marginLeft: -5,
            borderRadius: 5,
            backgroundColor: '#FFFFFF',
          }}
        />
      </View>
    </View>
  );
}

export default function DynamicIsland({
  song,
  playing,
  progress,
  currentTime,
  duration,
  hidden,
  onOpen,
  onPrev,
  onSwipePrev,
  onToggle,
  onNext,
  onSeek,
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [open, setOpen] = useState(false);
  const p = useRef(new Animated.Value(0)).current; // 0 = small pill, 1 = open (JS driven: width / height)
  const shift = useRef(new Animated.Value(0)).current; // little sideways nudge while you swipe (native driven)
  const openRef = useRef(false);
  const timer = useRef(null);
  const lastId = useRef(null);
  const act = useRef({});
  act.current = { prev: onSwipePrev || onPrev, onNext, onOpen };

  const top = Math.max(6, Math.round((insets.top - COLLAPSED_H) / 2));
  const contentTop = Math.max(14, insets.top - top + 2); // open content starts below the status bar / camera
  const expW = Math.max(COLLAPSED_W, width - 24);
  const expH = contentTop + 158;

  const setExpanded = (v, autoMs) => {
    openRef.current = v;
    setOpen(v);
    if (timer.current) clearTimeout(timer.current);
    Animated.spring(p, { toValue: v ? 1 : 0, friction: 9, tension: 70, useNativeDriver: false }).start();
    if (v && autoMs) {
      timer.current = setTimeout(() => setExpanded(false), autoMs);
    }
  };
  const expandRef = useRef(setExpanded);
  expandRef.current = setExpanded;

  // Any touch inside the open island keeps it open a bit longer
  const bump = () => {
    if (openRef.current) expandRef.current(true, 5000);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (e, g) => Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (e, g) => {
        if (!openRef.current) shift.setValue(Math.max(-36, Math.min(36, g.dx * 0.4)));
      },
      onPanResponderRelease: (e, g) => {
        Animated.spring(shift, { toValue: 0, useNativeDriver: true }).start();
        const adx = Math.abs(g.dx);
        const ady = Math.abs(g.dy);
        if (adx < 8 && ady < 8) {
          expandRef.current(!openRef.current, 5000);
          return;
        }
        if (openRef.current) {
          if (g.dy < -18 && ady > adx) expandRef.current(false);
          return;
        }
        if (adx > ady) {
          if (g.dx < -30 && act.current.onNext) act.current.onNext();
          else if (g.dx > 30 && act.current.prev) act.current.prev();
        } else if (g.dy > 18) {
          expandRef.current(true, 5000);
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(shift, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  // When the song changes, grow for a moment so you see what is playing now
  const songId = song ? song.id : null;
  useEffect(() => {
    if (songId === null) return;
    if (lastId.current !== null && lastId.current !== songId && !hidden) {
      expandRef.current(true, 3200);
    }
    lastId.current = songId;
  }, [songId]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  if (!song || hidden) return null;

  const pillW = p.interpolate({ inputRange: [0, 1], outputRange: [COLLAPSED_W, expW] });
  const pillH = p.interpolate({ inputRange: [0, 1], outputRange: [COLLAPSED_H, expH] });
  const pillR = p.interpolate({ inputRange: [0, 1], outputRange: [COLLAPSED_H / 2, 32] });
  const smallOpacity = p.interpolate({ inputRange: [0, 0.35], outputRange: [1, 0], extrapolate: 'clamp' });
  const bigOpacity = p.interpolate({ inputRange: [0.55, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const total = duration > 0 ? duration : 0;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', zIndex: 40, elevation: 40 }}
    >
      <Animated.View style={{ marginTop: top, transform: [{ translateX: shift }] }} {...pan.panHandlers}>
        <Animated.View
          style={{
            width: pillW,
            height: pillH,
            borderRadius: pillR,
            backgroundColor: '#000000',
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.08)',
            elevation: 14,
          }}
        >
          {/* Small pill: cover on the left, dancing bars on the right (the camera sits in the middle gap) */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: COLLAPSED_W,
              height: COLLAPSED_H,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 6,
              opacity: smallOpacity,
            }}
          >
            <Art song={song} size={24} radius={12} />
            <EqBars playing={playing} color={t.accent} height={14} />
          </Animated.View>

          {/* Open island */}
          <Animated.View
            pointerEvents={open ? 'auto' : 'none'}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: expW,
              height: expH,
              paddingTop: contentTop,
              paddingHorizontal: 16,
              opacity: bigOpacity,
            }}
          >
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => {
                setExpanded(false);
                if (act.current.onOpen) act.current.onOpen();
              }}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Art song={song} size={52} radius={12} />
              <View style={{ flex: 1, marginLeft: 12, marginRight: 10 }}>
                <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '800' }} numberOfLines={1}>
                  {song.title}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {(song.artist || 'Unknown artist') + (song.album ? '  •  ' + song.album : '')}
                </Text>
              </View>
              <EqBars playing={playing} color={t.accent} height={18} />
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11, width: 36 }}>{formatTime(currentTime)}</Text>
              <IslandSeek
                progress={progress}
                color={t.accent}
                onTouch={bump}
                onSeek={(f) => {
                  if (total > 0 && onSeek) onSeek(f * total);
                  bump();
                }}
              />
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11, width: 36, textAlign: 'right' }}>
                {formatTime(total)}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
              <TouchableOpacity
                onPress={() => {
                  bump();
                  if (onPrev) onPrev();
                }}
                style={{ width: 52, height: 46, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="play-skip-back" size={26} color="#FFFFFF" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  bump();
                  if (onToggle) onToggle();
                }}
                activeOpacity={0.8}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 23,
                  marginHorizontal: 22,
                  backgroundColor: '#FFFFFF',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name={playing ? 'pause' : 'play'}
                  size={24}
                  color="#000000"
                  style={playing ? null : { marginLeft: 3 }}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  bump();
                  if (onNext) onNext();
                }}
                style={{ width: 52, height: 46, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="play-skip-forward" size={26} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
