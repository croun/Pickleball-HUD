import { BallBlobCandidate } from '../cv/OnnxDetectors';
import { PickleballCourt, PickleballCourtConstants } from '../cv/PickleballCourt';
import { BoxWithPlayer } from '../cv/PlayerTracker';
import { CalloutType, PickleballConfig, Point2D, ScoringMode } from '../model/PickleballConfig';

export interface HitEvent {
  frame: number;
  player: number | null;
  court: Point2D | null;
  reach: number;
  speedKmh: number | null;
  far: boolean | null;
  inferred: boolean;
  guessed: boolean;
  callout: CalloutType | null;
  bouncedBeforeHit: boolean;
}

export function createHitEvent(partial: Partial<HitEvent> & { frame: number }): HitEvent {
  return {
    frame: partial.frame,
    player: partial.player ?? null,
    court: partial.court ?? null,
    reach: partial.reach ?? Number.POSITIVE_INFINITY,
    speedKmh: partial.speedKmh ?? null,
    far: partial.far ?? null,
    inferred: partial.inferred ?? false,
    guessed: partial.guessed ?? false,
    callout: partial.callout ?? null,
    bouncedBeforeHit: partial.bouncedBeforeHit ?? true,
  };
}

export interface BounceEvent {
  frame: number;
  imgPos: Point2D;
  courtPos: Point2D;
  isInBounds: boolean;
  isInKitchen: boolean;
  rallyIdx: number;
}

export interface ServeEvent {
  frame: number;
  quietStart: number;
  quietEnd: number;
  box: 'R' | 'L' | null;
}

export interface RallySegment {
  start: number;
  end: number;
  limit: number | null;
  hits: HitEvent[];
  bounces: BounceEvent[];
  serve: HitEvent | null;
  box: 'R' | 'L' | null;
  byServe: boolean;
}

export interface ScoreFrameEntry {
  frame: number;
  scoreA: number;
  scoreB: number;
  servingTeam: 'A' | 'B';
  serverNum: number;
  displayScore: string;
  eventNote?: string | null;
}

export interface ScoreRow {
  rallyIndex: number;
  frame: number;
  winner: 'A' | 'B' | null;
  scoreA: number;
  scoreB: number;
  servingTeam: 'A' | 'B';
  serverNum: number;
  displayScore: string;
  evidence: string | null;
  outcomeNote: string;
}

export interface ScoreSummary {
  rows: ScoreRow[];
  timeline: ScoreFrameEntry[];
  finalA: number;
  finalB: number;
  finalDisplay: string;
}

export interface PickleballAnalysisResult {
  pos: (Point2D | null)[];
  view: (Point2D | null)[];
  hits: HitEvent[];
  bounces: BounceEvent[];
  rallies: RallySegment[];
  score?: ScoreFrameEntry[] | null;
  scoreSummary?: ScoreSummary | null;
}

export interface ActiveCalloutState {
  type: CalloutType;
  ageSec: number;
  at: Point2D;
  playerIdx: number | null;
}

export interface ActiveSpeedLabel {
  speedKmh: number;
  ageSec: number;
  at: Point2D;
}

export interface ActiveBounceCall {
  bounce: BounceEvent;
  ageSec: number;
}

export interface FrameBallHudState {
  pos: Point2D | null;
  rallyTimeSec: number | null;
  rallyShotCount: number | null;
  lastSpeedKmh: number | null;
  speedLabel: ActiveSpeedLabel | null;
  callout: ActiveCalloutState | null;
  activeBounceCall: ActiveBounceCall | null;
  recentBounces: BounceEvent[];
  live: boolean;
  score: ScoreFrameEntry | null;
}

export interface HighlightClipSpan {
  index: number;
  total: number;
  startFrame: number;
  endFrame: number;
  rallies: number[];
  shots: number;
  topSpeedKmh: number | null;
}

class Tracklet {
  public readonly pts: [number, number, number][];
  public vx: number = 0;
  public vy: number = 0;
  public ev: number = 0;
  public moving: number = 0;
  public prev: Tracklet[] = [];
  public next: Tracklet[] = [];
  public fwd: number = 0;
  public bwd: number = 0;
  public chain: number = 0;

  constructor(firstFrame: number, x: number, y: number) {
    this.pts = [[firstFrame, x, y]];
  }
}

export class PickleballRallyAnalyzer {
  static readonly CALLOUT_SECS = 1.15;
  static readonly BOUNCE_CALL_SECS = 1.1;

  private static zoneDist(x: number, y: number, b: BoxWithPlayer): number {
    const bh = Math.max(1, b.y2 - b.y1);
    const cx = Math.max(b.x1, Math.min(b.x2, x));
    const cy = Math.max(b.y1 - 0.45 * bh, Math.min(b.y1 + 0.65 * bh, y));
    return Math.hypot(x - cx, y - cy) / bh;
  }

  private static zoneDistRaw(x: number, y: number, b: number[]): number {
    const bh = Math.max(1, b[3] - b[1]);
    const cx = Math.max(b[0], Math.min(b[2], x));
    const cy = Math.max(b[1] - 0.45 * bh, Math.min(b[1] + 0.65 * bh, y));
    return Math.hypot(x - cx, y - cy) / bh;
  }

  private static zoneVote(
    x: number,
    y: number,
    mine: BoxWithPlayer[],
    theirs: number[][]
  ): number {
    let d = Number.POSITIVE_INFINITY;
    for (const m of mine) d = Math.min(d, this.zoneDist(x, y, m));
    let e = Number.POSITIVE_INFINITY;
    for (const t of theirs) e = Math.min(e, this.zoneDistRaw(x, y, t));
    if (d < 0.65 && d <= e) return 1;
    if (e < 0.65 && e < d) return -1;
    return 0;
  }

  static playVolume(
    boxes: BoxWithPlayer[][],
    court: PickleballCourt,
    fps: number = 30,
    grow: number = 1.5,
    heightM: number = 5.5
  ): (frameIdx: number) => Point2D[] | null {
    const cache = new Map<number, Point2D[] | null>();
    const step = Math.max(1, Math.round(fps / 10));
    return (i: number) => {
      if (cache.has(i)) return cache.get(i) ?? null;
      const floorPts: Point2D[] = [];
      let far = false;
      let near = false;
      const jStart = Math.max(0, i - Math.round(0.5 * fps));
      const jEnd = Math.min(boxes.length - 1, i + Math.round(fps));
      for (let j = jStart; j <= jEnd; j += step) {
        for (const b of boxes[j] ?? []) {
          if (b.courtY < PickleballCourtConstants.NET_Y) far = true;
          else near = true;
          floorPts.push({ x: b.courtX - grow, y: b.courtY - grow });
          floorPts.push({ x: b.courtX + grow, y: b.courtY - grow });
          floorPts.push({ x: b.courtX + grow, y: b.courtY + grow });
          floorPts.push({ x: b.courtX - grow, y: b.courtY + grow });
        }
      }
      let result: Point2D[] | null = null;
      if (far && near) {
        const hullFloor = PickleballCourt.convexHull(floorPts);
        const imgPts: Point2D[] = [];
        for (const pt of hullFloor) {
          const p = court.toImg(pt.x, pt.y);
          const ax = court.toImg(pt.x + 1, pt.y);
          const ay = court.toImg(pt.x, pt.y + 1);
          const ppm = Math.max(
            Math.hypot(ax.x - p.x, ax.y - p.y),
            Math.hypot(ay.x - p.x, ay.y - p.y)
          );
          imgPts.push(p);
          imgPts.push({ x: p.x, y: p.y - ppm * heightM });
        }
        if (imgPts.every((it) => Number.isFinite(it.x) && Number.isFinite(it.y))) {
          result = PickleballCourt.convexHull(imgPts);
        }
      }
      cache.set(i, result);
      return result;
    };
  }

  static pickBall(
    cands: (BallBlobCandidate[] | null)[],
    boxes: BoxWithPlayer[][],
    fps: number = 30,
    width: number = 1280,
    others: number[][][] = [],
    vol?: (frameIdx: number) => Point2D[] | null
  ): (Point2D | null)[] {
    const nFrames = cands.length;
    const k = width / 1280;
    const f = fps / 30;
    const maxGap = Math.max(1, Math.round(3 * f));
    const tracks: Tracklet[] = [];
    const atFrame: { t: Tracklet; c: BallBlobCandidate }[][] = Array.from(
      { length: nFrames },
      () => []
    );
    let active: Tracklet[] = [];

    for (let i = 0; i < nFrames; i++) {
      const frameCands = cands[i] ?? [];
      const pairs: { d: number; t: Tracklet; cIdx: number }[] = [];
      for (const t of active) {
        const [li, lx, ly] = t.pts[t.pts.length - 1];
        const g = i - li;
        const px = lx + t.vx * g;
        const py = ly + t.vy * g;
        const tol = (30 * k + 0.5 * Math.hypot(t.vx, t.vy)) * g;
        frameCands.forEach((c, idx) => {
          const d = Math.hypot(c.x - px, c.y - py);
          if (d < tol && Math.hypot(c.x - lx, c.y - ly) <= (120 * k * g) / f) {
            pairs.push({ d, t, cIdx: idx });
          }
        });
      }
      pairs.sort((a, b) => a.d - b.d);
      const usedT = new Set<Tracklet>();
      const usedC = new Set<number>();
      for (const m of pairs) {
        if (usedT.has(m.t) || usedC.has(m.cIdx)) continue;
        usedT.add(m.t);
        usedC.add(m.cIdx);
        const [li, lx, ly] = m.t.pts[m.t.pts.length - 1];
        const c = frameCands[m.cIdx];
        const g = i - li;
        const vx = (c.x - lx) / g;
        const vy = (c.y - ly) / g;
        if (m.t.pts.length > 1) {
          m.t.vx = (m.t.vx + vx) / 2;
          m.t.vy = (m.t.vy + vy) / 2;
        } else {
          m.t.vx = vx;
          m.t.vy = vy;
        }
        m.t.pts.push([i, c.x, c.y]);
        atFrame[i].push({ t: m.t, c });
      }
      frameCands.forEach((c, idx) => {
        if (usedC.has(idx)) return;
        const t = new Tracklet(i, c.x, c.y);
        tracks.push(t);
        active.push(t);
        atFrame[i].push({ t, c });
      });
      active = active.filter((t) => i - t.pts[t.pts.length - 1][0] < maxGap);
    }

    const still = 4 * k;
    const endCount = 3;
    const contact = (pts: [number, number, number][]): number => {
      let sum = 0;
      for (const [fi, x, y] of pts) {
        sum += this.zoneVote(x, y, boxes[fi] ?? [], others[fi] ?? []);
      }
      return sum > 0 ? 1 : sum < 0 ? -1 : 0;
    };

    for (const t of tracks) {
      let inside = 0;
      let moving = 0;
      t.pts.forEach(([fi, x, y], j) => {
        if (j === 0) return;
        const prev = t.pts[j - 1];
        if (Math.hypot(x - prev[1], y - prev[2]) < still) return;
        moving++;
        const h = vol?.(fi);
        if (h) {
          inside += PickleballCourt.inHull(h, x, y) ? 1 : -1;
        }
      });
      const n = t.pts.length;
      const ends =
        contact(t.pts.slice(0, endCount)) +
        (n > endCount ? contact(t.pts.slice(n - endCount)) : 0);
      t.ev = 10 * ends + (moving >= 3 ? Math.min(0, (10 * inside) / moving) : 0);
      t.moving = moving;
    }

    const endsMap = new Map<number, Tracklet[]>();
    for (const t of tracks) {
      const e = t.pts[t.pts.length - 1][0];
      const list = endsMap.get(e) ?? [];
      list.push(t);
      endsMap.set(e, list);
    }
    for (const t of tracks) {
      const [s, x, y] = t.pts[0];
      for (let g = 1; g <= maxGap; g++) {
        for (const a of endsMap.get(s - g) ?? []) {
          const [, ax, ay] = a.pts[a.pts.length - 1];
          if (Math.hypot(x - ax, y - ay) <= (120 * k * g) / f) {
            t.prev.push(a);
            a.next.push(t);
          }
        }
      }
    }

    for (const t of tracks) {
      let maxPrev = 0;
      for (const p of t.prev) maxPrev = Math.max(maxPrev, p.fwd);
      t.fwd = t.ev + maxPrev;
    }
    for (let idx = tracks.length - 1; idx >= 0; idx--) {
      const t = tracks[idx];
      let maxNext = 0;
      for (const n of t.next) maxNext = Math.max(maxNext, n.bwd);
      t.bwd = t.ev + maxNext;
    }
    for (const t of tracks) {
      t.chain = t.fwd + t.bwd - t.ev;
    }

    return atFrame.map((list) => {
      if (list.length === 0) return null;
      const sorted = [...list].sort((a, b) => {
        if (b.t.chain !== a.t.chain) return b.t.chain - a.t.chain;
        if (b.t.moving !== a.t.moving) return b.t.moving - a.t.moving;
        return b.c.strength - a.c.strength;
      });
      const best = sorted[0];
      return best && best.t.chain > 0 ? { x: best.c.x, y: best.c.y } : null;
    });
  }

  /**
   * Complete Pickleball trajectory, bounce, paddle hit, shot speed, callout, and rally analysis.
   */
  static analyzePickleball(
    rawBall: (Point2D | null)[],
    boxes: BoxWithPlayer[][],
    court: PickleballCourt,
    cfg: PickleballConfig,
    fps: number = 30,
    width: number = 1280,
    others: number[][][] = [],
    cands?: (BallBlobCandidate[] | null)[] | null
  ): PickleballAnalysisResult {
    const vol = this.playVolume(boxes, court, fps);
    const picked =
      cands && cands.some((c) => c && c.length > 0)
        ? this.pickBall(cands, boxes, fps, width, others, vol)
        : rawBall;

    const nFrames = picked.length;
    const k = width / 1280;
    const f = fps / 30;
    const pos: (Point2D | null)[] = picked.map((p) => (p ? { ...p } : null));

    // 1) Drop isolated points & implausible jumps
    for (let i = 0; i < nFrames; i++) {
      const p = pos[i];
      if (!p) continue;
      let nb = 0;
      for (let j = i - 2; j <= i + 2; j++) {
        if (j !== i && j >= 0 && j < nFrames) {
          const rj = picked[j];
          if (rj && Math.hypot(rj.x - p.x, rj.y - p.y) < (95 * k * Math.abs(j - i)) / f) {
            nb++;
          }
        }
      }
      if (nb === 0) pos[i] = null;
    }

    // 1b) Drop static false blobs
    const rStill = 4 * k;
    const stillRuns: { s: number; e: number; p: Point2D }[] = [];
    let idx = 0;
    while (idx < nFrames) {
      const p0 = picked[idx];
      if (!p0) {
        idx++;
        continue;
      }
      let j = idx + 1;
      while (
        j < nFrames &&
        picked[j] &&
        Math.hypot(picked[j]!.x - p0.x, picked[j]!.y - p0.y) < rStill
      ) {
        j++;
      }
      if (j - idx >= Math.round(4 * f)) {
        stillRuns.push({ s: idx, e: j - 1, p: p0 });
        idx = j;
      } else {
        idx++;
      }
    }
    for (const r of stillRuns) {
      const again = stillRuns.filter(
        (o) =>
          o !== r &&
          Math.abs(o.s - r.s) > fps &&
          Math.hypot(o.p.x - r.p.x, o.p.y - r.p.y) < 2 * rStill
      ).length;
      if (r.e - r.s + 1 >= Math.round(0.5 * fps) || again >= 2) {
        for (let m = r.s; m <= r.e; m++) pos[m] = null;
      }
    }

    // 2) Fill short gaps up to 5 frames
    const maxGap = Math.round(5 * f);
    let gIdx = 1;
    while (gIdx < nFrames) {
      if (pos[gIdx] !== null || pos[gIdx - 1] === null) {
        gIdx++;
        continue;
      }
      let j = gIdx;
      while (j < nFrames && pos[j] === null) j++;
      if (
        j >= nFrames ||
        j - gIdx > maxGap ||
        Math.hypot(pos[j]!.x - pos[gIdx - 1]!.x, pos[j]!.y - pos[gIdx - 1]!.y) >
          (65 * k * (j - gIdx + 1)) / f
      ) {
        gIdx = j;
        continue;
      }
      const pStart = pos[gIdx - 1]!;
      const pEnd = pos[j]!;
      for (let m = gIdx; m < j; m++) {
        const u = (m - gIdx + 1) / (j - gIdx + 1);
        pos[m] = {
          x: pStart.x + (pEnd.x - pStart.x) * u,
          y: pStart.y + (pEnd.y - pStart.y) * u,
        };
      }
      gIdx = j;
    }

    // 3) Candidate velocity turns (paddle hits vs floor bounces)
    const w = Math.max(2, Math.round(3 * f));
    const vel = (a: number, b: number): Point2D | null => {
      const pa = pos[a];
      const pb = pos[b];
      if (!pa || !pb) return null;
      const dt = b - a;
      return dt > 0 ? { x: (pb.x - pa.x) / dt, y: (pb.y - pa.y) / dt } : null;
    };

    const vt = (1.35 * k) / f;
    const rawHits: number[] = [];
    const rawBounceFrames: number[] = [];

    for (let i = w; i < nFrames - w; i++) {
      if (!pos[i]) continue;
      const a = vel(i - w, i);
      const b = vel(i, i + w);
      if (a && b) {
        const horizRev = a.x * b.x < 0 && Math.abs(a.x) > vt && Math.abs(b.x) > vt;
        const depthRev = a.y * b.y < 0 && Math.abs(a.y) > vt && Math.abs(b.y) > vt;
        const fallToRise = a.y > 0.6 * vt && b.y < -0.5 * vt;
        const p = pos[i]!;
        const inPlayerZone = (boxes[i] ?? []).some((bx) => this.zoneDist(p.x, p.y, bx) < 0.72);

        if (horizRev || (depthRev && inPlayerZone)) {
          rawHits.push(i);
        } else if (fallToRise && !inPlayerZone) {
          rawBounceFrames.push(i);
        } else if (fallToRise && inPlayerZone) {
          rawHits.push(i);
        }
      } else if (!pos[i - 1] && !pos[i - 2]) {
        const m = Math.round(5 * f);
        let hasRun = true;
        for (let step = 1; step <= m; step++) {
          if (!pos[i + step]) {
            hasRun = false;
            break;
          }
        }
        if (hasRun) {
          const v = vel(i, i + m);
          if (v && (Math.hypot(v.x, v.y) >= 2 * vt || v.y <= -vt)) {
            rawHits.push(i);
          }
        }
      }
    }

    let hits: HitEvent[] = [];
    for (const fIdx of rawHits) {
      if (hits.length === 0 || fIdx - hits[hits.length - 1].frame > Math.round(0.38 * fps)) {
        hits.push(createHitEvent({ frame: fIdx }));
      }
    }
    const allTurnHits = [...hits];

    // 4) Assign hitter from player boxes + alternating sides
    for (const h of hits) {
      const p = pos[h.frame];
      if (!p) continue;
      let bestBox: BoxWithPlayer | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const b of boxes[h.frame] ?? []) {
        const d = this.zoneDist(p.x, p.y, b);
        if (d < bestDist) {
          bestDist = d;
          bestBox = b;
        }
      }
      const someoneElseNearer = (others[h.frame] ?? []).some(
        (ot) => this.zoneDistRaw(p.x, p.y, ot) < bestDist
      );
      if (someoneElseNearer) bestBox = null;
      h.player = bestBox && bestDist < 1.5 ? bestBox.playerIdx : null;
      h.court = bestBox && bestDist < 1.5 ? { x: bestBox.courtX, y: bestBox.courtY } : null;
      h.reach = bestDist;
    }

    if (boxes.some((b) => b.length > 0)) {
      const shots: HitEvent[] = [];
      for (const h of hits) {
        const p = pos[h.frame];
        if (!p) continue;
        const fb = boxes[h.frame] ?? [];
        let minMine = Number.POSITIVE_INFINITY;
        for (const b of fb) minMine = Math.min(minMine, this.zoneDist(p.x, p.y, b));
        if ((others[h.frame] ?? []).some((ot) => this.zoneDistRaw(p.x, p.y, ot) < minMine)) {
          continue;
        }

        const sideOf = (b: BoxWithPlayer) => b.courtY < PickleballCourtConstants.NET_Y;
        const bestOnSide = (far: boolean): { d: number; b: BoxWithPlayer } | null => {
          let best: { d: number; b: BoxWithPlayer } | null = null;
          for (const b of fb) {
            if (sideOf(b) !== far) continue;
            const d = this.zoneDist(p.x, p.y, b);
            const px = d * (b.y2 - b.y1);
            if ((d < 0.75 || px < 140 * k) && (!best || d < best.d)) {
              best = { d, b };
            }
          }
          return best;
        };

        const farBest = bestOnSide(true);
        const nearBest = bestOnSide(false);
        if (!farBest && !nearBest) continue;

        const last = shots[shots.length - 1];
        const live = last !== undefined && h.frame - last.frame < Math.round(4.5 * fps);
        const dueFar =
          live && last.far !== null
            ? !last.far
            : farBest && nearBest
            ? farBest.d <= nearBest.d
            : farBest !== null;

        const dueWho = dueFar ? farBest : nearBest;
        if (dueWho) {
          h.player = dueWho.b.playerIdx;
          h.court = { x: dueWho.b.courtX, y: dueWho.b.courtY };
          h.reach = dueWho.d;
          h.far = dueFar;
          shots.push(h);
          continue;
        }
        const who = dueFar ? nearBest : farBest;
        if (!who) continue;
        const otherTracked = fb.some((b) => sideOf(b) === dueFar);
        h.player = who.b.playerIdx;
        h.court = { x: who.b.courtX, y: who.b.courtY };
        h.reach = who.d;
        h.far = !dueFar;
        if (otherTracked && last && h.frame - last.frame < Math.round(1.1 * fps)) {
          if (h.reach < last.reach) shots[shots.length - 1] = h;
        } else {
          if (otherTracked && last) {
            shots.push(
              createHitEvent({
                frame: Math.floor((last.frame + h.frame) / 2),
                far: dueFar,
                inferred: true,
              })
            );
          }
          shots.push(h);
        }
      }
      hits = shots;
    }

    // 5) Deduplicate & project Floor Bounces onto Pickleball Court (IN / OUT + Kitchen NVZ)
    const bounces: BounceEvent[] = [];
    for (const bf of rawBounceFrames) {
      if (bounces.length > 0 && bf - bounces[bounces.length - 1].frame < Math.round(0.35 * fps)) {
        continue;
      }
      const imgPt = pos[bf];
      if (!imgPt) continue;
      const courtPt = court.toCourt(imgPt);
      if (
        courtPt.x >= -2.5 &&
        courtPt.x <= PickleballCourtConstants.COURT_W + 2.5 &&
        courtPt.y >= -2.5 &&
        courtPt.y <= PickleballCourtConstants.COURT_L + 2.5
      ) {
        bounces.push({
          frame: bf,
          imgPos: imgPt,
          courtPos: courtPt,
          isInBounds: court.isBounceInBounds(courtPt),
          isInKitchen: court.isInKitchen(courtPt),
          rallyIdx: -1,
        });
      }
    }

    // Synthesize realistic floor bounces between cross-net shots or detect air volleys
    for (let j = 0; j < hits.length - 1; j++) {
      const h1 = hits[j];
      const h2 = hits[j + 1];
      const c1 = h1.court;
      const c2 = h2.court;
      if (!c1 || !c2) continue;
      if (c1.y < PickleballCourtConstants.NET_Y === c2.y < PickleballCourtConstants.NET_Y) {
        continue;
      }
      const hasBounceBetween = bounces.some(
        (b) => b.frame >= h1.frame + 2 && b.frame < h2.frame
      );
      if (!hasBounceBetween && h2.frame - h1.frame >= Math.round(0.45 * fps)) {
        const receiverAtNvz = court.isAtKitchenLine(c2);
        if (!receiverAtNvz || h2.frame - h1.frame >= Math.round(0.75 * fps)) {
          const bFrame = h1.frame + Math.round((h2.frame - h1.frame) * 0.72);
          const bImg =
            pos[bFrame] ??
            court.toImg(c1.x + (c2.x - c1.x) * 0.78, c1.y + (c2.y - c1.y) * 0.78);
          const bCourt: Point2D = {
            x: c1.x + (c2.x - c1.x) * 0.8,
            y: c1.y + (c2.y - c1.y) * 0.8,
          };
          bounces.push({
            frame: bFrame,
            imgPos: bImg,
            courtPos: bCourt,
            isInBounds: court.isBounceInBounds(bCourt),
            isInKitchen: court.isInKitchen(bCourt),
            rallyIdx: -1,
          });
        } else {
          h2.bouncedBeforeHit = false; // Volleyed in the air!
        }
      }
    }
    bounces.sort((a, b) => a.frame - b.frame);

    // 6) Estimate Pickleball Shot Speed (terminal velocity vt = 19.0 m/s -> L = vt^2 / g = 36.8 m)
    const dragLengthL = (19.0 * 19.0) / 9.81;
    for (let j = 0; j < hits.length - 1; j++) {
      const h = hits[j];
      const n = hits[j + 1];
      const dt = (n.frame - h.frame) / fps;
      const hc = h.court;
      const nc = n.court;
      if (!hc || !nc) continue;
      if (dt < 0.2 || dt > 3.2) continue;
      if (hc.y < PickleballCourtConstants.NET_Y === nc.y < PickleballCourtConstants.NET_Y) {
        continue;
      }
      const distM = Math.hypot(nc.x - hc.x, nc.y - hc.y);
      const v0 = (dragLengthL * (Math.exp(Math.min(distM / dragLengthL, 1.5)) - 1)) / dt;
      const kmh = Math.round(v0 * 3.6);
      if (kmh >= 12 && kmh <= 130) {
        h.speedKmh = kmh;
      }
    }

    // 7) Segment Rallies
    const lostRun = (a: number, b: number): number => {
      let run = 0;
      let best = 0;
      for (let m = a + 1; m < b; m++) {
        run = pos[m] !== null ? 0 : run + 1;
        if (run > best) best = run;
      }
      return best;
    };

    const chainedRallies: HitEvent[][] = [];
    let curRally: HitEvent[] | null = null;
    for (const h of hits) {
      const prevFrame = curRally?.[curRally.length - 1]?.frame;
      if (
        curRally &&
        prevFrame !== undefined &&
        h.frame - prevFrame < Math.round(4.5 * fps) &&
        lostRun(prevFrame, h.frame) <= Math.round(1.4 * fps)
      ) {
        curRally.push(h);
      } else {
        if (curRally) chainedRallies.push(curRally);
        curRally = [h];
      }
    }
    if (curRally) chainedRallies.push(curRally);

    let rallies: RallySegment[] = chainedRallies
      .filter((r) => r.length >= 2)
      .map((rHits, rIdx) => {
        const lastFrame = rHits[rHits.length - 1].frame;
        let endFrame = lastFrame;
        while (
          endFrame + 1 < nFrames &&
          pos[endFrame + 1] !== null &&
          endFrame - lastFrame < Math.round(3 * fps)
        ) {
          endFrame++;
        }
        const finalEnd = Math.max(
          endFrame,
          Math.min(nFrames - 1, lastFrame + Math.round(0.6 * fps))
        );
        const rBounces = bounces
          .filter(
            (b) => b.frame >= rHits[0].frame && b.frame <= finalEnd + Math.round(0.5 * fps)
          )
          .map((b) => ({ ...b, rallyIdx: rIdx }));
        return {
          start: rHits[0].frame,
          end: finalEnd,
          limit: null,
          hits: rHits,
          bounces: rBounces,
          serve: rHits[0],
          box: null,
          byServe: false,
        };
      });

    const serves = this.detectBaselineServes(boxes, fps);
    if (serves.length >= 2) {
      rallies = this.ralliesFromServes(pos, hits, bounces, serves, boxes, fps);
    }

    // 8) Classify Pickleball Shot Callouts
    if (cfg.render.calloutsEnabled) {
      this.markPickleballCallouts(rallies, boxes, fps, cfg.render.driveMinKmh);
    }

    const smoothedView = this.smoothPath(pos, allTurnHits, fps, width);
    const allRallyBounces = rallies.length > 0 ? rallies.flatMap((r) => r.bounces) : bounces;

    const result: PickleballAnalysisResult = {
      pos,
      view: smoothedView,
      hits,
      bounces: allRallyBounces,
      rallies,
    };

    // 9) Compute Pickleball Score (Traditional 0-0-2 Side-Out or Rally Point)
    if (cfg.score.enabled && rallies.length > 0) {
      const summary = this.buildPickleballScore(result, cfg, court);
      result.scoreSummary = summary;
      result.score = summary.timeline;
    }

    return result;
  }

  /**
   * Classifies Pickleball-specific shots:
   * - ATP! (Around The Post)
   * - NVZ_FAULT (Kitchen Volley Fault)
   * - THIRD_SHOT_DROP (3rd Shot Drop)
   * - SPEED_UP
   * - DRIVE
   * - DINK
   */
  static markPickleballCallouts(
    rallies: RallySegment[],
    boxes: BoxWithPlayer[][],
    fps: number,
    driveMinKmh: number = 55
  ): void {
    const netY = PickleballCourtConstants.NET_Y;
    const cw = PickleballCourtConstants.COURT_W;

    for (const r of rallies) {
      r.hits.forEach((h, shotIdx) => {
        const nextHit = r.hits[shotIdx + 1];
        const hc = h.court;
        if (!hc) return;
        const nc = nextHit?.court ?? null;
        const spd = h.speedKmh ?? 0;
        const dt = nextHit ? (nextHit.frame - h.frame) / fps : 1;
        const hitterBox = (boxes[h.frame] ?? []).find((b) => b.playerIdx === h.player);

        // 1) Check Around The Post (ATP!)
        if (nc && (hc.y < netY) !== (nc.y < netY)) {
          const tNet = (netY - hc.y) / (nc.y - hc.y);
          const xAtNet = hc.x + (nc.x - hc.x) * tNet;
          if (xAtNet < -0.04 || xAtNet > cw + 0.04) {
            h.callout = CalloutType.ATP;
            return;
          }
        }

        // 2) Check NVZ Kitchen Volley Fault
        if (shotIdx >= 2 && !h.bouncedBeforeHit && hitterBox?.inKitchen) {
          h.callout = CalloutType.NVZ_FAULT;
          return;
        }

        // 3) Check 3rd Shot Drop (shot index 2 in 0-based rally: Serve=0, Return=1, 3rd Shot=2)
        if (
          shotIdx === 2 &&
          Math.abs(hc.y - netY) >= 3.8 &&
          nc &&
          Math.abs(nc.y - netY) <= 3.0 &&
          spd >= 15 &&
          spd <= 48
        ) {
          h.callout = CalloutType.THIRD_SHOT_DROP;
          return;
        }

        // 4) Check Speed-Up off the bounce / kitchen line after a Dink
        const prevCallout = shotIdx > 0 ? r.hits[shotIdx - 1].callout : null;
        if (prevCallout === CalloutType.DINK && spd >= 46 && Math.abs(hc.y - netY) <= 2.9) {
          h.callout = CalloutType.SPEED_UP;
          return;
        }

        // 5) Check Power Drive
        if (shotIdx >= 1 && spd >= driveMinKmh && dt <= 0.85) {
          h.callout = CalloutType.DRIVE;
          return;
        }

        // 6) Check Kitchen Dink
        if (
          shotIdx >= 2 &&
          Math.abs(hc.y - netY) <= 2.85 &&
          (!nc || Math.abs(nc.y - netY) <= 2.95) &&
          spd >= 12 &&
          spd <= 35
        ) {
          h.callout = CalloutType.DINK;
        }
      });
    }
  }

  static detectBaselineServes(
    boxes: BoxWithPlayer[][],
    fps: number = 30,
    quietSpeed: number = 0.38,
    minQuietSec: number = 0.65
  ): ServeEvent[] {
    const nFrames = boxes.length;
    const h = Math.max(1, Math.round(fps / 4));
    const ids = Array.from(new Set(boxes.flat().map((b) => b.playerIdx)));
    if (ids.length < 2) return [];

    const posAt = (f: number, pid: number): Point2D | null => {
      const b = boxes[f]?.find((it) => it.playerIdx === pid);
      return b ? { x: b.courtX, y: b.courtY } : null;
    };

    const act = new Array<number | null>(nFrames).fill(null);
    for (let i = h; i < nFrames - h; i++) {
      const speeds: number[] = [];
      for (const pid of ids) {
        const a = posAt(i - h, pid);
        const b = posAt(i + h, pid);
        if (a && b) {
          speeds.push(Math.hypot(b.x - a.x, b.y - a.y) / ((2 * h) / fps));
        }
      }
      if (speeds.length >= 2) {
        act[i] = speeds.reduce((s, v) => s + v, 0) / speeds.length;
      }
    }

    const nearBaseline = (f: number): boolean =>
      ids.some((pid) => {
        const q = posAt(f, pid);
        return q !== null && (q.y < 2.1 || q.y > PickleballCourtConstants.COURT_L - 2.1);
      });

    const spans: [number, number][] = [];
    let i = 0;
    while (i < nFrames) {
      const a = act[i];
      if (a === null || a >= quietSpeed) {
        i++;
        continue;
      }
      let j = i;
      while (j < nFrames && (act[j] === null || act[j]! < quietSpeed + 0.15)) j++;
      if (j - i >= Math.round(minQuietSec * fps) && j < nFrames - h) {
        const last = spans[spans.length - 1];
        if (last && i - last[1] < Math.round(fps)) {
          spans[spans.length - 1] = [last[0], j];
        } else {
          spans.push([i, j]);
        }
      }
      i = j;
    }

    const cw = PickleballCourtConstants.COURT_W;
    const netY = PickleballCourtConstants.NET_Y;
    const boxAt = (f: number): 'R' | 'L' | null => {
      let r = 0;
      let l = 0;
      for (const pid of ids) {
        const q = posAt(f, pid);
        if (!q) continue;
        if (q.y >= 2.2 && q.y <= PickleballCourtConstants.COURT_L - 2.2) continue;
        if (Math.abs(q.x - cw / 2) < 0.25) continue;
        const isRightBox = q.y > netY ? q.x > cw / 2 : q.x < cw / 2;
        if (isRightBox) r++;
        else l++;
      }
      if (r > l && l === 0) return 'R';
      if (l > r && r === 0) return 'L';
      return null;
    };

    return spans
      .filter((rng) => nearBaseline(rng[1] - 1))
      .map((rng) => ({
        frame: rng[1],
        quietStart: rng[0],
        quietEnd: rng[1],
        box: boxAt(Math.max(0, rng[1] - Math.round(fps / 6))),
      }));
  }

  static ralliesFromServes(
    pos: (Point2D | null)[],
    allHits: HitEvent[],
    allBounces: BounceEvent[],
    serves: ServeEvent[],
    boxes: BoxWithPlayer[][],
    fps: number = 30
  ): RallySegment[] {
    const nFrames = pos.length;
    return serves.map((sv, k) => {
      const limit = serves[k + 1]?.quietStart ?? nFrames - 1;
      const w0 = sv.frame - Math.round(0.5 * fps);
      const w1 = sv.frame + Math.round(1.5 * fps);
      const rHits: HitEvent[] = [];
      for (const h of allHits) {
        if (h.frame < w0 || h.frame >= limit) continue;
        const prev = rHits[rHits.length - 1]?.frame ?? sv.frame;
        if (h.frame - prev > Math.round(4.5 * fps)) break;
        rHits.push(h);
      }
      let serveHit: HitEvent | null =
        rHits[0] && rHits[0].frame <= w1 ? rHits[0] : null;
      if (!serveHit) {
        for (let i = Math.max(0, w0); i <= Math.min(w1, nFrames - 1); i++) {
          const p = pos[i];
          if (!p) continue;
          let best: BoxWithPlayer | null = null;
          let bd = 1.5;
          for (const b of boxes[i] ?? []) {
            const dd = this.zoneDist(p.x, p.y, b);
            if (dd < bd) {
              bd = dd;
              best = b;
            }
          }
          if (best) {
            serveHit = createHitEvent({
              frame: i,
              player: best.playerIdx,
              court: { x: best.courtX, y: best.courtY },
              guessed: true,
            });
            break;
          }
        }
      }
      const start = Math.max(0, Math.min(serveHit?.frame ?? sv.frame, sv.frame));
      const end = Math.min(
        limit,
        Math.max(
          rHits.length > 0 ? rHits[rHits.length - 1].frame + Math.round(1.5 * fps) : 0,
          start + Math.round(3.5 * fps)
        )
      );
      const rBounces = allBounces
        .filter((b) => b.frame >= start && b.frame <= end)
        .map((b) => ({ ...b, rallyIdx: k }));

      return {
        start,
        end: Math.max(end, start + 1),
        limit,
        hits: rHits,
        bounces: rBounces,
        serve: serveHit,
        box: sv.box,
        byServe: true,
      };
    });
  }

  static smoothPath(
    pos: (Point2D | null)[],
    hits: HitEvent[],
    fps: number = 30,
    width: number = 1280
  ): (Point2D | null)[] {
    const nFrames = pos.length;
    const k = width / 1280;
    const h = Math.max(2, Math.round((4 * fps) / 30));
    const jump = (120 * k * 30) / fps;
    const cScale = 30 * k;
    const cut = new Set<number>(hits.map((it) => it.frame));

    const near = (j: number, m: number): boolean => {
      const pj = pos[j];
      const pm = pos[m];
      return Boolean(pj && pm && Math.hypot(pj.x - pm.x, pj.y - pm.y) <= jump);
    };

    const span = (i: number): [number, number] => {
      let a = i;
      let b = i;
      while (a > i - h && a > 0 && pos[a - 1] !== null && !cut.has(a) && near(a - 1, a)) a--;
      while (
        b < i + h &&
        b + 1 < nFrames &&
        pos[b + 1] !== null &&
        !cut.has(b) &&
        near(b, b + 1)
      ) {
        b++;
      }
      return [a, b];
    };

    const fit = (
      i: number,
      a: number,
      b: number,
      rw: number[] | null
    ): Point2D | null => {
      const s = [0, 0, 0, 0, 0];
      const xArr = [0, 0, 0];
      const yArr = [0, 0, 0];
      let n = 0;
      for (let j = a; j <= b; j++) {
        const pj = pos[j];
        if (!pj) continue;
        const t = j - i;
        const u = Math.abs(t / (h + 1));
        const w = Math.pow(1 - Math.pow(u, 3), 3) * (rw ? rw[j] : 1);
        if (w <= 0) continue;
        n++;
        let tk = w;
        for (let e = 0; e <= 4; e++) {
          s[e] += tk;
          if (e <= 2) {
            xArr[e] += tk * pj.x;
            yArr[e] += tk * pj.y;
          }
          tk *= t;
        }
      }
      if (n >= 5) {
        const det =
          s[0] * (s[2] * s[4] - s[3] * s[3]) -
          s[1] * (s[1] * s[4] - s[3] * s[2]) +
          s[2] * (s[1] * s[3] - s[2] * s[2]);
        if (Math.abs(det) > 1e-9) {
          const c0 = (v: number[]) =>
            (v[0] * (s[2] * s[4] - s[3] * s[3]) -
              s[1] * (v[1] * s[4] - s[3] * v[2]) +
              s[2] * (v[1] * s[3] - s[2] * v[2])) /
            det;
          return { x: c0(xArr), y: c0(yArr) };
        }
      }
      const det2 = s[0] * s[2] - s[1] * s[1];
      if (n >= 3 && Math.abs(det2) > 1e-9) {
        return {
          x: (xArr[0] * s[2] - xArr[1] * s[1]) / det2,
          y: (yArr[0] * s[2] - yArr[1] * s[1]) / det2,
        };
      }
      return null;
    };

    const spans = pos.map((p, i) => (p ? span(i) : null));
    const pass = (rw: number[] | null): (Point2D | null)[] =>
      pos.map((p, i) => {
        if (!p || cut.has(i)) return p;
        const sp = spans[i]!;
        return sp[1] - sp[0] >= 2 ? fit(i, sp[0], sp[1], rw) ?? p : p;
      });

    const first = pass(null);
    const rw = pos.map((p, i) => {
      const fPt = first[i];
      if (!p || !fPt) return 0;
      const r = Math.hypot(p.x - fPt.x, p.y - fPt.y) / cScale;
      return r < 1 ? Math.pow(1 - r * r, 2) : 0;
    });
    return pass(rw);
  }

  /**
   * Pickleball Scoring Engine:
   * Supports both Traditional Side-Out Scoring (0-0-2) and Rally Point Scoring (0-0).
   */
  static buildPickleballScore(
    an: PickleballAnalysisResult,
    cfg: PickleballConfig,
    _court: PickleballCourt
  ): ScoreSummary {
    const sideTeam: Record<string, 'A' | 'B'> = {};
    for (const p of cfg.players) {
      if (p.side && !sideTeam[p.side]) {
        sideTeam[p.side] = p.team;
      }
    }
    if (!sideTeam.far) sideTeam.far = 'A';
    if (!sideTeam.near) sideTeam.near = 'B';

    const teamOf = (playerIdx: number | null | undefined): 'A' | 'B' | null =>
      playerIdx !== null && playerIdx !== undefined
        ? cfg.players[playerIdx]?.team ?? null
        : null;

    const otherTeam = (t: 'A' | 'B' | null): 'A' | 'B' | null =>
      t === 'A' ? 'B' : t === 'B' ? 'A' : null;

    let scoreA = cfg.score.startA;
    let scoreB = cfg.score.startB;
    const firstRally = an.rallies[0];
    const firstServePlayer = (firstRally?.serve ?? firstRally?.hits[0])?.player;
    let servingTeam: 'A' | 'B' = teamOf(firstServePlayer) ?? 'A';
    let serverNum = Math.max(1, Math.min(2, cfg.score.startServerNum));
    const isSideOutMode = cfg.score.mode === ScoringMode.SIDE_OUT_0_0_2;

    const formatDisplay = (
      a: number,
      b: number,
      srvTeam: 'A' | 'B',
      srvNum: number
    ): string => {
      if (isSideOutMode) {
        const srvScore = srvTeam === 'A' ? a : b;
        const recScore = srvTeam === 'A' ? b : a;
        return `${srvScore} - ${recScore} - ${srvNum}`;
      }
      return `${a} - ${b}`;
    };

    const rows: ScoreRow[] = [];
    const timeline: ScoreFrameEntry[] = [
      {
        frame: -1,
        scoreA,
        scoreB,
        servingTeam,
        serverNum,
        displayScore: formatDisplay(scoreA, scoreB, servingTeam, serverNum),
      },
    ];

    an.rallies.forEach((r, idx) => {
      const nextRally = an.rallies[idx + 1];
      const lastHit = r.hits[r.hits.length - 1];
      const hitterTeam = teamOf(lastHit?.player);

      let winner: 'A' | 'B' | null = null;
      let evidence: string | null = null;

      // Check NVZ Kitchen Fault
      const faultHit = r.hits.find((h) => h.callout === CalloutType.NVZ_FAULT);
      if (faultHit) {
        winner = otherTeam(teamOf(faultHit.player));
        evidence = 'nvz_fault';
      }

      // Check final bounce IN/OUT
      if (!winner && r.bounces.length > 0) {
        const lastBounce = r.bounces[r.bounces.length - 1];
        if (!lastBounce.isInBounds && hitterTeam) {
          winner = otherTeam(hitterTeam);
          evidence = 'out_bounce';
        } else if (lastBounce.isInBounds && lastHit && lastBounce.frame >= lastHit.frame) {
          const bounceSide =
            lastBounce.courtPos.y < PickleballCourtConstants.NET_Y ? 'far' : 'near';
          const receivingTeam = sideTeam[bounceSide];
          if (hitterTeam && receivingTeam) {
            winner = receivingTeam === hitterTeam ? otherTeam(hitterTeam) : hitterTeam;
            evidence = 'winner_bounce';
          }
        }
      }

      // Fallback to next server or last hitter
      if (!winner && nextRally) {
        const nextServerTeam = teamOf((nextRally.serve ?? nextRally.hits[0])?.player);
        if (nextServerTeam && !isSideOutMode) {
          winner = nextServerTeam;
          evidence = 'next_serve';
        }
      }
      if (!winner && hitterTeam) {
        winner = otherTeam(hitterTeam);
        evidence = 'unreturned';
      }

      let outcomeNote = 'RALLY';
      if (winner) {
        if (isSideOutMode) {
          if (winner === servingTeam) {
            if (servingTeam === 'A') scoreA++;
            else scoreB++;
            outcomeNote = `POINT TEAM ${servingTeam}`;
          } else {
            const isSingles = cfg.players.length <= 2;
            if (isSingles || serverNum >= 2) {
              servingTeam = otherTeam(servingTeam) ?? 'B';
              serverNum = 1;
              outcomeNote = `SIDE OUT -> TEAM ${servingTeam}`;
            } else {
              serverNum = 2;
              outcomeNote = `2ND SERVER (TEAM ${servingTeam})`;
            }
          }
        } else {
          if (winner === 'A') scoreA++;
          else scoreB++;
          servingTeam = winner;
          outcomeNote = `POINT TEAM ${winner}`;
        }
      }

      const disp = formatDisplay(scoreA, scoreB, servingTeam, serverNum);
      rows.push({
        rallyIndex: idx,
        frame: r.end,
        winner,
        scoreA,
        scoreB,
        servingTeam,
        serverNum,
        displayScore: disp,
        evidence,
        outcomeNote,
      });
      timeline.push({
        frame: r.end,
        scoreA,
        scoreB,
        servingTeam,
        serverNum,
        displayScore: disp,
        eventNote: outcomeNote,
      });
    });

    const finalDisplay = formatDisplay(scoreA, scoreB, servingTeam, serverNum);
    return {
      rows,
      timeline,
      finalA: scoreA,
      finalB: scoreB,
      finalDisplay,
    };
  }

  /**
   * Computes the instantaneous HUD state for frame i during Pass 2 rendering.
   */
  static stateAt(
    an: PickleballAnalysisResult,
    frameIdx: number,
    fps: number,
    badgeSecs: number = 1.1
  ): FrameBallHudState {
    const ballPos = an.view[frameIdx] ?? an.pos[frameIdx] ?? null;
    let curScore: ScoreFrameEntry | null = null;
    if (an.score) {
      for (const e of an.score) {
        if (e.frame <= frameIdx) curScore = e;
        else break;
      }
    }

    let rally: RallySegment | null = null;
    for (const r of an.rallies) {
      if (r.start <= frameIdx) rally = r;
      else break;
    }
    const live = rally !== null && frameIdx <= rally.end;
    const rallyTimeSec =
      rally !== null ? (Math.min(frameIdx, rally.end) - rally.start) / fps : null;
    const rallyShotCount = rally
      ? rally.hits.filter((h) => h.frame <= frameIdx).length
      : null;

    let lastSpeedKmh: number | null = null;
    let speedLabel: ActiveSpeedLabel | null = null;
    let callout: ActiveCalloutState | null = null;

    const posNear = (f: number, window: number = 5): Point2D | null => {
      for (let d = 0; d <= window; d++) {
        const p =
          an.view[f - d] ??
          an.view[f + d] ??
          an.pos[f - d] ??
          an.pos[f + d] ??
          null;
        if (p) return p;
      }
      return null;
    };

    for (const h of an.hits) {
      if (h.frame > frameIdx) break;
      const age = (frameIdx - h.frame) / fps;
      if (h.callout && age < this.CALLOUT_SECS) {
        const pt = posNear(h.frame) ?? h.court;
        if (pt) {
          callout = {
            type: h.callout,
            ageSec: age,
            at: pt,
            playerIdx: h.player,
          };
        }
      }
      if (h.speedKmh !== null) {
        lastSpeedKmh = h.speedKmh;
        if (age < badgeSecs) {
          const pt = posNear(h.frame);
          if (pt) {
            speedLabel = {
              speedKmh: h.speedKmh,
              ageSec: age,
              at: pt,
            };
          }
        }
      }
    }

    let activeBounceCall: ActiveBounceCall | null = null;
    const recentBounces: BounceEvent[] = [];
    for (const b of an.bounces) {
      if (b.frame > frameIdx) break;
      const age = (frameIdx - b.frame) / fps;
      if (age <= 4.5) recentBounces.push(b);
      if (age <= this.BOUNCE_CALL_SECS) {
        activeBounceCall = { bounce: b, ageSec: age };
      }
    }

    return {
      pos: ballPos,
      rallyTimeSec,
      rallyShotCount,
      lastSpeedKmh,
      speedLabel,
      callout,
      activeBounceCall,
      recentBounces,
      live,
      score: curScore,
    };
  }

  static pickHighlights(
    an: PickleballAnalysisResult,
    count: number = 3,
    fps: number = 30,
    padSec: number = 1.0
  ): HighlightClipSpan[] {
    if (an.rallies.length === 0) return [];
    const nFrames = an.pos.length;
    const pad = Math.round(padSec * fps);

    const picked = an.rallies
      .map((r, idx) => {
        const speeds = r.hits.map((h) => h.speedKmh).filter((s): s is number => s !== null);
        const topSpeed = speeds.length > 0 ? Math.max(...speeds) : null;
        const excitement = r.hits.length + (topSpeed ?? 0) / 25;
        return { idx, r, topSpeed, score: excitement };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, count > 0 ? count : an.rallies.length)
      .sort((a, b) => a.idx - b.idx);

    const rawClips: HighlightClipSpan[] = [];
    for (const c of picked) {
      const start = Math.max(0, c.r.start - pad);
      const end = Math.min(nFrames - 1, c.r.end + Math.round(1.5 * fps));
      const last = rawClips[rawClips.length - 1];
      if (last && start <= last.endFrame) {
        const speeds = [last.topSpeedKmh, c.topSpeed].filter((s): s is number => s !== null);
        rawClips[rawClips.length - 1] = {
          ...last,
          endFrame: Math.max(last.endFrame, end),
          rallies: [...last.rallies, c.idx],
          shots: last.shots + c.r.hits.length,
          topSpeedKmh: speeds.length > 0 ? Math.max(...speeds) : null,
        };
      } else {
        rawClips.push({
          index: rawClips.length + 1,
          total: picked.length,
          startFrame: start,
          endFrame: end,
          rallies: [c.idx],
          shots: c.r.hits.length,
          topSpeedKmh: c.topSpeed,
        });
      }
    }
    return rawClips.map((cl, idx) => ({
      ...cl,
      index: idx + 1,
      total: rawClips.length,
    }));
  }
}

