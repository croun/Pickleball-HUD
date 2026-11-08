import { Point2D } from '../model/PickleballConfig';
import { boxIou, PoseDetection } from './ByteTracker';
import { CropRect, PickleballCourt } from './PickleballCourt';
import { RgbaImageBuffer } from './PlayerTracker';

export interface BallBlobCandidate {
  x: number;
  y: number;
  strength: number;
}

export interface BallFrameResult {
  frame: number;
  pos: Point2D | null;
  cands: BallBlobCandidate[];
}

interface OrtTensorLike {
  data: Float32Array;
  dims: readonly number[];
}

interface OrtSessionLike {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, OrtTensorLike>): Promise<Record<string, OrtTensorLike>>;
}

function getOrtModule(): {
  InferenceSession: { create(uriOrPath: string): Promise<OrtSessionLike> };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => OrtTensorLike;
} | null {
  try {
    // Dynamic require so Expo Go / Web / Jest runtimes without native JSI bindings fall back gracefully
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('onnxruntime-react-native');
  } catch {
    return null;
  }
}

/**
 * YOLO11-pose (ONNX, 640x640) detector running on React Native via onnxruntime-react-native.
 */
export class OnnxPoseDetector {
  private static readonly SIZE = 640;
  private static readonly NUM_ANCHORS = 8400;
  private static readonly MIN_CONF = 0.1;

  private readonly session: OrtSessionLike | null;
  private readonly inputBuffer: Float32Array;

  private constructor(session: OrtSessionLike | null) {
    this.session = session;
    this.inputBuffer = new Float32Array(3 * OnnxPoseDetector.SIZE * OnnxPoseDetector.SIZE);
  }

  static async create(modelUri: string = 'models/yolo11n-pose.onnx'): Promise<OnnxPoseDetector> {
    const ort = getOrtModule();
    if (!ort) {
      return new OnnxPoseDetector(null);
    }
    try {
      const session = await ort.InferenceSession.create(modelUri);
      return new OnnxPoseDetector(session);
    } catch {
      return new OnnxPoseDetector(null);
    }
  }

  get isAvailable(): boolean {
    return this.session !== null;
  }

  async detect(
    source: RgbaImageBuffer,
    iouThr: number = 0.5,
    rois: CropRect[] = []
  ): Promise<PoseDetection[]> {
    if (!this.session) return [];
    const w = source.width;
    const h = source.height;
    const cands: PoseDetection[] = [];
    cands.push(...(await this.inferRegion(source, { x: 0, y: 0, w, h }, w, h)));
    for (const r of rois) {
      if (r.w > 16 && r.h > 16) {
        cands.push(...(await this.inferRegion(source, r, w, h)));
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const keep: PoseDetection[] = [];
    for (const c of cands) {
      if (keep.every((it) => boxIou(it.box, c.box) < iouThr)) {
        keep.push({
          ...c,
          box: [
            Math.max(0, Math.min(w, c.box[0])),
            Math.max(0, Math.min(h, c.box[1])),
            Math.max(0, Math.min(w, c.box[2])),
            Math.max(0, Math.min(h, c.box[3])),
          ],
        });
        if (keep.length >= 50) break;
      }
    }
    return keep;
  }

  private async inferRegion(
    source: RgbaImageBuffer,
    region: CropRect,
    fullW: number,
    fullH: number
  ): Promise<PoseDetection[]> {
    const ort = getOrtModule();
    if (!this.session || !ort) return [];

    const SIZE = OnnxPoseDetector.SIZE;
    const rx = Math.max(0, Math.min(fullW - 1, region.x));
    const ry = Math.max(0, Math.min(fullH - 1, region.y));
    const rw = Math.max(1, Math.min(fullW - rx, region.w));
    const rh = Math.max(1, Math.min(fullH - ry, region.h));

    const s = Math.min(SIZE / rw, SIZE / rh);
    const nw = Math.round(rw * s);
    const nh = Math.round(rh * s);
    const px = (SIZE - nw) / 2;
    const py = (SIZE - nh) / 2;

    const plane = SIZE * SIZE;
    this.inputBuffer.fill(114 / 255);

    for (let dy = 0; dy < nh; dy++) {
      const sy = Math.min(fullH - 1, ry + Math.floor(dy / s));
      const dstY = Math.round(py) + dy;
      if (dstY < 0 || dstY >= SIZE) continue;
      for (let dx = 0; dx < nw; dx++) {
        const sx = Math.min(fullW - 1, rx + Math.floor(dx / s));
        const dstX = Math.round(px) + dx;
        if (dstX < 0 || dstX >= SIZE) continue;
        const srcIdx = (sy * fullW + sx) * 4;
        const dstIdx = dstY * SIZE + dstX;
        this.inputBuffer[dstIdx] = source.data[srcIdx] / 255;
        this.inputBuffer[dstIdx + plane] = source.data[srcIdx + 1] / 255;
        this.inputBuffer[dstIdx + 2 * plane] = source.data[srcIdx + 2] / 255;
      }
    }

    const inputName = this.session.inputNames[0];
    const tensor = new ort.Tensor('float32', this.inputBuffer, [1, 3, SIZE, SIZE]);
    const outputs = await this.session.run({ [inputName]: tensor });
    const outTensor = outputs[this.session.outputNames[0]];
    if (!outTensor) return [];

    const fb = outTensor.data;
    const n = OnnxPoseDetector.NUM_ANCHORS;
    const edgeTol = 3 / s;
    const mapX = (v: number) => (v - px) / s + rx;
    const mapY = (v: number) => (v - py) / s + ry;
    const isCut = (b: [number, number, number, number]) =>
      (rx > 0 && b[0] < rx + edgeTol) ||
      (ry > 0 && b[1] < ry + edgeTol) ||
      (rx + rw < fullW && b[2] > rx + rw - edgeTol) ||
      (ry + rh < fullH && b[3] > ry + rh - edgeTol);

    const cands: PoseDetection[] = [];
    for (let i = 0; i < n; i++) {
      const score = fb[4 * n + i];
      if (score < OnnxPoseDetector.MIN_CONF) continue;
      const cx = fb[i];
      const cy = fb[n + i];
      const bw = fb[2 * n + i];
      const bh = fb[3 * n + i];
      const box: [number, number, number, number] = [
        mapX(cx - bw / 2),
        mapY(cy - bh / 2),
        mapX(cx + bw / 2),
        mapY(cy + bh / 2),
      ];
      if (isCut(box)) continue;
      const kps = new Array<number>(51);
      for (let j = 0; j < 17; j++) {
        kps[j * 3] = mapX(fb[(5 + j * 3) * n + i]);
        kps[j * 3 + 1] = mapY(fb[(6 + j * 3) * n + i]);
        kps[j * 3 + 2] = fb[(7 + j * 3) * n + i];
      }
      cands.push({ box, score, kps, tid: -1 });
    }
    return cands;
  }

  close(): void {
    // Session cleanup handled by garbage collector in onnxruntime-react-native
  }
}

/**
 * Pickleball 3-Frame WASB ONNX Ball Tracker (512x288 ImageNet-normalized -> 3 heatmaps).
 */
export class OnnxBallTracker {
  public static readonly TN_W = 512;
  public static readonly TN_H = 288;
  private static readonly WB_SEQ = 3;
  private static readonly MAX_CANDS = 5;
  private static readonly MEAN = [0.485, 0.456, 0.406];
  private static readonly STD = [0.229, 0.224, 0.225];

  private readonly session: OrtSessionLike | null;
  private readonly plane = OnnxBallTracker.TN_W * OnnxBallTracker.TN_H;
  private readonly inputBuffer: Float32Array;
  private readonly seen: Uint8Array;
  private readonly stack: Int32Array;
  private queue: number[] = [];
  private prevPick: Point2D | null = null;
  private mask: Uint8Array | null = null;

  private constructor(session: OrtSessionLike | null) {
    this.session = session;
    this.inputBuffer = new Float32Array(3 * OnnxBallTracker.WB_SEQ * this.plane);
    this.seen = new Uint8Array(this.plane);
    this.stack = new Int32Array(this.plane);
  }

  static async create(modelUri: string = 'models/wasb.onnx'): Promise<OnnxBallTracker> {
    const ort = getOrtModule();
    if (!ort) {
      return new OnnxBallTracker(null);
    }
    try {
      const session = await ort.InferenceSession.create(modelUri);
      return new OnnxBallTracker(session);
    } catch {
      return new OnnxBallTracker(null);
    }
  }

  get isAvailable(): boolean {
    return this.session !== null;
  }

  reset(): void {
    this.queue = [];
    this.prevPick = null;
  }

  setRegion(poly: Point2D[] | null, fullW: number, fullH: number): void {
    if (!poly || poly.length < 3) {
      this.mask = null;
      return;
    }
    const scaledHull = poly.map((pt) => ({
      x: (pt.x * OnnxBallTracker.TN_W) / fullW,
      y: (pt.y * OnnxBallTracker.TN_H) / fullH,
    }));
    const mArr = new Uint8Array(this.plane);
    for (let y = 0; y < OnnxBallTracker.TN_H; y++) {
      for (let x = 0; x < OnnxBallTracker.TN_W; x++) {
        mArr[y * OnnxBallTracker.TN_W + x] = PickleballCourt.inHull(scaledHull, x, y) ? 1 : 0;
      }
    }
    this.mask = mArr;
  }

  async push(
    source: RgbaImageBuffer,
    frameIndex: number,
    fullW: number,
    fullH: number
  ): Promise<BallFrameResult[]> {
    const slot = this.queue.length;
    const off = 3 * slot * this.plane;
    const { TN_W, TN_H, MEAN, STD } = OnnxBallTracker;

    for (let y = 0; y < TN_H; y++) {
      const sy = Math.min(source.height - 1, Math.floor((y * source.height) / TN_H));
      for (let x = 0; x < TN_W; x++) {
        const sx = Math.min(source.width - 1, Math.floor((x * source.width) / TN_W));
        const srcIdx = (sy * source.width + sx) * 4;
        const p = y * TN_W + x;
        const r = source.data[srcIdx] / 255;
        const g = source.data[srcIdx + 1] / 255;
        const b = source.data[srcIdx + 2] / 255;
        this.inputBuffer[off + p] = (r - MEAN[0]) / STD[0];
        this.inputBuffer[off + this.plane + p] = (g - MEAN[1]) / STD[1];
        this.inputBuffer[off + 2 * this.plane + p] = (b - MEAN[2]) / STD[2];
      }
    }
    this.queue.push(frameIndex);
    return this.queue.length === OnnxBallTracker.WB_SEQ
      ? this.runBatch(fullW, fullH)
      : [];
  }

  async flush(fullW: number, fullH: number): Promise<BallFrameResult[]> {
    const n = this.queue.length;
    if (n === 0) return [];
    const lastOff = 3 * (n - 1) * this.plane;
    for (let s = n; s < OnnxBallTracker.WB_SEQ; s++) {
      this.inputBuffer.copyWithin(3 * s * this.plane, lastOff, lastOff + 3 * this.plane);
    }
    const res = await this.runBatch(fullW, fullH);
    return res.slice(0, n);
  }

  private async runBatch(fullW: number, fullH: number): Promise<BallFrameResult[]> {
    const frames = [...this.queue];
    this.queue = [];
    const ort = getOrtModule();
    if (!this.session || !ort) return [];

    const { TN_W, TN_H, WB_SEQ, MAX_CANDS } = OnnxBallTracker;
    const inName = this.session.inputNames[0];
    const tensor = new ort.Tensor('float32', this.inputBuffer, [1, 3 * WB_SEQ, TN_H, TN_W]);
    const out = await this.session.run({ [inName]: tensor });
    const outTensor = out[this.session.outputNames[0]];
    if (!outTensor) return [];

    const hm = outTensor.data;
    const gate = (300 * fullW) / 1280;
    const sx = fullW / TN_W;
    const sy = fullH / TN_H;
    const results: BallFrameResult[] = [];

    frames.forEach((f, k) => {
      const all = this.heatBlobs(hm, k * this.plane, sx, sy);
      const filtered = this.prevPick
        ? all.filter((it) => Math.hypot(it.x - this.prevPick!.x, it.y - this.prevPick!.y) < gate)
        : all;
      let best: BallBlobCandidate | null = null;
      for (const item of filtered) {
        if (!best || item.strength > best.strength) best = item;
      }
      this.prevPick = best ? { x: best.x, y: best.y } : null;
      const topCands = [...all].sort((a, b) => b.strength - a.strength).slice(0, MAX_CANDS);
      results.push({ frame: f, pos: this.prevPick, cands: topCands });
    });

    return results;
  }

  private heatBlobs(
    hm: Float32Array,
    off: number,
    sx: number,
    sy: number
  ): BallBlobCandidate[] {
    const { TN_W, TN_H } = OnnxBallTracker;
    this.seen.fill(0);
    const res: BallBlobCandidate[] = [];
    const m = this.mask;

    for (let p = 0; p < this.plane; p++) {
      if (hm[off + p] <= 0.5 || this.seen[p] !== 0) continue;
      let sp = 0;
      let w = 0;
      let wx = 0;
      let wy = 0;
      this.stack[sp++] = p;
      this.seen[p] = 1;
      while (sp > 0) {
        const q = this.stack[--sp];
        const x = q % TN_W;
        const y = Math.floor(q / TN_W);
        const v = hm[off + q];
        w += v;
        wx += v * x;
        wy += v * y;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= TN_W || ny >= TN_H) continue;
            const r = ny * TN_W + nx;
            if (this.seen[r] !== 0 || hm[off + r] <= 0.5) continue;
            this.seen[r] = 1;
            this.stack[sp++] = r;
          }
        }
      }
      const cx = wx / w;
      const cy = wy / w;
      const mIdx =
        Math.max(0, Math.min(TN_H - 1, Math.round(cy))) * TN_W +
        Math.max(0, Math.min(TN_W - 1, Math.round(cx)));
      if (m && m[mIdx] === 0) continue;
      res.push({ x: cx * sx, y: cy * sy, strength: w });
    }
    return res;
  }

  close(): void {
    // Handled by GC
  }
}

