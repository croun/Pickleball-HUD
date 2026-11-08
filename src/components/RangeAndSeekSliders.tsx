import React, { useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
} from 'react-native';

export interface SeekSliderProps {
  value: number;
  min: number;
  max: number;
  accentColor?: string;
  onChange: (value: number) => void;
}

export const SeekSlider: React.FC<SeekSliderProps> = ({
  value,
  min,
  max,
  accentColor = '#00E5FF',
  onChange,
}: SeekSliderProps) => {
  const [width, setWidth] = useState(1);
  const widthRef = useRef(1);

  const span = Math.max(0.001, max - min);
  const frac = Math.max(0, Math.min(1, (value - min) / span));

  const updateFromX = (x: number) => {
    const f = Math.max(0, Math.min(1, x / Math.max(1, widthRef.current)));
    onChange(min + f * span);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt: GestureResponderEvent) =>
          updateFromX(evt.nativeEvent.locationX),
        onPanResponderMove: (evt: GestureResponderEvent) =>
          updateFromX(evt.nativeEvent.locationX),
      }),
    [min, max]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) {
      widthRef.current = w;
      setWidth(w);
    }
  };

  return (
    <View style={styles.trackContainer} onLayout={onLayout} {...panResponder.panHandlers}>
      <View style={styles.trackBg} />
      <View
        style={[
          styles.trackFill,
          { width: `${frac * 100}%`, backgroundColor: accentColor },
        ]}
      />
      <View
        style={[
          styles.thumb,
          {
            left: Math.max(0, Math.min(width - 18, frac * width - 9)),
            backgroundColor: accentColor,
          },
        ]}
      />
    </View>
  );
};

export interface TrimRangeSliderProps {
  start: number;
  end: number;
  min: number;
  max: number;
  onChange: (start: number, end: number) => void;
}

export const TrimRangeSlider: React.FC<TrimRangeSliderProps> = ({
  start,
  end,
  min,
  max,
  onChange,
}: TrimRangeSliderProps) => {
  const [width, setWidth] = useState(1);
  const widthRef = useRef(1);
  const activeThumbRef = useRef<'start' | 'end'>('end');

  const span = Math.max(0.001, max - min);
  const startFrac = Math.max(0, Math.min(1, (start - min) / span));
  const endFrac = Math.max(0, Math.min(1, (end - min) / span));

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt: GestureResponderEvent) => {
          const x = evt.nativeEvent.locationX;
          const f = Math.max(0, Math.min(1, x / Math.max(1, widthRef.current)));
          const val = min + f * span;
          if (Math.abs(val - start) <= Math.abs(val - end)) {
            activeThumbRef.current = 'start';
            onChange(Math.min(val, end - 1), end);
          } else {
            activeThumbRef.current = 'end';
            onChange(start, Math.max(val, start + 1));
          }
        },
        onPanResponderMove: (evt: GestureResponderEvent) => {
          const x = evt.nativeEvent.locationX;
          const f = Math.max(0, Math.min(1, x / Math.max(1, widthRef.current)));
          const val = min + f * span;
          if (activeThumbRef.current === 'start') {
            onChange(Math.max(min, Math.min(val, end - 1)), end);
          } else {
            onChange(start, Math.min(max, Math.max(val, start + 1)));
          }
        },
      }),
    [min, max, start, end, onChange]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) {
      widthRef.current = w;
      setWidth(w);
    }
  };

  return (
    <View style={styles.trackContainer} onLayout={onLayout} {...panResponder.panHandlers}>
      <View style={styles.trackBg} />
      <View
        style={[
          styles.trackFill,
          {
            left: `${startFrac * 100}%`,
            width: `${Math.max(0, (endFrac - startFrac) * 100)}%`,
            backgroundColor: '#00E5FF',
          },
        ]}
      />
      <View
        style={[
          styles.thumb,
          {
            left: Math.max(0, Math.min(width - 18, startFrac * width - 9)),
            backgroundColor: '#00E5FF',
          },
        ]}
      />
      <View
        style={[
          styles.thumb,
          {
            left: Math.max(0, Math.min(width - 18, endFrac * width - 9)),
            backgroundColor: '#B6FF2E',
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  trackContainer: {
    height: 30,
    justifyContent: 'center',
    position: 'relative',
  },
  trackBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.16)',
    width: '100%',
  },
  trackFill: {
    position: 'absolute',
    height: 6,
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#070F1E',
  },
});

