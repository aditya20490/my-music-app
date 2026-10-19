// The slide bar on the right edge. It shows up while you scroll, hides after a moment,
// and you can drag it to jump far through a long list.
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Animated, PanResponder } from 'react-native';
import { useTheme } from './theme';

const THUMB_H = 60;
const STRIP_W = 34;

const FastScroll = forwardRef(function FastScroll({ top, bottom, onJump }, ref) {
  const { t } = useTheme();
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const trackH = useRef(0);
  const info = useRef({ content: 0, view: 0 });
  const dragging = useRef(false);
  const hideTimer = useRef(null);
  const startLocal = useRef(0);
  const opacity = useRef(new Animated.Value(0)).current;
  const thumbY = useRef(new Animated.Value(0)).current;
  const jumpRef = useRef(onJump);
  jumpRef.current = onJump;

  const room = () => Math.max(1, trackH.current - THUMB_H);

  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      if (dragging.current) {
        scheduleHide();
        return;
      }
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(({ finished }) => {
        if (finished && !dragging.current) {
          activeRef.current = false;
          setActive(false);
        }
      });
    }, 1500);
  };

  const show = () => {
    if (!activeRef.current) {
      activeRef.current = true;
      setActive(true);
    }
    Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
    scheduleHide();
  };

  useImperativeHandle(ref, () => ({
    update(y, content, view) {
      info.current = { content, view };
      if (content < view * 3) return; // short list, no bar needed
      if (dragging.current) return;
      const max = content - view;
      const frac = max > 0 ? Math.max(0, Math.min(1, y / max)) : 0;
      thumbY.setValue(frac * room());
      show();
    },
  }));

  const jumpTo = (local) => {
    const frac = Math.max(0, Math.min(1, (local - THUMB_H / 2) / room()));
    thumbY.setValue(frac * room());
    const max = Math.max(0, info.current.content - info.current.view);
    jumpRef.current(frac * max);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        dragging.current = true;
        startLocal.current = e.nativeEvent.locationY;
        jumpTo(startLocal.current);
      },
      onPanResponderMove: (e, g) => {
        jumpTo(startLocal.current + g.dy);
      },
      onPanResponderRelease: () => {
        dragging.current = false;
        scheduleHide();
      },
      onPanResponderTerminate: () => {
        dragging.current = false;
        scheduleHide();
      },
    })
  ).current;

  return (
    <Animated.View
      pointerEvents={active ? 'auto' : 'none'}
      style={{ position: 'absolute', right: 0, top: top, bottom: bottom, width: STRIP_W, opacity: opacity }}
      onLayout={(e) => {
        trackH.current = e.nativeEvent.layout.height;
      }}
      {...pan.panHandlers}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          right: 3,
          width: 8,
          height: THUMB_H,
          borderRadius: 4,
          backgroundColor: t.accent,
          transform: [{ translateY: thumbY }],
        }}
      />
    </Animated.View>
  );
});

export default FastScroll;
