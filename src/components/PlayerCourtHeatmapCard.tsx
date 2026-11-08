import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { BounceEvent } from '../analysis/PickleballRallyAnalyzer';
import { LineSegment2D, PickleballCourt, PickleballCourtConstants } from '../cv/PickleballCourt';
import { HeatmapGrid } from '../cv/PlayerTracker';
import { hexWithAlpha } from '../render/PickleballHudRenderer';

export interface PlayerCourtHeatmapCardProps {
  title: string;
  colorHex: string;
  heatmap: HeatmapGrid;
  bounces: BounceEvent[];
}

export const PlayerCourtHeatmapCard: React.FC<PlayerCourtHeatmapCardProps> = ({
  title,
  colorHex,
  heatmap,
  bounces,
}: PlayerCourtHeatmapCardProps) => {
  const mapW = 115;
  const mapH = 235;
  const cw = PickleballCourtConstants.COURT_W;
  const cl = PickleballCourtConstants.COURT_L;
  const maxVal = Math.max(1, ...heatmap.grid);
  const cellW = mapW / heatmap.nx;
  const cellH = mapH / heatmap.ny;

  const toMap = (cx: number, cy: number) => ({
    x: ((cx + heatmap.margin) / (cw + 2 * heatmap.margin)) * mapW,
    y: ((cy + heatmap.margin) / (cl + 2 * heatmap.margin)) * mapH,
  });

  const netLeft = toMap(0, PickleballCourtConstants.NET_Y);
  const netRight = toMap(cw, PickleballCourtConstants.NET_Y);

  return (
    <View style={styles.card}>
      <Text style={[styles.title, { color: colorHex }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.mapWrapper}>
        <Svg width={mapW} height={mapH} viewBox={`0 0 ${mapW} ${mapH}`}>
          <Rect x={0} y={0} width={mapW} height={mapH} fill="#0A2E3D" />

          {/* Heatmap grid cells */}
          {heatmap.grid.map((v: number, idx: number) => {
            if (v <= 0) return null;
            const x = idx % heatmap.nx;
            const y = Math.floor(idx / heatmap.nx);
            const intensity = Math.max(0.15, Math.min(1, v / maxVal));
            return (
              <Rect
                key={`hm-${idx}`}
                x={x * cellW}
                y={y * cellH}
                width={cellW + 0.8}
                height={cellH + 0.8}
                fill={hexWithAlpha(colorHex, intensity * 0.78)}
              />
            );
          })}

          {/* Court & 7-ft Kitchen NVZ lines */}
          {PickleballCourt.courtLines().map((seg: LineSegment2D, idx: number) => {
            const p1 = toMap(seg.a.x, seg.a.y);
            const p2 = toMap(seg.b.x, seg.b.y);
            return (
              <Line
                key={`seg-${idx}`}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={seg.isKitchen ? '#00E5FF' : 'rgba(255,255,255,0.65)'}
                strokeWidth={seg.isKitchen ? 2 : 1.2}
              />
            );
          })}

          {/* Net line */}
          <Line
            x1={netLeft.x}
            y1={netLeft.y}
            x2={netRight.x}
            y2={netRight.y}
            stroke="#B6FF2E"
            strokeWidth={2.2}
          />

          {/* Bounce dots */}
          {bounces.map((b: BounceEvent, bi: number) => {
            const pt = toMap(b.courtPos.x, b.courtPos.y);
            return (
              <Circle
                key={`b-${bi}`}
                cx={pt.x}
                cy={pt.y}
                r={3.2}
                fill={b.isInBounds ? '#7CFF4F' : '#FF3D3D'}
              />
            );
          })}
        </Svg>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: 145,
    borderRadius: 10,
    backgroundColor: '#0E1B33',
    padding: 8,
    alignItems: 'center',
  },
  title: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  mapWrapper: {
    width: 115,
    height: 235,
    borderRadius: 6,
    overflow: 'hidden',
  },
});

