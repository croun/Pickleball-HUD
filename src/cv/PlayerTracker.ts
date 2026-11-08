import { PickleballConfig, PlayerConfig, Point2D } from '../model/PickleballConfig';
import { boxIou, PoseDetection } from './ByteTracker';
import { PickleballCourt, PickleballCourtConstants } from './PickleballCourt';

const L_ANKLE = 15;
const R_ANKLE = 16;
const NET_SLACK = 0.55;
const APP_W = 10;
const APP_LEARN = 45;
const APP_VETO = 0.12;

export function fpsAlpha(a30: number, fps: number): number {
  return 1 - Math.pow(1 - a30, 30 / Math.max(fps, 1));
}

export interface RgbaImageBuffer {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray; // RGBA 4 bytes per pixel
}

/**
 * 16-bin shirt colour histogram of the torso (black, 3 greys, 12 HSV hues).
 */
export function torsoHist(
  image: RgbaImageBuffer | null | undefined,
  box: [number, number, number, number],
  fallbackHex?: string
): number[] | null {
  if (!image || !image.data || image.data.length < image.width * image.height * 4) {
    if (fallbackHex) return syntheticTorsoHistFromHex(fallbackHex);
    return null;
  }
  const [x1, y1, x2, y2] = box;
  const w = x2 - x1;
  const h = y2 - y1;
  const rx = Math.max(0, Math.min(image.width - 1, Math.round(x1 + 0.25 * w)));
  const ry = Math.max(0, Math.min(image.height - 1, Math.round(y1 + 0.18 * h)));
  const rw = Math.max(2, Math.min(image.width - rx, Math.round(0.5 * w)));
  const rh = Math.max(2, Math.min(image.height - ry, Math.round(0.32 * h)));
  if (rw <= 1 || rh <= 1) return null;

  const hist = new Array<number>(16).fill(0);
  let n = 0;
  for (let py = ry; py < ry + rh; py += 2) {
    for (let px = rx; px < rx + rw; px += 2) {
      const off = (py * image.width + px) * 4;
      const r = image.data[off];
      const g = image.data[off + 1];
      const b = image.data[off + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const v = mx / 255;
      const s = mx > 0 ? (mx - mn) / mx : 0;
      let bin = 0;
      if (v < 0.2) {
        bin = 0;
      } else if (s < 0.22) {
        bin = 1 + Math.min(2, Math.floor((v - 0.2) / 0.27));
      } else {
        const diff = mx - mn;
        let hh = 0;
        if (mx === r) hh = (g - b) / diff;
        else if (mx === g) hh = 2 + (b - r) / diff;
        else hh = 4 + (r - g) / diff;
        hh = (hh * 60 + 360) % 360;
        bin = 4 + Math.min(11, Math.floor(hh / 30));
      }
      hist[bin] += 1;
      n++;
    }
  }
  if (n === 0) return null;
  for (let k = 0; k < 16; k++) hist[k] /= n;
  return hist;
}

export function syntheticTorsoHistFromHex(hexColor: string): number[] {
  const clean = hexColor.replace('#', '');
  const num = parseInt(clean, 16) || 0x00e5ff;
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const diff = Math.max(1, mx - mn);
  let hh = 0;
  if (mx === r) hh = (g - b) / diff;
  else if (mx === g) hh = 2 + (b - r) / diff;
  else hh = 4 + (r - g) / diff;
  hh = (hh * 60 + 360) % 360;
  const mainBin = 4 + Math.min(11, Math.floor(hh / 30));
  const hist = new Array<number>(16).fill(0.01);
  hist[mainBin] = 0.85;
  return hist;
}

export function histSimilarity(a: number[], b: number[]): number {
  let s = 0;
  for (let k = 0; k < 16; k++) {
    s += Math.sqrt(Math.max(0, (a[k] ?? 0) * (b[k] ?? 0)));
  }
  return s;
}

export function footPoint(det: PoseDetection): Point2D {
  const [x1, y1, x2, y2] = det.box;
  let footX = (x1 + x2) / 2;
  let footY = y2;
  const k = det.kps;
  if (k && k.length >= 51) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const j of [L_ANKLE, R_ANKLE]) {
      if (k[j * 3 + 2] > 0.35) {
        xs.push(k[j * 3]);
        ys.push(k[j * 3 + 1]);
      }
    }
    if (xs.length > 0) {
      footX = xs.reduce((acc, v) => acc + v, 0) / xs.length;
      footY = Math.min(Math.max(...ys) + 0.02 * (y2 - y1), y2);
    }
  }
  return { x: footX, y: footY };
}

export function defaultAnchors(players: PlayerConfig[]): Point2D[] {
  const teams = Array.from(new Set(players.map((p, i) => p.team || String(i))));
  const groups = new Map<string, number[]>();
  players.forEach((p, i) => {
    const side =
      p.side ||
      (teams.indexOf(p.team || String(i)) % 2 === 0 ? 'far' : 'near');
    const arr = groups.get(side) ?? [];
    arr.push(i);
    groups.set(side, arr);
  });

  const anchors: Point2D[] = players.map(() => ({
    x: PickleballCourtConstants.COURT_W / 2,
    y: PickleballCourtConstants.NET_Y,
  }));

  for (const [side, idxs] of groups.entries()) {
    const y = PickleballCourtConstants.COURT_L * (side === 'far' ? 0.22 : 0.78);
    idxs.forEach((i, k) => {
      anchors[i] = {
        x: (PickleballCourtConstants.COURT_W * (k + 1)) / (idxs.length + 1),
        y,
      };
    });
  }
  return anchors;
}

export interface TrackedPlayerState {
  idx: number;
  name: string;
  color: string;
  team: 'A' | 'B';
  half: 0 | 1; // 0 = far, 1 = near
  app: number[] | null;
  appN: number;
  appSum: number[] | null;
  anchor: Point2D;
  pos: Point2D | null;
  head: Point2D | null;
  box: [number, number, number, number] | null;
  kps: number[] | null;
  trackId: number | null;
  visible: boolean;
  everSeen: boolean;
  lastSeen: number;
  inKitchen: boolean;
  atKitchenLine: boolean;
}

export interface PlayerSnapshotItem {
  idx: number;
  name: string;
  color: string;
  team: 'A' | 'B';
  trackId: number | null;
  pos: Point2D | null;
  head: Point2D | null;
  show: boolean;
  seen: boolean;
  kps: number[] | null;
  inKitchen: boolean;
  atKitchenLine: boolean;
}

export interface FrameSnapshot {
  t: number;
  players: PlayerSnapshotItem[];
  dist: number[];
  sta: number[];
  staFrac: number[];
  kitchenPct: number[];
  spd: (number | null)[];
  top: (number | null)[];
  rallyM: (number | null)[];
}

export interface BoxWithPlayer {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  playerIdx: number;
  courtX: number;
  courtY: number;
  inKitchen: boolean;
}

export class PlayerTracker {
  private readonly maxSpeed: number;
  private readonly maxJump: number;
  private readonly lostTtl: number;
  private readonly aPos: number;
  private readonly aTag: number;
  private readonly owner = new Map<number, number>(); // trackId -> playerIdx
  private readonly court: PickleballCourt;
  public readonly players: TrackedPlayerState[];

  constructor(
    cfg: PickleballConfig,
    court: PickleballCourt,
    fps: number,
    seeds: Record<number, Point2D> = {}
  ) {
    this.court = court;
    this.maxSpeed = cfg.tracking.maxSpeed;
    this.maxJump = cfg.tracking.maxJump;
    this.lostTtl = cfg.tracking.lostTtl;
    this.aPos = fpsAlpha(cfg.smoothing.posAlpha, fps);
    this.aTag = fpsAlpha(cfg.smoothing.tagAlpha, fps);

    const anchors = defaultAnchors(cfg.players);
    this.players = cfg.players.map((p, i) => {
      const seed = seeds[i] ?? p.seed ?? anchors[i];
      const side =
        p.side || (seed.y < PickleballCourtConstants.NET_Y ? 'far' : 'near');
      const histArr = p.hist && p.hist.length === 16 ? [...p.hist] : null;
      return {
        idx: i,
        name: p.name,
        color: p.color,
        team: p.team,
        half: side === 'far' ? 0 : 1,
        app: histArr,
        appN: histArr ? APP_LEARN : 0,
        appSum: null,
        anchor: seed,
        pos: null,
        head: null,
        box: null,
        kps: null,
        trackId: null,
        visible: false,
        everSeen: false,
        lastSeen: -1e9,
        inKitchen: false,
        atKitchenLine: false,
      };
    });
  }

  private dist(a: Point2D, b: Point2D): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private refPos(p: TrackedPlayerState): Point2D {
    return p.everSeen && p.pos ? p.pos : p.anchor;
  }

  private gate(p: TrackedPlayerState, t: number): number {
    return p.everSeen
      ? Math.min(this.maxJump + this.maxSpeed * Math.max(t - p.lastSeen, 0), 8)
      : 15;
  }

  private onSide(p: TrackedPlayerState, courtPt: Point2D): boolean {
    return p.half === 0
      ? courtPt.y < PickleballCourtConstants.NET_Y + NET_SLACK
      : courtPt.y > PickleballCourtConstants.NET_Y - NET_SLACK;
  }

  private sim(p: TrackedPlayerState, hist: number[] | null): number | null {
    return p.appN >= APP_LEARN && p.app && hist ? histSimilarity(p.app, hist) : null;
  }

  private vetoed(p: TrackedPlayerState, hist: number[] | null): boolean {
    const mine = this.sim(p, hist);
    if (mine === null) return false;
    return this.players.some(
      (q) => q !== p && q.half === p.half && (this.sim(q, hist) ?? -1) > mine + APP_VETO
    );
  }

  private cost(p: TrackedPlayerState, courtPt: Point2D, hist: number[] | null): number {
    let c = this.dist(courtPt, this.refPos(p));
    const s = this.sim(p, hist);
    if (s !== null) c += APP_W * (1 - s);
    return c;
  }

  update(
    tracks: PoseDetection[],
    t: number,
    frameBuffer?: RgbaImageBuffer | null
  ): TrackedPlayerState[] {
    const dets: {
      det: PoseDetection;
      foot: Point2D;
      courtPt: Point2D;
      hist: number[] | null;
    }[] = [];

    for (const d of tracks) {
      const foot = footPoint(d);
      const cPt = this.court.toCourt(foot);
      if (this.court.inPlay(cPt)) {
        const h = frameBuffer ? torsoHist(frameBuffer, d.box) : null;
        dets.push({ det: d, foot, courtPt: cPt, hist: h });
      }
    }

    const assigned = new Map<number, number>();
    const used = new Set<number>();

    // 1) Known track IDs
    const cands = new Map<number, { dd: number; di: number }>();
    dets.forEach((d, di) => {
      const pi = this.owner.get(d.det.tid);
      if (pi === undefined) return;
      const p = this.players[pi];
      const dd = p.everSeen && p.pos ? this.dist(d.courtPt, p.pos) : 0;
      const ok =
        this.onSide(p, d.courtPt) &&
        (!p.everSeen || dd <= this.gate(p, t)) &&
        !this.vetoed(p, d.hist);
      if (!ok) {
        this.owner.delete(d.det.tid);
        return;
      }
      const cur = cands.get(pi);
      if (!cur || dd < cur.dd) {
        cands.set(pi, { dd, di });
      }
    });
    for (const [pi, pair] of cands.entries()) {
      assigned.set(pi, pair.di);
      used.add(pair.di);
    }

    // 2) Greedy by court distance + shirt colour, same side only
    const pairs: { c: number; pi: number; di: number }[] = [];
    for (const p of this.players) {
      if (assigned.has(p.idx)) continue;
      dets.forEach((d, di) => {
        if (!used.has(di) && this.onSide(p, d.courtPt) && !this.vetoed(p, d.hist)) {
          pairs.push({ c: this.cost(p, d.courtPt, d.hist), pi: p.idx, di });
        }
      });
    }
    pairs.sort((a, b) => a.c - b.c);
    for (const pc of pairs) {
      const p = this.players[pc.pi];
      if (assigned.has(pc.pi) || used.has(pc.di)) continue;
      if (this.dist(dets[pc.di].courtPt, this.refPos(p)) > this.gate(p, t)) continue;
      assigned.set(pc.pi, pc.di);
      used.add(pc.di);
      const tid = dets[pc.di].det.tid;
      if (tid >= 0 && !this.owner.has(tid)) {
        this.owner.set(tid, pc.pi);
      }
    }

    for (const p of this.players) {
      const di = assigned.get(p.idx);
      if (di !== undefined) {
        this.applyDet(p, dets[di].det, dets[di].courtPt, t);
      } else {
        p.visible = false;
      }
    }

    // Learn shirt fingerprint once over 45 non-overlapping frames, then freeze
    for (const [pi, di] of assigned.entries()) {
      const p = this.players[pi];
      const d = dets[di];
      if (p.appN >= APP_LEARN || !d.hist) continue;
      const overlaps = dets.some(
        (other, oi) => oi !== di && boxIou(other.det.box, d.det.box) > 0.02
      );
      if (overlaps) continue;
      if (!p.appSum) p.appSum = new Array<number>(16).fill(0);
      for (let k = 0; k < 16; k++) p.appSum[k] += d.hist[k];
      p.appN++;
      if (p.appN === APP_LEARN) {
        p.app = p.appSum.map((v) => v / APP_LEARN);
      }
    }
    return this.players;
  }

  private applyDet(
    p: TrackedPlayerState,
    det: PoseDetection,
    courtPt: Point2D,
    t: number
  ): void {
    const head: Point2D = {
      x: (det.box[0] + det.box[2]) / 2,
      y: det.box[1],
    };
    if (!p.everSeen || !p.pos || !p.head || t - p.lastSeen > this.lostTtl * 2) {
      p.pos = courtPt;
      p.head = head;
    } else {
      p.pos = {
        x: p.pos.x + this.aPos * (courtPt.x - p.pos.x),
        y: p.pos.y + this.aPos * (courtPt.y - p.pos.y),
      };
      p.head = {
        x: p.head.x + this.aTag * (head.x - p.head.x),
        y: p.head.y + this.aTag * (head.y - p.head.y),
      };
    }
    p.inKitchen = this.court.isInKitchen(p.pos);
    p.atKitchenLine = this.court.isAtKitchenLine(p.pos);
    p.box = det.box;
    p.kps = det.kps ?? null;
    p.trackId = det.tid;
    p.visible = true;
    p.everSeen = true;
    p.lastSeen = t;
  }

  drawable(p: TrackedPlayerState, t: number): boolean {
    return p.everSeen && (p.visible || t - p.lastSeen <= this.lostTtl);
  }
}

/**
 * Tracks distance moved, gamified stamina, and Pickleball Kitchen (NVZ) line presence percentage.
 */
export class StatsTracker {
  private readonly start: number;
  private readonly drain: number;
  private readonly minSta: number;
  private readonly deadband: number;
  private readonly maxSpeed: number;
  private readonly dist: number[];
  private readonly anchorPos: (Point2D | null)[];
  private readonly anchorTime: number[];
  private readonly seenFrames: number[];
  private readonly kitchenFrames: number[];

  constructor(cfg: PickleballConfig, nPlayers: number) {
    this.start = cfg.stamina.start;
    this.drain = cfg.stamina.drainPerMeter;
    this.minSta = cfg.stamina.min;
    this.deadband = cfg.deadbandM;
    this.maxSpeed = cfg.tracking.maxSpeed;
    this.dist = new Array<number>(nPlayers).fill(0);
    this.anchorPos = new Array<Point2D | null>(nPlayers).fill(null);
    this.anchorTime = new Array<number>(nPlayers).fill(0);
    this.seenFrames = new Array<number>(nPlayers).fill(0);
    this.kitchenFrames = new Array<number>(nPlayers).fill(0);
  }

  update(players: TrackedPlayerState[], t: number): void {
    for (const p of players) {
      if (!p.visible || !p.pos) continue;
      const i = p.idx;
      this.seenFrames[i]++;
      if (p.atKitchenLine) this.kitchenFrames[i]++;

      const cur = p.pos;
      const prev = this.anchorPos[i];
      if (!prev) {
        this.anchorPos[i] = cur;
        this.anchorTime[i] = t;
        continue;
      }
      const step = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      if (step < this.deadband) continue;
      const dt = Math.max(t - this.anchorTime[i], 1e-3);
      if (step / dt <= this.maxSpeed) {
        this.dist[i] += step;
      }
      this.anchorPos[i] = cur;
      this.anchorTime[i] = t;
    }
  }

  distance(i: number): number {
    return this.dist[i] ?? 0;
  }

  stamina(i: number): number {
    const raw = this.start - this.drain * this.distance(i);
    return Math.max(this.minSta, Math.min(this.start, raw));
  }

  staminaFrac(i: number): number {
    return this.start > 0 ? this.stamina(i) / this.start : 0;
  }

  kitchenPct(i: number): number {
    const total = this.seenFrames[i] ?? 0;
    return total > 0 ? ((this.kitchenFrames[i] ?? 0) * 100) / total : 0;
  }
}

/**
 * Linearly interpolates player positions, heads, keypoints, and boxes between detected stride frames.
 */
export function interpolateBetween(
  snaps: FrameSnapshot[],
  boxes: BoxWithPlayer[][],
  stride: number,
  court: PickleballCourt
): void {
  if (stride <= 1) return;
  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
  const lerpPt = (a: Point2D, b: Point2D, f: number): Point2D => ({
    x: lerp(a.x, b.x, f),
    y: lerp(a.y, b.y, f),
  });

  let a = 0;
  while (a + stride < snaps.length) {
    const b = a + stride;
    snaps[a].players.forEach((pa, pi) => {
      const pb = snaps[b].players[pi];
      if (!pb) return;
      for (let i = a + 1; i < b; i++) {
        const p = snaps[i].players[pi];
        const f = (i - a) / stride;
        if (pa.pos && pb.pos) p.pos = lerpPt(pa.pos, pb.pos, f);
        if (pa.head && pb.head) p.head = lerpPt(pa.head, pb.head, f);
        if (pa.kps && pb.kps && pa.kps.length === pb.kps.length) {
          p.kps = pa.kps.map((v, k) => lerp(v, pb.kps![k], f));
        }
      }
    });

    for (const ba of boxes[a]) {
      const bb = boxes[b].find((item) => item.playerIdx === ba.playerIdx);
      if (!bb) continue;
      for (let i = a + 1; i < b; i++) {
        const f = (i - a) / stride;
        const cx = lerp(ba.courtX, bb.courtX, f);
        const cy = lerp(ba.courtY, bb.courtY, f);
        const interpBox: BoxWithPlayer = {
          x1: lerp(ba.x1, bb.x1, f),
          y1: lerp(ba.y1, bb.y1, f),
          x2: lerp(ba.x2, bb.x2, f),
          y2: lerp(ba.y2, bb.y2, f),
          playerIdx: ba.playerIdx,
          courtX: cx,
          courtY: cy,
          inKitchen: court.isInKitchen({ x: cx, y: cy }),
        };
        const existingIdx = boxes[i].findIndex((item) => item.playerIdx === ba.playerIdx);
        if (existingIdx >= 0) boxes[i][existingIdx] = interpBox;
        else boxes[i].push(interpBox);
      }
    }
    a += stride;
  }
}

export interface PlayerMetricSummary {
  distanceM: number;
  avgSpeedMs: number;
  topSpeedMs: number;
  seenFraction: number;
  kitchenPct: number;
}

export interface RallySpan {
  start: number;
  end: number;
}

export interface MetricsResult {
  players: PlayerMetricSummary[];
  spans: RallySpan[];
}

export function computePlayerMetrics(
  snaps: FrameSnapshot[],
  rallySpans: RallySpan[],
  fps: number,
  maxSpeed: number = 7.0
): MetricsResult {
  const nFrames = snaps.length;
  const nPlayers = snaps[0]?.players.length ?? 0;
  const h = Math.max(1, Math.round(0.25 * fps));
  const spans = rallySpans.map((s) => ({
    start: s.start,
    end: Math.min(s.end, nFrames - 1),
  }));

  for (const s of snaps) {
    s.spd = new Array<number | null>(nPlayers).fill(null);
    s.top = new Array<number | null>(nPlayers).fill(null);
    s.rallyM = new Array<number | null>(nPlayers).fill(null);
  }

  const summaries: PlayerMetricSummary[] = [];
  for (let i = 0; i < nPlayers; i++) {
    let held: number | null = null;
    let top = 0;
    let seen = 0;
    let kitchenCount = 0;
    for (let f = 0; f < nFrames; f++) {
      const a = snaps[Math.max(0, f - h)];
      const b = snaps[Math.min(nFrames - 1, f + h)];
      const pa = a.players[i];
      const pb = b.players[i];
      const pf = snaps[f].players[i];
      if (pf.seen) {
        seen++;
        if (pf.atKitchenLine) kitchenCount++;
      }
      if (pa.seen && pb.seen && pa.pos && pb.pos && b.t > a.t) {
        const v = Math.hypot(pb.pos.x - pa.pos.x, pb.pos.y - pa.pos.y) / (b.t - a.t);
        if (v <= maxSpeed) {
          held = v;
          top = Math.max(top, v);
        }
      }
      snaps[f].spd[i] = held;
      snaps[f].top[i] = held === null ? null : top;
    }

    let k = -1;
    for (let f = 0; f < nFrames; f++) {
      while (k + 1 < spans.length && f >= spans[k + 1].start) k++;
      if (k < 0) continue;
      const stop = Math.min(f, spans[k].end);
      snaps[f].rallyM[i] = Math.max(0, snaps[stop].dist[i] - snaps[spans[k].start].dist[i]);
    }
    const dur = nFrames > 1 ? snaps[nFrames - 1].t - snaps[0].t : 0;
    const totalDist = snaps[nFrames - 1]?.dist[i] ?? 0;
    summaries.push({
      distanceM: totalDist,
      avgSpeedMs: dur > 0 ? totalDist / dur : 0,
      topSpeedMs: top,
      seenFraction: nFrames > 0 ? seen / nFrames : 0,
      kitchenPct: seen > 0 ? (kitchenCount * 100) / seen : 0,
    });
  }
  return { players: summaries, spans };
}

export function trailsAt(
  snaps: FrameSnapshot[],
  frameIdx: number,
  fps: number,
  secs: number = 1.5
): (Point2D | null)[][] {
  const n = Math.round(secs * fps);
  const step = Math.max(1, Math.round(fps / 10));
  const nPlayers = snaps[frameIdx]?.players.length ?? 0;
  return Array.from({ length: nPlayers }, (_, i) => {
    const pts: (Point2D | null)[] = [];
    for (let k = Math.max(0, frameIdx - n); k <= frameIdx; k += step) {
      const p = snaps[k].players[i];
      pts.push(p.seen && p.pos ? p.pos : null);
    }
    return pts;
  });
}

export interface HeatmapGrid {
  grid: number[];
  nx: number;
  ny: number;
  cell: number;
  margin: number;
}

export function positionGrid(
  snaps: FrameSnapshot[],
  playerIdx: number,
  spans?: RallySpan[] | null,
  cell: number = 0.25,
  margin: number = 1.0
): HeatmapGrid {
  const w = PickleballCourtConstants.COURT_W;
  const l = PickleballCourtConstants.COURT_L;
  const nx = Math.ceil((w + 2 * margin) / cell);
  const ny = Math.ceil((l + 2 * margin) / cell);
  const grid = new Array<number>(nx * ny).fill(0);

  const addFrame = (f: number) => {
    const p = snaps[f]?.players[playerIdx];
    if (!p || !p.pos || !p.seen) return;
    const x = Math.floor((p.pos.x + margin) / cell);
    const y = Math.floor((p.pos.y + margin) / cell);
    if (x >= 0 && x < nx && y >= 0 && y < ny) {
      grid[y * nx + x] += 1;
    }
  };

  if (spans && spans.length > 0) {
    for (const s of spans) {
      for (let f = s.start; f <= Math.min(s.end, snaps.length - 1); f++) {
        addFrame(f);
      }
    }
  } else {
    for (let f = 0; f < snaps.length; f++) {
      addFrame(f);
    }
  }
  return { grid, nx, ny, cell, margin };
}

