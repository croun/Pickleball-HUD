import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { PickleballCourt, PickleballCourtConstants } from '../cv/PickleballCourt';
import { Point2D } from '../model/PickleballConfig';
import { BuiltInPickleballDemoGenerator } from '../pipeline/VideoPipeline';

export interface InteractiveCourtCalibrationCanvasProps {
  frameW: number;
  frameH: number;
  corners: Point2D[];
  orientation: 'behind' | 'side';
  showKitchenZone: boolean;
  onCornersChange: (corners: Point2D[], finalizeOrder: boolean) => void;
}

const CORNER_LABELS = ['TL (Far-L)', 'TR (Far-R)', 'BR (Near-R)', 'BL (Near-L)'];

export const InteractiveCourtCalibrationCanvas: React.FC<
  InteractiveCourtCalibrationCanvasProps
> = ({
  frameW,
  frameH,
  corners,
  orientation,
  showKitchenZone,
  onCornersChange,
}: InteractiveCourtCalibrationCanvasProps) => {
  const [viewSize, setViewSize] = useState({ width: 1, height: 1 });
  const [localPts, setLocalPts] = useState<Point2D[]>(corners);
  const [dragIndex, setDragIndex] = useState<number>(-1);

  const localPtsRef = useRef<Point2D[]>(corners);
  const dragIndexRef = useRef<number>(-1);

  useEffect(() => {
    setLocalPts(corners);
    localPtsRef.current = corners;
  }, [corners]);

  const pad = 0.08 * Math.max(frameW, frameH);
  const totalW = frameW + pad * 2;
  const totalH = frameH + pad * 2;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt: GestureResponderEvent) => {
          const { locationX, locationY } = evt.nativeEvent;
          const scaleX = totalW / Math.max(1, viewSize.width);
          const scaleY = totalH / Math.max(1, viewSize.height);
          const imgX = locationX * scaleX - pad;
          const imgY = locationY * scaleY - pad;
          const hitRadius = 38 * scaleX;

          const cur = [...localPtsRef.current];
          let idx = cur.findIndex(
            (p: Point2D) => Math.hypot(p.x - imgX, p.y - imgY) < hitRadius
          );
          if (idx >= 0) {
            cur[idx] = { x: imgX, y: imgY };
          } else if (cur.length < 4) {
            cur.push({ x: imgX, y: imgY });
            idx = cur.length - 1;
          } else {
            let nearest = 0;
            let bestD = Number.POSITIVE_INFINITY;
            cur.forEach((p: Point2D, i: number) => {
              const d = Math.hypot(p.x - imgX, p.y - imgY);
              if (d < bestD) {
                bestD = d;
                nearest = i;
              }
            });
            cur[nearest] = { x: imgX, y: imgY };
            idx = nearest;
          }

          localPtsRef.current = cur;
          dragIndexRef.current = idx;
          setLocalPts(cur);
          setDragIndex(idx);
        },
        onPanResponderMove: (evt: GestureResponderEvent) => {
          const idx = dragIndexRef.current;
          if (idx < 0 || idx >= localPtsRef.current.length) return;
          const { locationX, locationY } = evt.nativeEvent;
          const scaleX = totalW / Math.max(1, viewSize.width);
          const scaleY = totalH / Math.max(1, viewSize.height);
          const imgX = locationX * scaleX - pad;
          const imgY = locationY * scaleY - pad;

          const next = [...localPtsRef.current];
          next[idx] = { x: imgX, y: imgY };
          localPtsRef.current = next;
          setLocalPts(next);
        },
        onPanResponderRelease: () => {
          dragIndexRef.current = -1;
          setDragIndex(-1);
          const finalPts = localPtsRef.current;
          onCornersChange(finalPts, finalPts.length === 4);
        },
        onPanResponderTerminate: () => {
          dragIndexRef.current = -1;
          setDragIndex(-1);
          const finalPts = localPtsRef.current;
          onCornersChange(finalPts, finalPts.length === 4);
        },
      }),
    [totalW, totalH, pad, viewSize.width, viewSize.height, onCornersChange]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setViewSize({ width, height });
    }
  };

  // Base court background preview
  const bgCourt = useMemo(
    () =>
      new PickleballCourt(
        BuiltInPickleballDemoGenerator.defaultCorners(frameW, frameH),
        'behind'
      ),
    [frameW, frameH]
  );
  const bgSvg = useMemo(() => bgCourt.buildSvgCourtElements(), [bgCourt]);

  // Calibrated court overlay from user's 4 corners
  const calibratedCourt = useMemo(() => {
    if (localPts.length !== 4) return null;
    try {
      return new PickleballCourt(localPts, orientation);
    } catch {
      return null;
    }
  }, [localPts, orientation]);

  const calSvg = useMemo(
    () => calibratedCourt?.buildSvgCourtElements() ?? null,
    [calibratedCourt]
  );

  const ordered = useMemo(
    () => (localPts.length === 4 ? PickleballCourt.orderCorners(localPts) : localPts),
    [localPts]
  );

  return (
    <View
      style={[styles.container, { aspectRatio: totalW / Math.max(1, totalH) }]}
      onLayout={onLayout}
      {...panResponder.panHandlers}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${totalW} ${totalH}`}>
        <Defs>
          <LinearGradient id="calArenaBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#0A1426" />
            <Stop offset="100%" stopColor="#12223A" />
          </LinearGradient>
        </Defs>

        <Rect x={0} y={0} width={totalW} height={totalH} fill="#060E1B" />

        <G transform={`translate(${pad}, ${pad})`}>
          {/* Video Frame Surface */}
          <Rect x={0} y={0} width={frameW} height={frameH} fill="url(#calArenaBg)" />
          <Polygon points={bgSvg.outerPolygonPoints} fill="#186291" />
          <Polygon
            points={bgSvg.kitchenPolygonPoints}
            fill="rgba(0, 180, 155, 0.45)"
          />
          {bgSvg.linePaths.map((lp: { d: string; isKitchen: boolean }, idx: number) => (
            <Path
              key={`bg-line-${idx}`}
              d={lp.d}
              stroke="rgba(255,255,255,0.45)"
              strokeWidth={2.5}
              fill="none"
            />
          ))}

          {/* Calibrated 20x44 ft Pickleball Court + 7-ft Kitchen NVZ Overlay */}
          {calSvg && (
            <G>
              {showKitchenZone && (
                <Polygon
                  points={calSvg.kitchenPolygonPoints}
                  fill="rgba(0, 229, 255, 0.30)"
                />
              )}
              {calSvg.linePaths.map((lp: { d: string; isKitchen: boolean }, idx: number) => (
                <Path
                  key={`cal-line-${idx}`}
                  d={lp.d}
                  stroke={lp.isKitchen ? '#00E5FF' : '#39FF88'}
                  strokeWidth={lp.isKitchen ? 4 : 3.2}
                  fill="none"
                />
              ))}
              {calibratedCourt &&
                (() => {
                  const netL = calibratedCourt.toImg(
                    0,
                    PickleballCourtConstants.NET_Y
                  );
                  const netR = calibratedCourt.toImg(
                    PickleballCourtConstants.COURT_W,
                    PickleballCourtConstants.NET_Y
                  );
                  return (
                    <Line
                      x1={netL.x}
                      y1={netL.y}
                      x2={netR.x}
                      y2={netR.y}
                      stroke="#B6FF2E"
                      strokeWidth={3.5}
                      strokeDasharray="8,6"
                    />
                  );
                })()}
            </G>
          )}

          {/* 4 Draggable Corner Handles */}
          {localPts.map((pt: Point2D, idx: number) => {
            const isDragged = idx === dragIndex;
            const ordIdx = ordered.findIndex(
              (o: Point2D) => Math.abs(o.x - pt.x) < 1e-3 && Math.abs(o.y - pt.y) < 1e-3
            );
            const label =
              ordered.length === 4 && ordIdx >= 0 && ordIdx < 4
                ? CORNER_LABELS[ordIdx]
                : `#${idx + 1}`;
            return (
              <G key={`corner-${idx}`}>
                <Circle
                  cx={pt.x}
                  cy={pt.y}
                  r={18}
                  fill={
                    isDragged
                      ? 'rgba(255, 196, 0, 0.28)'
                      : 'rgba(0, 229, 255, 0.22)'
                  }
                />
                <Circle
                  cx={pt.x}
                  cy={pt.y}
                  r={12}
                  fill={isDragged ? '#FFC400' : '#00E5FF'}
                  stroke="#04121F"
                  strokeWidth={3.5}
                />
                <SvgText
                  x={pt.x + 16}
                  y={pt.y - 12}
                  fill="#FFFFFF"
                  fontSize={22}
                  fontWeight="bold"
                >
                  {label}
                </SvgText>
              </G>
            );
          })}

          {/* 3x Magnifier Loupe when dragging a corner */}
          {dragIndex >= 0 &&
            dragIndex < localPts.length &&
            (() => {
              const dragPt = localPts[dragIndex];
              const d = 170;
              const lx = dragPt.x < frameW / 2 ? frameW - d - 16 : 16;
              const ly = 16;
              return (
                <G>
                  <Rect
                    x={lx}
                    y={ly}
                    width={d}
                    height={d}
                    rx={14}
                    fill="#0B1220"
                    stroke="#00E5FF"
                    strokeWidth={3}
                  />
                  <Line
                    x1={lx}
                    y1={ly + d / 2}
                    x2={lx + d}
                    y2={ly + d / 2}
                    stroke="#FFC400"
                    strokeWidth={2}
                  />
                  <Line
                    x1={lx + d / 2}
                    y1={ly}
                    x2={lx + d / 2}
                    y2={ly + d}
                    stroke="#FFC400"
                    strokeWidth={2}
                  />
                  <SvgText
                    x={lx + d / 2}
                    y={ly + 26}
                    fill="#00E5FF"
                    fontSize={16}
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    3× LOUPE
                  </SvgText>
                  <SvgText
                    x={lx + d / 2}
                    y={ly + d - 14}
                    fill="#FFFFFF"
                    fontSize={16}
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {`(${Math.round(dragPt.x)}, ${Math.round(dragPt.y)})`}
                  </SvgText>
                </G>
              );
            })()}
        </G>
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#060E1B',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.4)',
  },
});

