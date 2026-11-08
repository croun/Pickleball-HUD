import React, { useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  PanResponderGestureState,
  StyleSheet,
  View,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import {
  ActiveBounceCall,
  ActiveCalloutState,
  ActiveSpeedLabel,
  BounceEvent,
  FrameBallHudState,
  PickleballRallyAnalyzer,
} from '../analysis/PickleballRallyAnalyzer';
import { PickleballCourt, PickleballCourtConstants } from '../cv/PickleballCourt';
import { FrameSnapshot, PlayerSnapshotItem } from '../cv/PlayerTracker';
import {
  CALLOUT_INFO,
  CalloutType,
  HudStageMode,
  PanelPlacement,
  PickleballConfig,
  PickleballSpeedRanks,
  Point2D,
  ScoringMode,
} from '../model/PickleballConfig';
import { BuiltInPickleballDemoGenerator } from '../pipeline/VideoPipeline';
import {
  BADGE_FADE,
  BADGE_H,
  BONES,
  hexWithAlpha,
  HudPanelName,
  KP_CONF,
  panelColorRgba,
  PickleballHudRenderer,
} from '../render/PickleballHudRenderer';

export interface PickleballHudSvgCanvasProps {
  videoW: number;
  videoH: number;
  tSec: number;
  cfg: PickleballConfig;
  court: PickleballCourt | null;
  snap?: FrameSnapshot | null;
  ballState?: FrameBallHudState | null;
  trails?: (Point2D | null)[][] | null;
  preview?: boolean;
  interactiveLayout?: boolean;
  stageOverride?: HudStageMode;
  showHudOverlays?: boolean;
  onUpdatePlacement?: (panelName: HudPanelName, placement: PanelPlacement) => void;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const r = sec - m * 60;
  const mStr = String(m).padStart(2, '0');
  const rStr = r.toFixed(2).padStart(5, '0');
  return `${mStr}:${rStr}`;
}

export const PickleballHudSvgCanvas: React.FC<PickleballHudSvgCanvasProps> = ({
  videoW,
  videoH,
  tSec,
  cfg,
  court,
  snap: propSnap,
  ballState: propBallState,
  trails,
  preview = false,
  interactiveLayout = false,
  stageOverride,
  showHudOverlays = true,
  onUpdatePlacement,
}) => {
  const [viewSize, setViewSize] = useState({ width: 1, height: 1 });
  const [activePanel, setActivePanel] = useState<HudPanelName | null>(null);
  const dragStartRectRef = useRef<[number, number, number, number] | null>(null);
  const activePanelRef = useRef<HudPanelName | null>(null);

  const hud = useMemo(
    () => new PickleballHudRenderer(cfg, court, videoW, videoH, stageOverride),
    [cfg, court, videoW, videoH, stageOverride]
  );

  const outW = hud.outW;
  const outH = hud.outH;
  const s = hud.s;
  const th = hud.theme;

  // Build sample preview state when no live render snapshot is supplied
  const { effectiveSnap, effectiveBall } = useMemo(() => {
    if (propSnap && propBallState !== undefined) {
      return { effectiveSnap: propSnap, effectiveBall: propBallState };
    }
    const c =
      court ??
      new PickleballCourt(
        BuiltInPickleballDemoGenerator.defaultCorners(videoW, videoH),
        cfg.court.orientation
      );
    const samplePlayers: PlayerSnapshotItem[] = cfg.players.map((p, idx) => {
      const cPt =
        p.seed ?? {
          x: idx % 2 === 0 ? 1.6 : 4.5,
          y: p.side === 'far' ? 4.2 : 9.0,
        };
      const imgFoot = c.toImg(cPt);
      return {
        idx,
        name: p.name,
        color: p.color,
        team: p.team,
        trackId: idx + 1,
        pos: cPt,
        head: { x: imgFoot.x, y: imgFoot.y - 120 * (videoH / 720) },
        show: true,
        seen: true,
        kps: null,
        inKitchen: c.isInKitchen(cPt),
        atKitchenLine: c.isAtKitchenLine(cPt),
      };
    });
    const sampleSnap: FrameSnapshot = {
      t: tSec,
      players: samplePlayers,
      dist: samplePlayers.map((_, i) => 14.2 + i * 3.1),
      sta: samplePlayers.map((_, i) => 94 - i * 2),
      staFrac: samplePlayers.map((_, i) => 0.94 - i * 0.02),
      kitchenPct: samplePlayers.map((_, i) => 68 + i * 6),
      spd: samplePlayers.map(() => 2.4),
      top: samplePlayers.map(() => 4.8),
      rallyM: samplePlayers.map(() => 6.5),
    };
    const ballImg = c.toImg(3.1, 5.4);
    const sampleBall: FrameBallHudState = {
      pos: ballImg,
      rallyTimeSec: 5.42,
      rallyShotCount: 7,
      lastSpeedKmh: 74,
      speedLabel: { speedKmh: 74, ageSec: 0.25, at: ballImg },
      callout: {
        type: CalloutType.THIRD_SHOT_DROP,
        ageSec: 0.25,
        at: ballImg,
        playerIdx: 2,
      },
      activeBounceCall: null,
      recentBounces: [
        {
          frame: 20,
          imgPos: c.toImg(1.8, 4.9),
          courtPos: { x: 1.8, y: 4.9 },
          isInBounds: true,
          isInKitchen: true,
          rallyIdx: 0,
        },
        {
          frame: 35,
          imgPos: c.toImg(4.2, 10.5),
          courtPos: { x: 4.2, y: 10.5 },
          isInBounds: true,
          isInKitchen: false,
          rallyIdx: 0,
        },
        {
          frame: 48,
          imgPos: c.toImg(3.1, 13.9),
          courtPos: { x: 3.1, y: 13.9 },
          isInBounds: false,
          isInKitchen: false,
          rallyIdx: 0,
        },
      ],
      live: true,
      score: {
        frame: 48,
        scoreA: 3,
        scoreB: 2,
        servingTeam: 'A',
        serverNum: 2,
        displayScore:
          cfg.score.mode === ScoringMode.SIDE_OUT_0_0_2 ? '3 - 2 - 2' : '3 - 2',
      },
    };
    return { effectiveSnap: sampleSnap, effectiveBall: sampleBall };
  }, [propSnap, propBallState, court, videoW, videoH, cfg, tSec]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => interactiveLayout,
        onMoveShouldSetPanResponder: () => interactiveLayout,
        onPanResponderGrant: (evt) => {
          if (!interactiveLayout) return;
          const { locationX, locationY } = evt.nativeEvent;
          const ox = locationX * (outW / Math.max(1, viewSize.width));
          const oy = locationY * (outH / Math.max(1, viewSize.height));
          const names: HudPanelName[] = [
            'speedBadge',
            'courtMap',
            'playerPanel',
            'topHud',
          ];
          const hit =
            names.find((n) => {
              const r = hud.rect(n);
              return ox >= r[0] && ox <= r[0] + r[2] && oy >= r[1] && oy <= r[1] + r[3];
            }) ?? null;
          activePanelRef.current = hit;
          setActivePanel(hit);
          dragStartRectRef.current = hit ? hud.rect(hit) : null;
        },
        onPanResponderMove: (_, gestureState) => {
          const panel = activePanelRef.current;
          const startRect = dragStartRectRef.current;
          if (!interactiveLayout || !panel || !startRect || !onUpdatePlacement) return;
          const dx = gestureState.dx * (outW / Math.max(1, viewSize.width));
          const dy = gestureState.dy * (outH / Math.max(1, viewSize.height));
          const maxX = Math.max(0, (outW - startRect[2]) / outW);
          const maxY = Math.max(0, (outH - startRect[3]) / outH);
          const newX = Math.max(0, Math.min(maxX, (startRect[0] + dx) / outW));
          const newY = Math.max(0, Math.min(maxY, (startRect[1] + dy) / outH));
          onUpdatePlacement(panel, {
            x: newX,
            y: newY,
            scale: hud.scaleOf(panel),
          });
        },
        onPanResponderRelease: () => {
          activePanelRef.current = null;
          dragStartRectRef.current = null;
          setActivePanel(null);
        },
        onPanResponderTerminate: () => {
          activePanelRef.current = null;
          dragStartRectRef.current = null;
          setActivePanel(null);
        },
      }),
    [interactiveLayout, outW, outH, viewSize.width, viewSize.height, hud, onUpdatePlacement]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setViewSize({ width, height });
    }
  };

  // Synthetic arena court & players rendering inside the video frame
  const demoCourt = useMemo(
    () =>
      court ??
      new PickleballCourt(
        BuiltInPickleballDemoGenerator.defaultCorners(videoW, videoH),
        'behind'
      ),
    [court, videoW, videoH]
  );

  const svgCourt = useMemo(() => demoCourt.buildSvgCourtElements(), [demoCourt]);
  const demoDets = useMemo(
    () =>
      BuiltInPickleballDemoGenerator.syntheticDetectionsAt(
        videoW,
        videoH,
        tSec,
        demoCourt
      ),
    [videoW, videoH, tSec, demoCourt]
  );
  const demoBall = useMemo(
    () => BuiltInPickleballDemoGenerator.syntheticBallAt(tSec, demoCourt),
    [tSec, demoCourt]
  );

  const [vx, vy, vw, vh] = hud.videoRect;
  const vScaleX = vw / videoW;
  const vScaleY = vh / videoH;
  const shown = effectiveSnap.players.filter(
    (p) => p.show && p.pos !== null && p.head !== null
  );

  return (
    <View
      style={[styles.container, { aspectRatio: outW / Math.max(1, outH) }]}
      onLayout={onLayout}
      {...(interactiveLayout ? panResponder.panHandlers : {})}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${outW} ${outH}`}>
        <Defs>
          <LinearGradient id="arenaBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#0A1426" />
            <Stop offset="100%" stopColor="#12223A" />
          </LinearGradient>
          <LinearGradient id="stageBg" x1="0" y1="0" x2="0.3" y2="1">
            <Stop
              offset="0%"
              stopColor={`rgb(${th.panelR},${th.panelG},${th.panelB})`}
            />
            <Stop
              offset="100%"
              stopColor={`rgb(${Math.round(th.panelR * 0.72)},${Math.round(
                th.panelG * 0.72
              )},${Math.round(th.panelB * 0.72)})`}
            />
          </LinearGradient>
        </Defs>

        {/* Stage background if inset */}
        {hud.isInset && (
          <Rect x={0} y={0} width={outW} height={outH} fill="url(#stageBg)" />
        )}

        {/* Video Frame Viewport */}
        <G transform={`translate(${vx}, ${vy}) scale(${vScaleX}, ${vScaleY})`}>
          {/* Arena background */}
          <Rect x={0} y={0} width={videoW} height={videoH} fill="url(#arenaBg)" />

          {/* Court Surface */}
          <Polygon points={svgCourt.outerPolygonPoints} fill="#186291" />

          {/* Non-Volley Zone (Kitchen) Fill */}
          <Polygon
            points={svgCourt.kitchenPolygonPoints}
            fill="rgba(0, 180, 155, 0.55)"
          />

          {/* Court Lines */}
          {svgCourt.linePaths.map((lp: { d: string; isKitchen: boolean }, idx: number) => (
            <Path
              key={`cline-${idx}`}
              d={lp.d}
              stroke="rgba(255,255,255,0.92)"
              strokeWidth={3 * (videoH / 720)}
              fill="none"
            />
          ))}

          {/* Pickleball Net */}
          {(() => {
            const netL = demoCourt.toImg(-0.35, PickleballCourtConstants.NET_Y);
            const netR = demoCourt.toImg(
              PickleballCourtConstants.COURT_W + 0.35,
              PickleballCourtConstants.NET_Y
            );
            return (
              <G>
                <Line
                  x1={netL.x}
                  y1={netL.y - 18}
                  x2={netR.x}
                  y2={netR.y - 18}
                  stroke="rgba(230,245,255,0.9)"
                  strokeWidth={4 * (videoH / 720)}
                />
                <Line
                  x1={netL.x}
                  y1={netL.y}
                  x2={netL.x}
                  y2={netL.y - 22}
                  stroke="#9FB4D0"
                  strokeWidth={4}
                />
                <Line
                  x1={netR.x}
                  y1={netR.y}
                  x2={netR.x}
                  y2={netR.y - 22}
                  stroke="#9FB4D0"
                  strokeWidth={4}
                />
              </G>
            );
          })()}

          {/* Under-foot 3D Rings */}
          {showHudOverlays &&
            shown.map((p: PlayerSnapshotItem) => {
              if (!p.pos) return null;
              const colHex = hud.ringColorHex(p);
              const outer = hud.projCircle(p.pos, cfg.render.ringRadiusM);
              if (outer.length < 3) return null;
              const outerD = hud.pointsToPathD(outer, true);
              const innerD = hud.pointsToPathD(
                hud.projCircle(p.pos, cfg.render.ringRadiusM * 0.7),
                true
              );
              const arcs =
                cfg.render.ringStyle === 'neon'
                  ? hud.rotatingArcPathsD(p.pos, effectiveSnap.t)
                  : [];

              return (
                <G key={`ring-${p.idx}`}>
                  <Path
                    d={outerD}
                    fill={
                      cfg.render.ringStyle === 'minimal'
                        ? 'none'
                        : hexWithAlpha(
                            colHex,
                            cfg.render.ringStyle === 'solid' ? 0.42 : 0.2
                          )
                    }
                    stroke={colHex}
                    strokeWidth={Math.max(3.2 * s, 2)}
                  />
                  {cfg.render.ringStyle !== 'minimal' && (
                    <Path
                      d={innerD}
                      fill="none"
                      stroke={hexWithAlpha(colHex, 0.7)}
                      strokeWidth={Math.max(1.5 * s, 1)}
                    />
                  )}
                  {arcs.map((arcD: string, ai: number) => (
                    <Path
                      key={`arc-${p.idx}-${ai}`}
                      d={arcD}
                      fill="none"
                      stroke={colHex}
                      strokeWidth={Math.max(3 * s, 2)}
                      strokeLinecap="round"
                    />
                  ))}
                </G>
              );
            })}

          {/* Synthetic Arena Players (sorted back to front) */}
          {(() => {
            const jerseyColors = ['#FF5A36', '#FFB300', '#00E5FF', '#7CFF4F'];
            const order = demoDets
              .map((_: unknown, i: number) => i)
              .sort((a: number, b: number) => demoDets[a].box[3] - demoDets[b].box[3]);
            return order.map((idx: number) => {
              const d = demoDets[idx];
              const [x1, y1, x2, y2] = d.box;
              const bw = x2 - x1;
              const bh = y2 - y1;
              const cx = (x1 + x2) / 2;
              const jCol = cfg.players[idx]?.color ?? jerseyColors[idx % 4];
              return (
                <G key={`arena-player-${idx}`}>
                  {/* Legs */}
                  <Line
                    x1={cx - bw * 0.14}
                    y1={y1 + bh * 0.54}
                    x2={cx - bw * 0.18}
                    y2={y2}
                    stroke="#DCE6F2"
                    strokeWidth={Math.max(4, bw * 0.12)}
                    strokeLinecap="round"
                  />
                  <Line
                    x1={cx + bw * 0.14}
                    y1={y1 + bh * 0.54}
                    x2={cx + bw * 0.18}
                    y2={y2}
                    stroke="#DCE6F2"
                    strokeWidth={Math.max(4, bw * 0.12)}
                    strokeLinecap="round"
                  />
                  {/* Shorts */}
                  <Rect
                    x={x1 + bw * 0.22}
                    y={y1 + bh * 0.48}
                    width={bw * 0.56}
                    height={bh * 0.16}
                    rx={4}
                    fill="#142038"
                  />
                  {/* Jersey Torso */}
                  <Rect
                    x={x1 + bw * 0.2}
                    y={y1 + bh * 0.18}
                    width={bw * 0.6}
                    height={bh * 0.34}
                    rx={6}
                    fill={jCol}
                  />
                  {/* Head */}
                  <Circle
                    cx={cx}
                    cy={y1 + bh * 0.1}
                    r={Math.max(6, bw * 0.17)}
                    fill="#F4C7A5"
                  />
                  {/* Pickleball Paddle */}
                  <Ellipse
                    cx={x2 + bw * 0.06}
                    cy={y1 + bh * 0.34}
                    rx={Math.max(5, bw * 0.14)}
                    ry={Math.max(7, bw * 0.19)}
                    fill="#101828"
                    stroke={jCol}
                    strokeWidth={2}
                  />
                </G>
              );
            });
          })()}

          {/* YOLO11 Pose Skeleton Overlay */}
          {showHudOverlays &&
            cfg.render.skeleton &&
            shown.map((p: PlayerSnapshotItem) => {
              const k = p.kps ?? demoDets[p.idx]?.kps;
              if (!k || k.length < 51) return null;
              const isOn = (j: number) => k[j * 3 + 2] > KP_CONF;
              return (
                <G key={`skel-${p.idx}`}>
                  {BONES.map(([a, b]: [number, number], bi: number) =>
                    isOn(a) && isOn(b) ? (
                      <Line
                        key={`bone-${p.idx}-${bi}`}
                        x1={k[a * 3]}
                        y1={k[a * 3 + 1]}
                        x2={k[b * 3]}
                        y2={k[b * 3 + 1]}
                        stroke={hexWithAlpha(p.color, 0.85)}
                        strokeWidth={Math.max(3 * s, 1.5)}
                        strokeLinecap="round"
                      />
                    ) : null
                  )}
                  {Array.from({ length: 12 }, (_: unknown, idx: number) => idx + 5).map((j: number) =>
                    isOn(j) ? (
                      <Circle
                        key={`kp-${p.idx}-${j}`}
                        cx={k[j * 3]}
                        cy={k[j * 3 + 1]}
                        r={Math.max(3.5 * s, 2)}
                        fill="#FFFFFF"
                      />
                    ) : null
                  )}
                </G>
              );
            })}

          {/* Optic Yellow Pickleball + Hit Glow */}
          {(() => {
            const bPos = effectiveBall?.pos ?? demoBall;
            if (!bPos) return null;
            return (
              <G>
                {showHudOverlays && cfg.render.ballMark && (
                  <Circle
                    cx={bPos.x}
                    cy={bPos.y}
                    r={12 * s}
                    fill="rgba(182, 255, 46, 0.22)"
                    stroke="#B6FF2E"
                    strokeWidth={Math.max(2 * s, 1.5)}
                  />
                )}
                <Circle cx={bPos.x} cy={bPos.y} r={5.5} fill="#D4FF33" />
              </G>
            );
          })()}

          {/* On-Court Bounce Callout (IN / OUT! / KITCHEN BOUNCE) */}
          {showHudOverlays &&
            cfg.render.showBounceMarkers &&
            effectiveBall?.activeBounceCall &&
            renderBounceCallout(effectiveBall.activeBounceCall, hud, videoW, videoH)}

          {/* Hit-Mode Speed Badge */}
          {showHudOverlays &&
            cfg.render.ballMark &&
            cfg.render.badge.mode === 'hit' &&
            effectiveBall?.speedLabel &&
            renderSpeedBadge(
              effectiveBall.speedLabel,
              hud,
              cfg,
              effectiveBall.speedLabel.at
            )}

          {/* Pickleball Shot Callout (DRIVE!, DINK, 3RD SHOT DROP!, ATP!, SPEED-UP!, NVZ FAULT!) */}
          {showHudOverlays &&
            cfg.render.calloutsEnabled &&
            effectiveBall?.callout &&
            renderShotCallout(
              effectiveBall.callout,
              effectiveSnap.players,
              hud,
              videoW,
              videoH
            )}

          {/* Floating Player Head Tags */}
          {showHudOverlays &&
            cfg.render.tags &&
            [...shown]
              .sort((a: PlayerSnapshotItem, b: PlayerSnapshotItem) => a.head!.y - b.head!.y)
              .map((p: PlayerSnapshotItem) => renderPlayerTag(p, effectiveSnap, hud, cfg, videoW))}
        </G>

        {/* Inset Video Frame Border */}
        {hud.isInset && (
          <Rect
            x={vx}
            y={vy}
            width={vw}
            height={vh}
            fill="none"
            stroke={th.accentHex}
            strokeWidth={Math.max(2 * s, 1.5)}
          />
        )}

        {/* Top Broadcast HUD Scoreboard */}
        {showHudOverlays &&
          cfg.render.topHud &&
          renderTopHud(hud, cfg, effectiveBall, preview)}

        {/* Player Stats Panel */}
        {showHudOverlays &&
          cfg.render.playerPanel &&
          renderPlayerPanel(hud, cfg, effectiveSnap)}

        {/* 2D Pickleball Court Radar Map */}
        {showHudOverlays &&
          cfg.render.courtMap &&
          demoCourt &&
          renderCourtMap(
            hud,
            cfg,
            demoCourt,
            shown,
            trails ?? null,
            effectiveBall?.recentBounces ?? []
          )}

        {/* Fixed-Mode Speed Badge */}
        {showHudOverlays &&
          cfg.render.ballMark &&
          cfg.render.badge.mode === 'fixed' &&
          effectiveBall?.speedLabel &&
          renderSpeedBadge(effectiveBall.speedLabel, hud, cfg, null)}

        {/* Active Dragged Panel Selection Outline */}
        {interactiveLayout &&
          activePanel &&
          (() => {
            const r = hud.rect(activePanel);
            return (
              <Rect
                x={r[0]}
                y={r[1]}
                width={r[2]}
                height={r[3]}
                fill="none"
                stroke="#FFC400"
                strokeWidth={3.5}
                strokeDasharray="10,6"
              />
            );
          })()}
      </Svg>
    </View>
  );
};

function renderPlayerTag(
  p: PlayerSnapshotItem,
  snap: FrameSnapshot,
  hud: PickleballHudRenderer,
  cfg: PickleballConfig,
  videoW: number
) {
  const head = p.head;
  if (!head) return null;
  const sc = Math.max(hud.s * cfg.render.tagScale, 0.45);
  const th = hud.theme;
  const frac = snap.staFrac[p.idx] ?? 1;
  const staNum = String(Math.round(snap.sta[p.idx] ?? 100));
  const nvzLabel = cfg.render.showKitchenPresence && p.inKitchen ? 'NVZ' : 'STA';

  const pad = 12 * sc;
  const bw = Math.max(155 * sc, (p.name.length * 13 + 95) * sc);
  const bh = 54 * sc;
  const ah = 11 * sc;
  const aw = 18 * sc;

  const x0 = Math.max(4, Math.min(videoW - bw - 4, head.x - bw / 2));
  const y0 = Math.max(4, head.y - 10 * sc - ah - bh);
  const x1 = x0 + bw;
  const y1 = y0 + bh;
  const ax = Math.max(x0 + 10 * sc, Math.min(x1 - 10 * sc, head.x));

  const frameD = hud.buildFramePathD(x0, y0, bw, bh, 0, 6);
  const borderCol = p.inKitchen ? '#FF5252' : hexWithAlpha(p.color, 0.78);
  const bx0 = x0 + pad + 6 * sc;
  const bx1 = x1 - pad;
  const by = y1 - 14 * sc;

  return (
    <G key={`ptag-${p.idx}`}>
      <Path d={frameD} fill={panelColorRgba(th, 0.84)} stroke={borderCol} strokeWidth={1.5} />
      <Rect
        x={x0 + 1}
        y={y0 + 4 * sc}
        width={5 * sc}
        height={bh - 8 * sc}
        fill={p.color}
      />
      <Polygon
        points={`${ax - aw / 2},${y1 + 1} ${ax + aw / 2},${y1 + 1} ${ax},${y1 + ah}`}
        fill={p.color}
      />
      <SvgText
        x={x0 + pad + 8 * sc}
        y={y0 + 29 * sc}
        fill={th.textHex}
        fontSize={21 * sc}
        fontWeight="bold"
      >
        {p.name}
      </SvgText>
      <SvgText
        x={x1 - pad - 34 * sc}
        y={y0 + 28 * sc}
        fill={p.inKitchen ? '#FF5252' : th.mutedHex}
        fontSize={14 * sc}
        fontWeight="bold"
        textAnchor="end"
      >
        {nvzLabel}
      </SvgText>
      <SvgText
        x={x1 - pad}
        y={y0 + 30 * sc}
        fill={p.color}
        fontSize={26 * sc}
        fontWeight="bold"
        textAnchor="end"
      >
        {staNum}
      </SvgText>
      {/* Stamina bar */}
      <Rect
        x={bx0}
        y={by}
        width={bx1 - bx0}
        height={5 * sc}
        fill={hexWithAlpha(th.textHex, 0.18)}
      />
      <Rect
        x={bx0}
        y={by}
        width={(bx1 - bx0) * Math.max(0, Math.min(1, frac))}
        height={5 * sc}
        fill={frac < 0.3 ? '#FF5252' : p.color}
      />
    </G>
  );
}

function renderTopHud(
  hud: PickleballHudRenderer,
  cfg: PickleballConfig,
  ballState: FrameBallHudState | null | undefined,
  preview: boolean
) {
  const sc = hud.s * hud.scaleOf('topHud');
  const th = hud.theme;

  const panels: {
    label: string;
    value: string;
    unit: string;
    note?: string;
    live?: boolean;
  }[] = [];

  if (cfg.score.enabled) {
    const scoreLabel =
      cfg.score.mode === ScoringMode.SIDE_OUT_0_0_2
        ? `SCORE (SRV ${ballState?.score?.servingTeam ?? 'A'})`
        : 'SCORE A - B';
    const scoreVal =
      ballState?.score?.displayScore ??
      (cfg.score.mode === ScoringMode.SIDE_OUT_0_0_2
        ? `${cfg.score.startA}-${cfg.score.startB}-${cfg.score.startServerNum}`
        : `${cfg.score.startA} - ${cfg.score.startB}`);
    panels.push({ label: scoreLabel, value: scoreVal, unit: '' });
  }

  const lastSpd = ballState?.lastSpeedKmh ?? null;
  const rankInfo =
    lastSpd !== null
      ? PickleballSpeedRanks.rankOf(lastSpd, cfg.render.badge.ranks)
      : null;

  panels.push({
    label: 'RALLY TIME',
    value: preview
      ? 'ANALYZING'
      : ballState?.rallyTimeSec !== null && ballState?.rallyTimeSec !== undefined
      ? fmtTime(ballState.rallyTimeSec)
      : '--:--.--',
    unit: '',
    live: ballState?.live === true,
  });
  panels.push({
    label: 'RALLY COUNT',
    value:
      ballState?.rallyShotCount !== null && ballState?.rallyShotCount !== undefined
        ? String(ballState.rallyShotCount)
        : '--',
    unit: 'SHOTS',
  });
  panels.push({
    label: 'SHOT SPEED',
    value: lastSpd !== null ? String(lastSpd) : '--',
    unit: rankInfo ? `KM/H ${rankInfo.rank}` : 'KM/H',
    note: 'EST.',
  });

  const pw = 290 * sc;
  const ph = 96 * sc;
  const gap = 16 * sc;
  const skew = 18 * sc;
  const topRect = hud.rect('topHud', Math.max(1, cfg.players.length), panels.length);
  const y = topRect[1];

  return (
    <G>
      {panels.map((pnl, idx) => {
        const x = topRect[0] + idx * (pw + gap);
        const frameD = hud.buildFramePathD(x, y, pw, ph, skew);
        const cx = x + pw / 2;
        const titleText = pnl.label + (pnl.note ? ` (${pnl.note})` : '');
        const techCorners = hud.techCornerPathsD(x, y, pw, ph);

        return (
          <G key={`top-pnl-${idx}`}>
            <Path
              d={frameD}
              fill={panelColorRgba(th, 0.84)}
              stroke={hexWithAlpha(th.accentHex, 0.32)}
              strokeWidth={1.5}
            />
            <Rect
              x={x + skew * 0.5}
              y={y + ph - 4 * sc}
              width={pw - skew}
              height={4 * sc}
              fill={th.accentHex}
            />
            {techCorners.map((cd, ci) => (
              <Path
                key={`tc-${idx}-${ci}`}
                d={cd}
                fill="none"
                stroke={th.accentHex}
                strokeWidth={Math.max(2 * sc, 1.5)}
              />
            ))}
            {pnl.live && (
              <Circle
                cx={x + skew + 16 * sc}
                cy={y + 21 * sc}
                r={5 * sc}
                fill="#FF3D3D"
              />
            )}
            <SvgText
              x={cx}
              y={y + 28 * sc}
              fill={th.mutedHex}
              fontSize={18 * sc}
              fontWeight="bold"
              textAnchor="middle"
            >
              {titleText}
            </SvgText>
            <SvgText
              x={pnl.unit ? cx - 22 * sc : cx}
              y={y + 78 * sc}
              fill={th.textHex}
              fontSize={42 * sc}
              fontWeight="bold"
              textAnchor="middle"
            >
              {pnl.value}
            </SvgText>
            {pnl.unit !== '' && (
              <SvgText
                x={cx + 38 * sc}
                y={y + 76 * sc}
                fill={th.accentHex}
                fontSize={18 * sc}
                fontWeight="bold"
                textAnchor="start"
              >
                {pnl.unit}
              </SvgText>
            )}
          </G>
        );
      })}
    </G>
  );
}

function renderPlayerPanel(
  hud: PickleballHudRenderer,
  cfg: PickleballConfig,
  snap: FrameSnapshot
) {
  const players = snap.players;
  const n = Math.max(1, players.length);
  const sc = hud.s * hud.scaleOf('playerPanel');
  const th = hud.theme;
  const headH = 34 * sc;
  const rowH = 64 * sc;
  const extra = cfg.render.playerStats;
  const pRect = hud.rect('playerPanel', n);
  const [x0, y0, w] = pRect;
  const h = headH + rowH * n;

  const colSpd = x0 + 345 * sc;
  const colTop = x0 + 425 * sc;
  const colNvz = x0 + 515 * sc;
  const colMove = x0 + (extra ? 605 : 360) * sc;
  const colSta = x0 + w - 18 * sc;

  const frameD = hud.buildFramePathD(x0, y0, w, h);
  const sorted = [...players].sort((a, b) =>
    a.team !== b.team ? a.team.localeCompare(b.team) : a.idx - b.idx
  );
  const fmt = (v: number | null | undefined) =>
    v === null || v === undefined ? '--' : v.toFixed(1);

  return (
    <G>
      <Path
        d={frameD}
        fill={panelColorRgba(th, 0.84)}
        stroke={hexWithAlpha(th.accentHex, 0.28)}
        strokeWidth={1.5}
      />
      <Rect x={x0} y={y0} width={w} height={3 * sc} fill={th.accentHex} />
      <SvgText
        x={x0 + 18 * sc}
        y={y0 + 24 * sc}
        fill={th.textHex}
        fontSize={18 * sc}
        fontWeight="bold"
      >
        PLAYERS
      </SvgText>
      {extra && (
        <>
          <SvgText
            x={colSpd}
            y={y0 + 24 * sc}
            fill={th.mutedHex}
            fontSize={16 * sc}
            fontWeight="bold"
            textAnchor="end"
          >
            SPD
          </SvgText>
          <SvgText
            x={colTop}
            y={y0 + 24 * sc}
            fill={th.mutedHex}
            fontSize={16 * sc}
            fontWeight="bold"
            textAnchor="end"
          >
            TOP
          </SvgText>
          <SvgText
            x={colNvz}
            y={y0 + 24 * sc}
            fill={th.mutedHex}
            fontSize={16 * sc}
            fontWeight="bold"
            textAnchor="end"
          >
            NVZ%
          </SvgText>
        </>
      )}
      <SvgText
        x={colMove}
        y={y0 + 24 * sc}
        fill={th.mutedHex}
        fontSize={16 * sc}
        fontWeight="bold"
        textAnchor="end"
      >
        MOVE
      </SvgText>
      <SvgText
        x={colSta}
        y={y0 + 24 * sc}
        fill={th.mutedHex}
        fontSize={16 * sc}
        fontWeight="bold"
        textAnchor="end"
      >
        STA
      </SvgText>

      {sorted.map((p, i) => {
        const ry = y0 + headH + i * rowH;
        const frac = snap.staFrac[p.idx] ?? 1;
        const spdVal = snap.spd[p.idx];
        const topVal = snap.top[p.idx];
        const nvzPct = snap.kitchenPct[p.idx] ?? 0;
        const moveVal = snap.dist[p.idx] ?? 0;
        const staVal = Math.round(snap.sta[p.idx] ?? 100);

        const segs = 12;
        const sw = 15 * sc;
        const sg = 3 * sc;
        const bx = x0 + 24 * sc;
        const by = ry + 46 * sc;
        const lit = Math.round(frac * segs);

        return (
          <G key={`prow-${p.idx}`}>
            {i % 2 === 0 && (
              <Rect
                x={x0 + 2}
                y={ry}
                width={w - 4}
                height={rowH}
                fill={hexWithAlpha(th.textHex, 0.05)}
              />
            )}
            <Rect
              x={x0 + 10 * sc}
              y={ry + 10 * sc}
              width={5 * sc}
              height={rowH - 20 * sc}
              fill={p.color}
            />
            <Rect
              x={x0 + 24 * sc}
              y={ry + 12 * sc}
              width={22 * sc}
              height={20 * sc}
              rx={3 * sc}
              fill={hexWithAlpha(p.color, 0.22)}
            />
            <SvgText
              x={x0 + 35 * sc}
              y={ry + 27 * sc}
              fill={p.color}
              fontSize={15 * sc}
              fontWeight="bold"
              textAnchor="middle"
            >
              {p.team}
            </SvgText>
            <SvgText
              x={x0 + 56 * sc}
              y={ry + 29 * sc}
              fill={th.textHex}
              fontSize={21 * sc}
              fontWeight="bold"
            >
              {p.name}
            </SvgText>

            {/* 12-segment stamina bar */}
            {Array.from({ length: segs }, (_, k) => {
              const sx0 = bx + k * (sw + sg);
              const segCol =
                k < lit
                  ? frac < 0.3
                    ? '#FF5252'
                    : p.color
                  : hexWithAlpha(th.textHex, 0.14);
              return (
                <Polygon
                  key={`seg-${p.idx}-${k}`}
                  points={`${sx0 + 3 * sc},${by} ${sx0 + sw + 3 * sc},${by} ${
                    sx0 + sw
                  },${by + 8 * sc} ${sx0},${by + 8 * sc}`}
                  fill={segCol}
                />
              );
            })}

            {extra ? (
              <>
                <SvgText
                  x={colSpd}
                  y={ry + 40 * sc}
                  fill={th.textHex}
                  fontSize={26 * sc}
                  fontWeight="bold"
                  textAnchor="end"
                >
                  {fmt(spdVal)}
                </SvgText>
                <SvgText
                  x={colTop}
                  y={ry + 40 * sc}
                  fill={p.color}
                  fontSize={26 * sc}
                  fontWeight="bold"
                  textAnchor="end"
                >
                  {fmt(topVal)}
                </SvgText>
                <SvgText
                  x={colNvz}
                  y={ry + 40 * sc}
                  fill={th.accentHex}
                  fontSize={26 * sc}
                  fontWeight="bold"
                  textAnchor="end"
                >
                  {`${Math.round(nvzPct)}%`}
                </SvgText>
                <SvgText
                  x={colMove}
                  y={ry + 40 * sc}
                  fill={th.textHex}
                  fontSize={26 * sc}
                  fontWeight="bold"
                  textAnchor="end"
                >
                  {moveVal.toFixed(1)}
                </SvgText>
              </>
            ) : (
              <SvgText
                x={colMove}
                y={ry + 40 * sc}
                fill={th.textHex}
                fontSize={26 * sc}
                fontWeight="bold"
                textAnchor="end"
              >
                {`${moveVal.toFixed(1)}M`}
              </SvgText>
            )}
            <SvgText
              x={colSta}
              y={ry + 40 * sc}
              fill={frac < 0.3 ? '#FF5252' : p.color}
              fontSize={26 * sc}
              fontWeight="bold"
              textAnchor="end"
            >
              {String(staVal)}
            </SvgText>
          </G>
        );
      })}
    </G>
  );
}

function renderCourtMap(
  hud: PickleballHudRenderer,
  cfg: PickleballConfig,
  court: PickleballCourt,
  shown: PlayerSnapshotItem[],
  trails: (Point2D | null)[][] | null,
  recentBounces: BounceEvent[]
) {
  const sc = hud.s * hud.scaleOf('courtMap');
  const th = hud.theme;
  const isSide = court.orientation === 'side';
  const [mw, mh] = hud.mapInner(sc);
  const pad = 22 * sc;
  const titleH = 38 * sc;
  const [px0, py0, pw, ph] = hud.rect('courtMap');
  const ox = px0 + pad;
  const oy = py0 + titleH + pad;
  const cw = PickleballCourtConstants.COURT_W;
  const cl = PickleballCourtConstants.COURT_L;

  const toMap = (xIn: number, yIn: number): Point2D => {
    const x = Math.max(-0.8, Math.min(cw + 0.8, xIn));
    const y = Math.max(-0.8, Math.min(cl + 0.8, yIn));
    return isSide
      ? { x: ox + (y / cl) * mw, y: oy + (x / cw) * mh }
      : { x: ox + (x / cw) * mw, y: oy + (y / cl) * mh };
  };

  const frameD = hud.buildFramePathD(px0, py0, pw, ph);
  const aPt = toMap(0, 0);
  const bPt = toMap(cw, cl);
  const kA = toMap(0, PickleballCourtConstants.NVZ_FAR_Y);
  const kB = toMap(cw, PickleballCourtConstants.NVZ_NEAR_Y);
  const netP1 = toMap(-0.3, PickleballCourtConstants.NET_Y);
  const netP2 = toMap(cw + 0.3, PickleballCourtConstants.NET_Y);

  return (
    <G>
      <Path
        d={frameD}
        fill={panelColorRgba(th, 0.84)}
        stroke={hexWithAlpha(th.accentHex, 0.28)}
        strokeWidth={1.5}
      />
      <Rect x={px0} y={py0} width={pw} height={3 * sc} fill={th.accentHex} />
      <SvgText
        x={px0 + pad}
        y={py0 + 27 * sc}
        fill={th.textHex}
        fontSize={19 * sc}
        fontWeight="bold"
      >
        PICKLEBALL COURT · NVZ
      </SvgText>

      {/* Court surface */}
      <Rect
        x={Math.min(aPt.x, bPt.x)}
        y={Math.min(aPt.y, bPt.y)}
        width={Math.abs(bPt.x - aPt.x)}
        height={Math.abs(bPt.y - aPt.y)}
        fill="rgba(18, 108, 138, 0.65)"
      />

      {/* Shaded 7-ft Kitchen NVZ */}
      {cfg.court.showKitchenZone && (
        <Rect
          x={Math.min(kA.x, kB.x)}
          y={Math.min(kA.y, kB.y)}
          width={Math.abs(kB.x - kA.x)}
          height={Math.abs(kB.y - kA.y)}
          fill={hexWithAlpha(th.accentHex, 0.24)}
        />
      )}

      {/* Court lines */}
      {PickleballCourt.courtLines().map((seg, idx) => {
        const p1 = toMap(seg.a.x, seg.a.y);
        const p2 = toMap(seg.b.x, seg.b.y);
        return (
          <Line
            key={`map-seg-${idx}`}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke="rgba(255,255,255,0.82)"
            strokeWidth={Math.max(1.5 * sc, 1)}
          />
        );
      })}

      {/* Net line */}
      <Line
        x1={netP1.x}
        y1={netP1.y}
        x2={netP2.x}
        y2={netP2.y}
        stroke={th.accentHex}
        strokeWidth={Math.max(2.5 * sc, 2)}
      />

      {/* Player trails */}
      {trails &&
        shown.map((p) => {
          const pTrail = trails[p.idx];
          if (!pTrail) return null;
          const cmds: string[] = [];
          let on = false;
          for (const q of pTrail) {
            if (!q) {
              on = false;
              continue;
            }
            const mp = toMap(q.x, q.y);
            cmds.push(`${on ? 'L' : 'M'}${mp.x.toFixed(1)},${mp.y.toFixed(1)}`);
            on = true;
          }
          if (cmds.length === 0) return null;
          return (
            <Path
              key={`trail-${p.idx}`}
              d={cmds.join(' ')}
              fill="none"
              stroke={hexWithAlpha(p.color, 0.65)}
              strokeWidth={Math.max(3 * sc, 1.5)}
              strokeLinecap="round"
            />
          );
        })}

      {/* 2D Ball Bounce Markers */}
      {cfg.render.showBounceMarkers &&
        recentBounces.map((b, bi) => {
          const mp = toMap(b.courtPos.x, b.courtPos.y);
          const r = 4.8 * sc;
          if (!b.isInBounds) {
            return (
              <G key={`mbounce-${bi}`}>
                <Line
                  x1={mp.x - r}
                  y1={mp.y - r}
                  x2={mp.x + r}
                  y2={mp.y + r}
                  stroke="#FF3D3D"
                  strokeWidth={Math.max(2.2 * sc, 1.5)}
                />
                <Line
                  x1={mp.x - r}
                  y1={mp.y + r}
                  x2={mp.x + r}
                  y2={mp.y - r}
                  stroke="#FF3D3D"
                  strokeWidth={Math.max(2.2 * sc, 1.5)}
                />
              </G>
            );
          }
          return (
            <G key={`mbounce-${bi}`}>
              <Circle
                cx={mp.x}
                cy={mp.y}
                r={r}
                fill={b.isInKitchen ? '#00E5FF' : '#7CFF4F'}
              />
              <Circle
                cx={mp.x}
                cy={mp.y}
                r={r + 2 * sc}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={1.2 * sc}
              />
            </G>
          );
        })}

      {/* Player radar dots */}
      {shown.map((p) => {
        if (!p.pos) return null;
        const mp = toMap(p.pos.x, p.pos.y);
        const r = 6.5 * sc;
        return (
          <G key={`mdot-${p.idx}`}>
            <Circle cx={mp.x} cy={mp.y} r={r * 2} fill={hexWithAlpha(p.color, 0.32)} />
            <Circle
              cx={mp.x}
              cy={mp.y}
              r={r}
              fill={p.color}
              stroke={
                p.inKitchen && cfg.render.showKitchenPresence ? '#FF5252' : '#FFFFFF'
              }
              strokeWidth={Math.max(1.8 * sc, 1)}
            />
          </G>
        );
      })}
    </G>
  );
}

function renderBounceCallout(
  bounceCall: ActiveBounceCall,
  hud: PickleballHudRenderer,
  videoW: number,
  videoH: number
) {
  const b = bounceCall.bounce;
  const age = bounceCall.ageSec;
  const alpha = Math.max(0, Math.min(1, 1 - Math.max(0, age - 0.7) / 0.4));
  if (alpha <= 0) return null;

  const s = hud.s;
  const th = hud.theme;
  const colHex = !b.isInBounds ? '#FF3D3D' : b.isInKitchen ? '#00E5FF' : '#7CFF4F';
  const label = !b.isInBounds ? 'OUT!' : b.isInKitchen ? 'KITCHEN BOUNCE' : 'IN';

  const rippleRadius = (10 + 28 * (age / PickleballRallyAnalyzer.BOUNCE_CALL_SECS)) * s;
  const tw = (label.length * 14 + 24) * s;
  const thBox = 28 * s;
  const rx = Math.max(tw / 2 + 6, Math.min(videoW - tw / 2 - 6, b.imgPos.x));
  const ry = Math.max(thBox + 6, Math.min(videoH - 6, b.imgPos.y - 22 * s));

  return (
    <G>
      <Ellipse
        cx={b.imgPos.x}
        cy={b.imgPos.y}
        rx={rippleRadius * 1.4}
        ry={rippleRadius * 0.65}
        fill="none"
        stroke={hexWithAlpha(colHex, alpha * 0.85)}
        strokeWidth={Math.max(2.5 * s, 1.5)}
      />
      <Rect
        x={rx - tw / 2}
        y={ry - thBox}
        width={tw}
        height={thBox}
        rx={6 * s}
        fill={panelColorRgba(th, 0.85 * alpha)}
        stroke={hexWithAlpha(colHex, alpha)}
        strokeWidth={1.8}
      />
      <SvgText
        x={rx}
        y={ry - 7 * s}
        fill={hexWithAlpha(colHex, alpha)}
        fontSize={19 * s}
        fontWeight="bold"
        textAnchor="middle"
      >
        {label}
      </SvgText>
    </G>
  );
}

function renderShotCallout(
  callout: ActiveCalloutState,
  players: PlayerSnapshotItem[],
  hud: PickleballHudRenderer,
  videoW: number,
  videoH: number
) {
  const age = callout.ageSec;
  const fade = 0.3;
  const alpha = Math.max(
    0,
    Math.min(1, (PickleballRallyAnalyzer.CALLOUT_SECS - age) / fade)
  );
  if (alpha <= 0) return null;

  const s = hud.s;
  const x = callout.at.x;
  const y = callout.at.y;
  const meta = CALLOUT_INFO[callout.type];
  const text = meta.label;
  const colHex = meta.colorHex;
  const playerName =
    callout.playerIdx !== null ? players[callout.playerIdx]?.name : undefined;

  const tw = Math.max(180 * s, text.length * 24 * s);
  const thTotal = 54 * s + (playerName ? 24 * s : 0);
  let tx = x - 30 * s - tw;
  let ty = y - 26 * s - thTotal;
  if (tx < 12 * s) tx = x + 30 * s;
  if (tx + tw > videoW - 12 * s) tx = videoW - 12 * s - tw;
  if (ty < 12 * s) ty = y + 26 * s;
  if (ty + thTotal > videoH - 12 * s) ty = videoH - 12 * s - thTotal;

  const u = Math.min(1, age / 0.32);

  return (
    <G>
      {age < 0.32 &&
        Array.from({ length: 12 }, (_, k) => {
          const thAngle = (k / 12) * Math.PI * 2 + 0.2;
          const r0 = (18 + 28 * u) * s;
          const r1 = (30 + 60 * u) * s;
          return (
            <Line
              key={`ray-${k}`}
              x1={x + Math.cos(thAngle) * r0}
              y1={y + Math.sin(thAngle) * r0}
              x2={x + Math.cos(thAngle) * r1}
              y2={y + Math.sin(thAngle) * r1}
              stroke={hexWithAlpha(colHex, alpha * (1 - u))}
              strokeWidth={Math.max(1, 3 * s * (1 - u))}
            />
          );
        })}
      <G transform={`translate(${tx + tw / 2}, ${ty + 30 * s})`}>
        <SvgText
          x={0}
          y={0}
          fill={hexWithAlpha(colHex, alpha)}
          stroke={`rgba(8,18,40,${(0.9 * alpha).toFixed(2)})`}
          strokeWidth={5 * s}
          fontSize={38 * s}
          fontWeight="bold"
          textAnchor="middle"
        >
          {text}
        </SvgText>
        {playerName && (
          <SvgText
            x={0}
            y={28 * s}
            fill={`rgba(255,255,255,${alpha.toFixed(2)})`}
            stroke={`rgba(8,18,40,${(0.85 * alpha).toFixed(2)})`}
            strokeWidth={3.5 * s}
            fontSize={19 * s}
            fontWeight="bold"
            textAnchor="middle"
          >
            {playerName}
          </SvgText>
        )}
      </G>
    </G>
  );
}

function renderSpeedBadge(
  speedLabel: ActiveSpeedLabel,
  hud: PickleballHudRenderer,
  cfg: PickleballConfig,
  atVideoPt: Point2D | null
) {
  const rk = PickleballSpeedRanks.rankOf(
    speedLabel.speedKmh,
    cfg.render.badge.ranks
  );
  const secs = cfg.render.badge.secs;
  const alpha = Math.max(
    0,
    Math.min(1, 1 - Math.max(0, speedLabel.ageSec - secs) / BADGE_FADE)
  );
  if (alpha <= 0) return null;

  const sc = atVideoPt ? hud.s : hud.s * hud.scaleOf('speedBadge');
  const th = hud.theme;
  const h = BADGE_H * sc;
  const rb = 44 * sc;
  const skew = 8 * sc;
  const w = 195 * sc;

  let bx: number;
  let by: number;
  if (atVideoPt) {
    const x = atVideoPt.x;
    const y = atVideoPt.y;
    bx = x + 34 * sc;
    by = y - h - 30 * sc;
    if (bx + w > hud.videoW - 12 * sc) bx = x - 34 * sc - w;
    if (by < 12 * sc) by = y + 30 * sc;
    if (by + h > hud.videoH - 12 * sc) by = hud.videoH - 12 * sc - h;
  } else {
    const fixedRect = hud.rect('speedBadge');
    bx = fixedRect[0];
    by = fixedRect[1];
  }

  const badgeD = hud.buildFramePathD(bx, by, w, h, skew);
  const rkD = hud.buildFramePathD(bx, by, rb, h, hud.isAngled ? skew : 0);

  return (
    <G>
      {atVideoPt && (
        <Line
          x1={atVideoPt.x}
          y1={atVideoPt.y}
          x2={bx + (bx > atVideoPt.x ? 0 : w)}
          y2={by + h / 2}
          stroke={hexWithAlpha(rk.colorHex, alpha)}
          strokeWidth={1.5 * sc}
        />
      )}
      <Path
        d={badgeD}
        fill={panelColorRgba(th, 0.88 * alpha)}
        stroke={hexWithAlpha(rk.colorHex, 0.75 * alpha)}
        strokeWidth={1.5 * sc}
      />
      <Path d={rkD} fill={hexWithAlpha(rk.colorHex, alpha)} />
      <SvgText
        x={bx + rb / 2}
        y={by + h / 2 + 9 * sc}
        fill={`rgba(8,18,40,${alpha.toFixed(2)})`}
        fontSize={(rk.rank.length >= 3 ? 20 : 26) * sc}
        fontWeight="bold"
        textAnchor="middle"
      >
        {rk.rank}
      </SvgText>
      <SvgText
        x={bx + rb + 10 * sc}
        y={by + 30 * sc}
        fill={hexWithAlpha(th.textHex, alpha)}
        fontSize={29 * sc}
        fontWeight="bold"
      >
        {String(speedLabel.speedKmh)}
      </SvgText>
      <SvgText
        x={bx + rb + 62 * sc}
        y={by + 28 * sc}
        fill={hexWithAlpha(rk.colorHex, alpha)}
        fontSize={12 * sc}
        fontWeight="bold"
      >
        KM/H EST
      </SvgText>
      <SvgText
        x={bx + rb + 10 * sc}
        y={by + 44 * sc}
        fill={hexWithAlpha(rk.colorHex, alpha)}
        fontSize={12 * sc}
        fontWeight="bold"
      >
        {rk.name}
      </SvgText>
    </G>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#060E1B',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.45)',
  },
});

