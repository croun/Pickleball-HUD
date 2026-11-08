export interface PoseDetection {
  box: [number, number, number, number]; // [x1, y1, x2, y2]
  score: number;
  kps?: number[] | null; // 51 floats (17 * [x, y, conf])
  tid: number;
}

export function boxIou(a: number[], b: number[]): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter + 1e-9);
}

const STD_POS = 1 / 20;
const STD_VEL = 1 / 160;
const STATE_TRACKED = 0;
const STATE_LOST = 1;
const STATE_REMOVED = 2;

function xyah(box: [number, number, number, number]): [number, number, number, number] {
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  return [box[0] + w / 2, box[1] + h / 2, w / Math.max(h, 1e-6), h];
}

function tlbr(mean: number[]): [number, number, number, number] {
  const cx = mean[0];
  const cy = mean[1];
  const a = mean[2];
  const h = mean[3];
  const w = a * h;
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

function inv4(m: number[][]): number[][] {
  const a: number[][] = Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: 8 }, (__, j) => (j < 4 ? m[i][j] : i === j - 4 ? 1.0 : 0.0))
  );
  for (let i = 0; i < 4; i++) {
    let p = i;
    for (let r = i + 1; r < 4; r++) {
      if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    }
    const tmp = a[i];
    a[i] = a[p];
    a[p] = tmp;
    const d = Math.abs(a[i][i]) < 1e-12 ? 1e-12 : a[i][i];
    for (let c = 0; c < 8; c++) a[i][c] /= d;
    for (let r = 0; r < 4; r++) {
      if (r !== i) {
        const f = a[r][i];
        for (let c = 0; c < 8; c++) a[r][c] -= f * a[i][c];
      }
    }
  }
  return Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: 4 }, (__, j) => a[i][j + 4])
  );
}

class KalmanTrack {
  public id: number = 0;
  public state: number = STATE_TRACKED;
  public activated: boolean = false;
  public last: number = 0;
  public len: number = 0;
  public score: number;
  public mean: number[] = new Array<number>(8).fill(0);
  public cov: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  public det: PoseDetection;

  constructor(det: PoseDetection) {
    this.det = det;
    this.score = det.score;
    const m = xyah(det.box);
    for (let i = 0; i < 4; i++) this.mean[i] = m[i];
    const h = m[3];
    const std = [
      2 * STD_POS * h,
      2 * STD_POS * h,
      1e-2,
      2 * STD_POS * h,
      10 * STD_VEL * h,
      10 * STD_VEL * h,
      1e-5,
      10 * STD_VEL * h,
    ];
    for (let i = 0; i < 8; i++) this.cov[i][i] = std[i] * std[i];
  }

  get box(): [number, number, number, number] {
    return tlbr(this.mean);
  }

  predict(): void {
    const h = this.mean[3];
    if (this.state !== STATE_TRACKED) this.mean[7] = 0;
    for (let i = 0; i < 4; i++) this.mean[i] += this.mean[i + 4];
    const fp = Array.from({ length: 8 }, (_, i) =>
      i < 4
        ? Array.from({ length: 8 }, (__, j) => this.cov[i][j] + this.cov[i + 4][j])
        : [...this.cov[i]]
    );
    const n = Array.from({ length: 8 }, (_, i) =>
      Array.from({ length: 8 }, (__, j) => (j < 4 ? fp[i][j] + fp[i][j + 4] : fp[i][j]))
    );
    const q = [
      STD_POS * h,
      STD_POS * h,
      1e-2,
      STD_POS * h,
      STD_VEL * h,
      STD_VEL * h,
      1e-5,
      STD_VEL * h,
    ];
    for (let i = 0; i < 8; i++) n[i][i] += q[i] * q[i];
    this.cov = n;
  }

  correct(newDet: PoseDetection): void {
    const z = xyah(newDet.box);
    const h = this.mean[3];
    const r = [STD_POS * h, STD_POS * h, 1e-1, STD_POS * h];
    const s = Array.from({ length: 4 }, (_, i) =>
      Array.from({ length: 4 }, (__, j) => this.cov[i][j] + (i === j ? r[i] * r[i] : 0))
    );
    const si = inv4(s);
    const k = Array.from({ length: 8 }, (_, rowIdx) => {
      const row = this.cov[rowIdx];
      return Array.from(
        { length: 4 },
        (__, j) => row[0] * si[0][j] + row[1] * si[1][j] + row[2] * si[2][j] + row[3] * si[3][j]
      );
    });
    const y = [0, 1, 2, 3].map((i) => z[i] - this.mean[i]);
    for (let i = 0; i < 8; i++) {
      this.mean[i] += k[i][0] * y[0] + k[i][1] * y[1] + k[i][2] * y[2] + k[i][3] * y[3];
    }
    this.cov = Array.from({ length: 8 }, (_, i) =>
      Array.from(
        { length: 8 },
        (__, j) =>
          this.cov[i][j] -
          (k[i][0] * this.cov[0][j] +
            k[i][1] * this.cov[1][j] +
            k[i][2] * this.cov[2][j] +
            k[i][3] * this.cov[3][j])
      )
    );
    this.score = newDet.score;
    this.det = newDet;
  }
}

/**
 * Compact ByteTrack (8-state Kalman filter xyah + two-stage IoU association).
 */
export class ByteTracker {
  private readonly high: number;
  private readonly low: number;
  private readonly newTrack: number;
  private readonly match: number;
  private readonly maxLost: number;
  private frame: number = 0;
  private nextId: number = 1;
  private tracks: KalmanTrack[] = [];

  constructor(options?: {
    high?: number;
    low?: number;
    newTrack?: number;
    buffer?: number;
    match?: number;
    fps?: number;
  }) {
    this.high = options?.high ?? 0.25;
    this.low = options?.low ?? 0.1;
    this.newTrack = options?.newTrack ?? 0.25;
    const buffer = options?.buffer ?? 30;
    this.match = options?.match ?? 0.8;
    const fps = options?.fps ?? 30;
    this.maxLost = Math.max(5, Math.round((fps / 30) * buffer));
  }

  update(dets: PoseDetection[]): PoseDetection[] {
    this.frame++;
    const f = this.frame;
    const highDets = dets.filter((d) => d.score >= this.high);
    const lowDets = dets.filter((d) => d.score >= this.low && d.score < this.high);

    const alive = this.tracks.filter((t) => t.state !== STATE_REMOVED);
    alive.forEach((t) => t.predict());
    const unconfirmed = alive.filter((t) => t.state === STATE_TRACKED && !t.activated);
    const pool = alive.filter((t) => t.activated);

    const activate = (t: KalmanTrack, d: PoseDetection, reactivate: boolean) => {
      t.correct(d);
      t.state = STATE_TRACKED;
      t.activated = true;
      t.last = f;
      t.len = reactivate ? 0 : t.len + 1;
    };

    // 1st association: high-score dets vs tracked+lost
    let m = this.greedyMatch(pool, highDets, this.match, true);
    for (const [i, j] of m.matches) {
      activate(pool[i], highDets[j], pool[i].state === STATE_LOST);
    }
    const remHigh = m.uDets.map((idx) => highDets[idx]);

    // 2nd association: low-score dets vs remaining tracked
    const remTracked = m.uTracks.map((idx) => pool[idx]).filter((t) => t.state === STATE_TRACKED);
    m = this.greedyMatch(remTracked, lowDets, 0.5, false);
    for (const [i, j] of m.matches) {
      activate(remTracked[i], lowDets[j], false);
    }
    for (const i of m.uTracks) {
      remTracked[i].state = STATE_LOST;
    }

    // Unconfirmed vs remaining high
    m = this.greedyMatch(unconfirmed, remHigh, 0.7, true);
    for (const [i, j] of m.matches) {
      activate(unconfirmed[i], remHigh[j], false);
    }
    for (const i of m.uTracks) {
      unconfirmed[i].state = STATE_REMOVED;
    }

    // New tracks
    for (const j of m.uDets) {
      const d = remHigh[j];
      if (d.score < this.newTrack) continue;
      const t = new KalmanTrack(d);
      t.id = this.nextId++;
      t.state = STATE_TRACKED;
      t.activated = f === 1;
      t.last = f;
      t.len = 0;
      this.tracks.push(t);
    }

    for (const t of this.tracks) {
      if (t.state === STATE_LOST && f - t.last > this.maxLost) {
        t.state = STATE_REMOVED;
      }
    }
    this.tracks = this.tracks.filter((t) => t.state !== STATE_REMOVED);

    return this.tracks
      .filter((t) => t.state === STATE_TRACKED && t.activated && t.last === f)
      .map((t) => ({
        ...t.det,
        box: t.box,
        tid: t.id,
      }));
  }

  private greedyMatch(
    trackList: KalmanTrack[],
    detList: PoseDetection[],
    thresh: number,
    fuseScore: boolean
  ): { matches: [number, number][]; uTracks: number[]; uDets: number[] } {
    const pairs: { cost: number; ti: number; dj: number }[] = [];
    trackList.forEach((t, i) => {
      detList.forEach((d, j) => {
        let sim = boxIou(t.box, d.box);
        if (fuseScore) sim *= d.score;
        const cost = 1 - sim;
        if (cost <= thresh) {
          pairs.push({ cost, ti: i, dj: j });
        }
      });
    });
    pairs.sort((a, b) => a.cost - b.cost);
    const usedT = new Set<number>();
    const usedD = new Set<number>();
    const matches: [number, number][] = [];
    for (const cp of pairs) {
      if (usedT.has(cp.ti) || usedD.has(cp.dj)) continue;
      usedT.add(cp.ti);
      usedD.add(cp.dj);
      matches.push([cp.ti, cp.dj]);
    }
    return {
      matches,
      uTracks: trackList.map((_, idx) => idx).filter((idx) => !usedT.has(idx)),
      uDets: detList.map((_, idx) => idx).filter((idx) => !usedD.has(idx)),
    };
  }
}

