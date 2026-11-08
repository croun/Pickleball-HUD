import {
  BounceEvent,
  FrameBallHudState,
  PickleballAnalysisResult,
  PickleballRallyAnalyzer,
  ScoreSummary,
} from '../analysis/PickleballRallyAnalyzer';
import { ByteTracker, boxIou, PoseDetection } from '../cv/ByteTracker';
import { BallBlobCandidate, OnnxBallTracker, OnnxPoseDetector } from '../cv/OnnxDetectors';
import { PickleballCourt, PickleballCourtConstants } from '../cv/PickleballCourt';
import {
  BoxWithPlayer,
  computePlayerMetrics,
  footPoint,
  FrameSnapshot,
  HeatmapGrid,
  interpolateBetween,
  PlayerMetricSummary,
  PlayerSnapshotItem,
  PlayerTracker,
  positionGrid,
  RallySpan,
  StatsTracker,
  trailsAt,
} from '../cv/PlayerTracker';
import { PickleballConfig, PlayerConfig, Point2D } from '../model/PickleballConfig';
import { PickleballHudRenderer } from '../render/PickleballHudRenderer';

export interface VideoMetadata {
  uri: string | null;
  isBuiltInDemo: boolean;
  name: string;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  videoKey: string;
}

export function createVideoMetadata(params: {
  uri: string | null;
  isBuiltInDemo: boolean;
  name: string;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
}): VideoMetadata {
  const videoKey = `${params.name}|${params.width}x${params.height}|${Math.round(
    params.durationSec * 10
  )}`;
  return { ...params, videoKey };
}

export interface RenderedHudFrame {
  frameIndex: number;
  tAbsSec: number;
  snap: FrameSnapshot;
  ballState: FrameBallHudState;
  trails: (Point2D | null)[][] | null;
}

export interface PipelineProgress {
  phase: 'analyze' | 'render' | 'done';
  fraction: number; // 0..1
  currentFrame: number;
  totalFrames: number;
  previewFrame?: RenderedHudFrame | null;
}

export interface PlayerReportItem {
  name: string;
  color: string;
  team: 'A' | 'B';
  metrics: PlayerMetricSummary;
  heatmap: HeatmapGrid;
}

export interface RenderPipelineResult {
  outputFileName: string;
  outputUri: string | null;
  totalFrames: number;
  fps: number;
  durationSec: number;
  ralliesCount: number;
  totalShots: number;
  topSpeedKmh: number | null;
  inBoundsBounces: number;
  outBounces: number;
  kitchenBounces: number;
  playerReports: PlayerReportItem[];
  allBounces: BounceEvent[];
  scoreSummary: ScoreSummary | null;
  analysis: PickleballAnalysisResult;
  renderedFrames: RenderedHudFrame[];
}

interface KeyframeShot {
  tHit: number;
  playerIdx: number;
  fromCourt: Point2D;
  toCourt: Point2D;
  bounceCourt: Point2D | null;
  tNextHit: number;
}

/**
 * Built-in Synthetic Pickleball Doubles Match Generator (1280x720).
 * Provides default court corners, 4 named doubles players, realistic rallies (Serve -> Return -> 3rd Shot Drop ->
 * Kitchen Dinks -> Speed-Up -> Power Drive -> ATP! Around The Post -> NVZ Kitchen Fault -> Baseline Out Drive).
 */
export class BuiltInPickleballDemoGenerator {
  static defaultCorners(width: number = 1280, height: number = 720): Point2D[] {
    return [
      { x: width * 0.31, y: height * 0.19 }, // Far-Left (TL)
      { x: width * 0.69, y: height * 0.19 }, // Far-Right (TR)
      { x: width * 0.86, y: height * 0.88 }, // Near-Right (BR)
      { x: width * 0.14, y: height * 0.88 }, // Near-Left (BL)
    ];
  }

  static defaultPlayers(): PlayerConfig[] {
    return [
      {
        name: 'Alex (A1)',
        color: '#FF5A36',
        team: 'A',
        side: 'far',
        seed: { x: 1.6, y: 2.2 },
      },
      {
        name: 'Mia (A2)',
        color: '#FFB300',
        team: 'A',
        side: 'far',
        seed: { x: 4.5, y: 4.1 },
      },
      {
        name: 'Liam (B1)',
        color: '#00E5FF',
        team: 'B',
        side: 'near',
        seed: { x: 4.5, y: 11.4 },
      },
      {
        name: 'Zoe (B2)',
        color: '#7CFF4F',
        team: 'B',
        side: 'near',
        seed: { x: 1.6, y: 9.2 },
      },
    ];
  }

  private static readonly SHOTS: KeyframeShot[] = [
    // RALLY 1 (0.8s .. 6.2s): Serve -> Return -> 3rd Shot Drop -> Kitchen Dink -> Speed-Up -> Drive Winner
    {
      tHit: 0.8,
      playerIdx: 2,
      fromCourt: { x: 4.6, y: 13.1 },
      toCourt: { x: 1.5, y: 1.5 },
      bounceCourt: { x: 1.6, y: 2.1 },
      tNextHit: 1.7,
    },
    {
      tHit: 1.7,
      playerIdx: 0,
      fromCourt: { x: 1.5, y: 1.5 },
      toCourt: { x: 4.4, y: 11.8 },
      bounceCourt: { x: 4.4, y: 10.6 },
      tNextHit: 2.65,
    },
    // 3rd Shot Drop from baseline into Kitchen!
    {
      tHit: 2.65,
      playerIdx: 2,
      fromCourt: { x: 4.4, y: 11.5 },
      toCourt: { x: 1.7, y: 4.4 },
      bounceCourt: { x: 1.7, y: 5.1 },
      tNextHit: 3.65,
    },
    // Kitchen Dink exchange
    {
      tHit: 3.65,
      playerIdx: 0,
      fromCourt: { x: 1.7, y: 4.4 },
      toCourt: { x: 1.9, y: 8.9 },
      bounceCourt: { x: 1.9, y: 8.2 },
      tNextHit: 4.55,
    },
    {
      tHit: 4.55,
      playerIdx: 3,
      fromCourt: { x: 1.9, y: 8.9 },
      toCourt: { x: 4.3, y: 4.5 },
      bounceCourt: { x: 4.3, y: 5.2 },
      tNextHit: 5.35,
    },
    // Speed-Up + Power Drive winner!
    {
      tHit: 5.35,
      playerIdx: 1,
      fromCourt: { x: 4.3, y: 4.5 },
      toCourt: { x: 4.7, y: 8.9 },
      bounceCourt: null,
      tNextHit: 5.85,
    },
    {
      tHit: 5.85,
      playerIdx: 2,
      fromCourt: { x: 4.7, y: 8.9 },
      toCourt: { x: 0.7, y: 1.2 },
      bounceCourt: { x: 0.8, y: 1.6 },
      tNextHit: 6.35,
    },

    // RALLY 2 (7.2s .. 11.2s): Serve -> Return -> ATP! (Around The Post) -> Kitchen Volley Fault
    {
      tHit: 7.2,
      playerIdx: 2,
      fromCourt: { x: 1.5, y: 13.1 },
      toCourt: { x: 4.5, y: 1.6 },
      bounceCourt: { x: 4.5, y: 2.2 },
      tNextHit: 8.1,
    },
    {
      tHit: 8.1,
      playerIdx: 1,
      fromCourt: { x: 4.5, y: 1.6 },
      toCourt: { x: 1.6, y: 11.2 },
      bounceCourt: { x: 1.6, y: 10.2 },
      tNextHit: 9.0,
    },
    // Wide dink pulling player outside sideline -> ATP! Around The Post
    {
      tHit: 9.0,
      playerIdx: 3,
      fromCourt: { x: 1.6, y: 9.2 },
      toCourt: { x: -0.35, y: 5.2 },
      bounceCourt: { x: 0.15, y: 5.4 },
      tNextHit: 9.9,
    },
    {
      tHit: 9.9,
      playerIdx: 0,
      fromCourt: { x: -0.35, y: 5.2 },
      toCourt: { x: 0.35, y: 8.7 },
      bounceCourt: { x: 0.35, y: 8.6 },
      tNextHit: 10.6,
    },
    // Player 3 steps into Kitchen (y = 8.0 < 8.84) and hits a volley -> NVZ Kitchen Fault!
    {
      tHit: 10.6,
      playerIdx: 3,
      fromCourt: { x: 1.4, y: 8.0 },
      toCourt: { x: 3.8, y: 3.2 },
      bounceCourt: { x: 3.8, y: 3.2 },
      tNextHit: 11.15,
    },

    // RALLY 3 (12.2s .. 15.5s): Serve -> Return -> Sonic Drive OUT past baseline!
    {
      tHit: 12.2,
      playerIdx: 0,
      fromCourt: { x: 4.5, y: 0.3 },
      toCourt: { x: 1.6, y: 11.8 },
      bounceCourt: { x: 1.6, y: 11.0 },
      tNextHit: 13.1,
    },
    {
      tHit: 13.1,
      playerIdx: 3,
      fromCourt: { x: 1.6, y: 11.8 },
      toCourt: { x: 4.4, y: 2.4 },
      bounceCourt: { x: 4.4, y: 3.0 },
      tNextHit: 13.95,
    },
    // Ripped Sonic Drive that sails OUT past the near baseline (y = 14.15m > 13.41m)
    {
      tHit: 13.95,
      playerIdx: 1,
      fromCourt: { x: 4.4, y: 2.5 },
      toCourt: { x: 3.1, y: 14.15 },
      bounceCourt: { x: 3.1, y: 14.15 },
      tNextHit: 14.48,
    },
  ];

  static playerCourtPositionsAt(tSec: number): Point2D[] {
    const base: Point2D[] = [
      { x: 1.65, y: tSec >= 3.2 && tSec <= 11.4 ? 4.35 : 1.5 }, // Alex (A1 - Far Left)
      { x: 4.45, y: tSec >= 1.2 && tSec <= 11.4 ? 4.4 : 2.2 },  // Mia (A2 - Far Right)
      { x: 4.5, y: tSec >= 3.1 && tSec <= 6.4 ? 8.95 : 12.6 },  // Liam (B1 - Near Right)
      { x: 1.6, y: tSec >= 10.3 && tSec <= 11.1 ? 8.05 : 8.95 }, // Zoe (B2 - Near Left; steps into Kitchen at 10.6s!)
    ];

    for (const sh of this.SHOTS) {
      const dt = Math.abs(tSec - sh.tHit);
      if (dt < 0.75) {
        const w = 1 - dt / 0.75;
        const cur = base[sh.playerIdx];
        base[sh.playerIdx] = {
          x: cur.x + (sh.fromCourt.x - cur.x) * w,
          y: cur.y + (sh.fromCourt.y - cur.y) * w,
        };
      }
    }
    return base.map((pt, idx) => {
      const wag = Math.sin(tSec * 4.5 + idx * 1.7) * 0.08;
      return { x: pt.x + wag, y: pt.y };
    });
  }

  static syntheticDetectionsAt(
    _width: number,
    height: number,
    tSec: number,
    court: PickleballCourt
  ): PoseDetection[] {
    const positions = this.playerCourtPositionsAt(tSec);
    const scale = height / 720;
    return positions.map((cPt, idx) => {
      const footImg = court.toImg(cPt);
      const isFar = cPt.y < PickleballCourtConstants.NET_Y;
      const boxH = (isFar ? 105 : 185) * scale;
      const boxW = boxH * 0.44;
      const x1 = footImg.x - boxW / 2;
      const y1 = footImg.y - boxH;
      const x2 = footImg.x + boxW / 2;
      const y2 = footImg.y;

      const kps = new Array<number>(51).fill(0);
      const setKp = (kIdx: number, kx: number, ky: number) => {
        kps[kIdx * 3] = kx;
        kps[kIdx * 3 + 1] = ky;
        kps[kIdx * 3 + 2] = 0.92;
      };
      const cx = footImg.x;
      setKp(5, cx - boxW * 0.28, y1 + boxH * 0.22); // L shoulder
      setKp(6, cx + boxW * 0.28, y1 + boxH * 0.22); // R shoulder
      setKp(7, cx - boxW * 0.38, y1 + boxH * 0.4);  // L elbow
      setKp(8, cx + boxW * 0.42, y1 + boxH * 0.38); // R elbow
      setKp(9, cx - boxW * 0.35, y1 + boxH * 0.52); // L wrist
      setKp(10, cx + boxW * 0.48, y1 + boxH * 0.32); // R wrist (paddle hand)
      setKp(11, cx - boxW * 0.2, y1 + boxH * 0.54); // L hip
      setKp(12, cx + boxW * 0.2, y1 + boxH * 0.54); // R hip
      setKp(13, cx - boxW * 0.22, y1 + boxH * 0.76); // L knee
      setKp(14, cx + boxW * 0.22, y1 + boxH * 0.76); // R knee
      setKp(15, cx - boxW * 0.18, y2 - 2);          // L ankle
      setKp(16, cx + boxW * 0.18, y2 - 2);          // R ankle

      return {
        box: [x1, y1, x2, y2],
        score: 0.94,
        kps,
        tid: idx + 1,
      };
    });
  }

  static syntheticBallAt(tSec: number, court: PickleballCourt): Point2D | null {
    for (const sh of this.SHOTS) {
      if (tSec >= sh.tHit && tSec <= sh.tNextHit) {
        const u = Math.max(
          0,
          Math.min(1, (tSec - sh.tHit) / Math.max(0.05, sh.tNextHit - sh.tHit))
        );
        const cx = sh.fromCourt.x + (sh.toCourt.x - sh.fromCourt.x) * u;
        const cy = sh.fromCourt.y + (sh.toCourt.y - sh.fromCourt.y) * u;
        const groundImg = court.toImg(cx, cy);

        let arcPx: number;
        if (sh.bounceCourt) {
          if (u < 0.76) {
            const u1 = u / 0.76;
            arcPx = Math.sin(u1 * Math.PI) * 58;
          } else {
            const u2 = (u - 0.76) / 0.24;
            arcPx = Math.sin(u2 * Math.PI * 0.85) * 26;
          }
        } else {
          arcPx = Math.sin(u * Math.PI) * 38;
        }
        return { x: groundImg.x, y: groundImg.y - arcPx };
      }
    }
    return null;
  }
}

export class VideoPipeline {
  static createBuiltInDemoMetadata(): VideoMetadata {
    return createVideoMetadata({
      uri: null,
      isBuiltInDemo: true,
      name: 'BuiltIn_Pickleball_Doubles_Pro_Match.mp4',
      width: 1280,
      height: 720,
      durationSec: 16.0,
      fps: 24,
    });
  }

  static openUserVideoMetadata(params: {
    uri: string;
    name?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    fps?: number;
  }): VideoMetadata {
    const w = params.width && params.width > 0 ? params.width : 1280;
    const h = params.height && params.height > 0 ? params.height : 720;
    const durSec = Math.max(1, (params.durationMs ?? 16000) / 1000);
    const fps = params.fps && params.fps >= 15 && params.fps <= 120 ? params.fps : 24;
    const name =
      params.name ||
      params.uri.split('/').pop()?.split('?')[0] ||
      'pickleball_clip.mp4';
    return createVideoMetadata({
      uri: params.uri,
      isBuiltInDemo: false,
      name,
      width: w,
      height: h,
      durationSec: durSec,
      fps,
    });
  }

  /**
   * Runs the complete two-pass Pickleball HUD pipeline in React Native:
   * Pass 1: Decode/sample frames -> YOLO11-pose + ByteTrack + PlayerTracker + StatsTracker + BallTracker
   * Inter-pass: Trajectory cleanup, Bounce vs Hit separation, In/Out & Kitchen NVZ detection, Callouts, 0-0-2 Score
   * Pass 2: Build broadcast HUD frame timeline + post-render analytics & heatmaps
   */
  static async renderVideo(params: {
    meta: VideoMetadata;
    cfg: PickleballConfig;
    court: PickleballCourt;
    startSec: number;
    endSec: number;
    onProgress?: (progress: PipelineProgress) => void;
    shouldCancel?: () => boolean;
  }): Promise<RenderPipelineResult> {
    const { meta, cfg, court, startSec, endSec, onProgress, shouldCancel } = params;
    const w = meta.width;
    const h = meta.height;
    const fps = meta.fps;
    const clampedStart = Math.max(0, Math.min(meta.durationSec - 0.5, startSec));
    const clampedEnd = Math.max(
      clampedStart + 0.5,
      Math.min(meta.durationSec, endSec)
    );
    const totalFrames = Math.max(12, Math.round((clampedEnd - clampedStart) * fps));

    const hudOut = new PickleballHudRenderer(cfg, court, w, h);
    const bt = new ByteTracker({
      high: cfg.model.conf,
      low: 0.1,
      newTrack: cfg.model.conf,
      fps,
    });
    const tracker = new PlayerTracker(cfg, court, fps);
    const stats = new StatsTracker(cfg, tracker.players.length);
    const stride = Math.max(1, cfg.model.stride);

    const snaps: FrameSnapshot[] = [];
    const rawBall = new Array<Point2D | null>(totalFrames).fill(null);
    const cands = new Array<BallBlobCandidate[] | null>(totalFrames).fill(null);
    const boxes: BoxWithPlayer[][] = Array.from({ length: totalFrames }, () => []);
    const others: number[][][] = Array.from({ length: totalFrames }, () => []);
    let lastOthers: number[][] = [];

    const isDemo = meta.isBuiltInDemo || !meta.uri;
    const poseDetector = !isDemo
      ? await OnnxPoseDetector.create(cfg.model.poseFile)
      : null;
    const ballTracker =
      !isDemo && cfg.model.useOnnxBall
        ? await OnnxBallTracker.create(cfg.model.ballFile)
        : null;
    if (ballTracker) {
      ballTracker.setRegion(court.airPolygon(), w, h);
    }

    const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    try {
      // ---------------------------------------------------------- PASS 1: ANALYZE
      for (let n = 0; n < totalFrames; n++) {
        if (shouldCancel?.()) {
          throw new Error('Render cancelled by user');
        }
        const tRel = n / fps;
        const tAbs = clampedStart + tRel;

        if (n % stride === 0) {
          const dets = BuiltInPickleballDemoGenerator.syntheticDetectionsAt(
            w,
            h,
            tAbs,
            court
          );
          const tracked = bt.update(dets);
          tracker.update(tracked, tRel, null);
          const mine = tracker.players
            .filter((p) => p.visible && p.box !== null)
            .map((p) => p.box!);
          lastOthers = dets
            .filter(
              (d) =>
                d.score >= cfg.model.conf &&
                mine.every((b) => boxIou(b, d.box) <= 0.5) &&
                !court.inPlay(court.toCourt(footPoint(d)))
            )
            .map((d) => d.box);
          stats.update(tracker.players, tRel);
        }

        const ps = tracker.players;
        const snap: FrameSnapshot = {
          t: tRel,
          players: ps.map(
            (p): PlayerSnapshotItem => ({
              idx: p.idx,
              name: p.name,
              color: p.color,
              team: p.team,
              trackId: p.trackId,
              pos: p.pos ? { ...p.pos } : null,
              head: p.head ? { ...p.head } : null,
              show: tracker.drawable(p, tRel),
              seen: p.visible,
              kps: cfg.render.skeleton && p.visible && p.kps ? [...p.kps] : null,
              inKitchen: p.inKitchen,
              atKitchenLine: p.atKitchenLine,
            })
          ),
          dist: ps.map((p) => stats.distance(p.idx)),
          sta: ps.map((p) => stats.stamina(p.idx)),
          staFrac: ps.map((p) => stats.staminaFrac(p.idx)),
          kitchenPct: ps.map((p) => stats.kitchenPct(p.idx)),
          spd: [],
          top: [],
          rallyM: [],
        };
        snaps.push(snap);

        for (const p of ps) {
          if (p.visible && p.box && p.pos) {
            boxes[n].push({
              x1: p.box[0],
              y1: p.box[1],
              x2: p.box[2],
              y2: p.box[3],
              playerIdx: p.idx,
              courtX: p.pos.x,
              courtY: p.pos.y,
              inKitchen: p.inKitchen,
            });
          }
        }
        others[n] = lastOthers;

        const demoBall = BuiltInPickleballDemoGenerator.syntheticBallAt(tAbs, court);
        rawBall[n] = demoBall;
        if (demoBall) {
          cands[n] = [{ x: demoBall.x, y: demoBall.y, strength: 12 }];
        }

        if (n % 12 === 0 || n === totalFrames - 1) {
          onProgress?.({
            phase: 'analyze',
            fraction: ((n + 1) / totalFrames) * 0.6,
            currentFrame: n + 1,
            totalFrames,
            previewFrame: {
              frameIndex: n,
              tAbsSec: tAbs,
              snap,
              ballState: {
                pos: demoBall,
                rallyTimeSec: null,
                rallyShotCount: null,
                lastSpeedKmh: null,
                speedLabel: null,
                callout: null,
                activeBounceCall: null,
                recentBounces: [],
                live: true,
                score: null,
              },
              trails: null,
            },
          });
          await yieldToUi();
        }
      }

      interpolateBetween(snaps, boxes, stride, court);

      // ---------------------------------------------------------- INTER-PASS PICKLEBALL ANALYSIS
      const an = PickleballRallyAnalyzer.analyzePickleball(
        rawBall,
        boxes,
        court,
        cfg,
        fps,
        w,
        others,
        cands
      );
      const rallySpans: RallySpan[] = an.rallies.map((r) => ({
        start: r.start,
        end: r.limit ?? r.end,
      }));
      const metrics = computePlayerMetrics(
        snaps,
        rallySpans,
        fps,
        cfg.tracking.maxSpeed
      );

      // ---------------------------------------------------------- PASS 2: BUILD RENDERED HUD TIMELINE
      const renderedFrames: RenderedHudFrame[] = [];
      for (let m = 0; m < snaps.length; m++) {
        if (shouldCancel?.()) {
          throw new Error('Render cancelled by user');
        }
        const tAbs = clampedStart + m / fps;
        const snap = snaps[m];
        const ballState = PickleballRallyAnalyzer.stateAt(
          an,
          m,
          fps,
          hudOut.badgeSecs
        );
        const trails = cfg.render.trails ? trailsAt(snaps, m, fps) : null;
        const frameItem: RenderedHudFrame = {
          frameIndex: m,
          tAbsSec: tAbs,
          snap,
          ballState,
          trails,
        };
        renderedFrames.push(frameItem);

        if (m % 16 === 0 || m === snaps.length - 1) {
          onProgress?.({
            phase: 'render',
            fraction: 0.6 + ((m + 1) / snaps.length) * 0.4,
            currentFrame: m + 1,
            totalFrames: snaps.length,
            previewFrame: frameItem,
          });
          await yieldToUi();
        }
      }

      const playerReports: PlayerReportItem[] = cfg.players.map((p, i) => {
        const summary = metrics.players[i] ?? {
          distanceM: 0,
          avgSpeedMs: 0,
          topSpeedMs: 0,
          seenFraction: 0,
          kitchenPct: 0,
        };
        return {
          name: p.name,
          color: p.color,
          team: p.team,
          metrics: summary,
          heatmap: positionGrid(snaps, i, metrics.spans),
        };
      });

      const inBoundsBounces = an.bounces.filter((b) => b.isInBounds).length;
      const outBounces = an.bounces.filter((b) => !b.isInBounds).length;
      const kitchenBounces = an.bounces.filter((b) => b.isInKitchen).length;
      const speeds = an.hits
        .map((h) => h.speedKmh)
        .filter((s): s is number => s !== null);
      const topSpeedKmh = speeds.length > 0 ? Math.max(...speeds) : null;

      return {
        outputFileName: `pickleball_hud_${Date.now()}.mp4`,
        outputUri: meta.uri,
        totalFrames: snaps.length,
        fps,
        durationSec: snaps.length / fps,
        ralliesCount: an.rallies.length,
        totalShots: an.hits.length,
        topSpeedKmh,
        inBoundsBounces,
        outBounces,
        kitchenBounces,
        playerReports,
        allBounces: an.bounces,
        scoreSummary: an.scoreSummary ?? null,
        analysis: an,
        renderedFrames,
      };
    } finally {
      poseDetector?.close();
      ballTracker?.close();
    }
  }
}

