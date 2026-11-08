import { Point2D } from '../model/PickleballConfig';

/**
 * Pickleball Court Geometry & 4-Point Perspective Homography (image px <-> court meters).
 *
 * Standard USA Pickleball Court Dimensions:
 * - Width:  20 ft = 6.10 m (x: 0.0 left -> 6.10 right seen from near baseline)
 * - Length: 44 ft = 13.41 m (y: 0.0 far baseline -> 13.41 near baseline)
 * - Net:    22 ft = 6.705 m
 * - Non-Volley Zone (Kitchen): 7 ft = 2.1336 m on each side of the net
 *   - Far Kitchen line:  y = 6.705 - 2.1336 = 4.5714 m
 *   - Near Kitchen line: y = 6.705 + 2.1336 = 8.8386 m
 * - Centerline: divides left/right service courts from each Kitchen line to the baseline.
 */
export const PickleballCourtConstants = {
  COURT_W: 6.10,
  COURT_L: 13.41,
  NET_Y: 13.41 / 2,                        // 6.705 m
  KITCHEN_DEPTH: 2.1336,                   // 7 ft Non-Volley Zone
  NVZ_FAR_Y: 13.41 / 2 - 2.1336,           // 4.5714 m
  NVZ_NEAR_Y: 13.41 / 2 + 2.1336,          // 8.8386 m
} as const;

export interface LineSegment2D {
  a: Point2D;
  b: Point2D;
  isKitchen?: boolean;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class PickleballCourt {
  public readonly corners: Point2D[];
  public readonly orientation: 'behind' | 'side';
  public readonly marginM: number;
  public readonly hImgToCourt: number[];
  public readonly hCourtToImg: number[];

  constructor(
    rawCorners: Point2D[],
    orientation: 'behind' | 'side' = 'behind',
    marginM: number = 1.2
  ) {
    this.orientation = orientation;
    this.marginM = marginM;
    this.corners = PickleballCourt.orderCorners(rawCorners);
    this.hImgToCourt = PickleballCourt.homography(
      this.corners,
      PickleballCourt.courtTargets(orientation)
    );
    this.hCourtToImg = PickleballCourt.invert3(this.hImgToCourt);
  }

  toCourt(ptOrX: Point2D | number, y?: number): Point2D {
    if (typeof ptOrX === 'number') {
      return PickleballCourt.applyH(this.hImgToCourt, ptOrX, y ?? 0);
    }
    return PickleballCourt.applyH(this.hImgToCourt, ptOrX.x, ptOrX.y);
  }

  toImg(ptOrX: Point2D | number, y?: number): Point2D {
    if (typeof ptOrX === 'number') {
      return PickleballCourt.applyH(this.hCourtToImg, ptOrX, y ?? 0);
    }
    return PickleballCourt.applyH(this.hCourtToImg, ptOrX.x, ptOrX.y);
  }

  inPlay(pt: Point2D): boolean {
    const m = this.marginM;
    return (
      pt.x >= -m &&
      pt.x <= PickleballCourtConstants.COURT_W + m &&
      pt.y >= -m &&
      pt.y <= PickleballCourtConstants.COURT_L + m
    );
  }

  /** True if a ball bounce is inside the legal 20x44 ft pickleball boundary (with 6 cm line tolerance). */
  isBounceInBounds(pt: Point2D, lineTolM: number = 0.06): boolean {
    return (
      pt.x >= -lineTolM &&
      pt.x <= PickleballCourtConstants.COURT_W + lineTolM &&
      pt.y >= -lineTolM &&
      pt.y <= PickleballCourtConstants.COURT_L + lineTolM
    );
  }

  /** True if a court point (player foot or ball bounce) is inside the 7-ft Non-Volley Zone (Kitchen). */
  isInKitchen(pt: Point2D, tolM: number = 0.03): boolean {
    const inWidth = pt.x >= -0.25 && pt.x <= PickleballCourtConstants.COURT_W + 0.25;
    const inDepth =
      Math.abs(pt.y - PickleballCourtConstants.NET_Y) <=
      PickleballCourtConstants.KITCHEN_DEPTH + tolM;
    return inWidth && inDepth;
  }

  /** True if a player is positioned at the Kitchen line (within 0.65m behind the NVZ line or inside NVZ). */
  isAtKitchenLine(pt: Point2D): boolean {
    const dNet = Math.abs(pt.y - PickleballCourtConstants.NET_Y);
    return dNet <= PickleballCourtConstants.KITCHEN_DEPTH + 0.65;
  }

  /**
   * Overlapping zoomed-in crop tiles over the far half of the court so YOLO11-pose detects small far-side players.
   */
  farTiles(frameW: number, frameH: number, size: number = 640, maxTiles: number = 4): CropRect[] {
    const m = this.marginM;
    const w = PickleballCourtConstants.COURT_W;
    const netY = PickleballCourtConstants.NET_Y;
    const pts = [
      { x: -m, y: -m },
      { x: w + m, y: -m },
      { x: w + m, y: netY + 1 },
      { x: -m, y: netY + 1 },
    ].map((p) => this.toImg(p));

    if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      return [];
    }
    const tall =
      (Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) / (w + 2 * m)) * 2.4;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x1 = 0;
    const x2 = frameW;
    const y1 = Math.max(0, Math.min(...ys) - tall);
    const y2 = Math.min(frameH, Math.max(...ys) + tall * 0.2);

    if (y2 - y1 < 16 || Math.max(...xs) < 0 || Math.min(...xs) > frameW) {
      return [];
    }
    const ov = Math.min(Math.max(tall * 0.5, 64), 200);

    const starts = (a: number, b: number, s: number): number[] => {
      if (b - a <= s) return [a];
      const n = Math.max(2, Math.ceil((b - a - ov) / (s - ov)));
      return Array.from({ length: n }, (_, i) => a + ((b - a - s) * i) / (n - 1));
    };

    let s = size;
    while (true) {
      const sx = starts(x1, x2, s);
      const sy = starts(y1, y2, s);
      const tiles: CropRect[] = [];
      for (const y of sy) {
        for (const x of sx) {
          tiles.push({
            x: Math.round(x),
            y: Math.round(y),
            w: Math.round(Math.min(s, x2 - x)),
            h: Math.round(Math.min(s, y2 - y)),
          });
        }
      }
      if (tiles.length <= maxTiles) return tiles;
      s *= 1.25;
    }
  }

  /**
   * Convex hull in image space of the 3D air volume above this Pickleball court (lifted up to 5.5 m).
   */
  airPolygon(heightM: number = 5.5, margin: number = 1.5): Point2D[] | null {
    const w = PickleballCourtConstants.COURT_W;
    const l = PickleballCourtConstants.COURT_L;
    const floor: Point2D[] = [
      { x: -margin, y: -margin },
      { x: w + margin, y: -margin },
      { x: w + margin, y: l + margin },
      { x: -margin, y: l + margin },
    ];
    const pts: Point2D[] = [];
    for (const f of floor) {
      const p = this.toImg(f.x, f.y);
      const ax = this.toImg(f.x + 1, f.y);
      const ay = this.toImg(f.x, f.y + 1);
      const ppm = Math.max(Math.hypot(ax.x - p.x, ax.y - p.y), Math.hypot(ay.x - p.x, ay.y - p.y));
      pts.push(p);
      pts.push({ x: p.x, y: p.y - ppm * heightM });
    }
    if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      return null;
    }
    return PickleballCourt.convexHull(pts);
  }

  /**
   * Builds SVG polyline point strings for all court lines and the 7-ft Non-Volley Zone polygon.
   */
  buildSvgCourtElements(): {
    outerPolygonPoints: string;
    kitchenPolygonPoints: string;
    linePaths: { d: string; isKitchen: boolean }[];
  } {
    const w = PickleballCourtConstants.COURT_W;
    const l = PickleballCourtConstants.COURT_L;
    const nvzFar = PickleballCourtConstants.NVZ_FAR_Y;
    const nvzNear = PickleballCourtConstants.NVZ_NEAR_Y;

    const outerCorners = [
      this.toImg(0, 0),
      this.toImg(w, 0),
      this.toImg(w, l),
      this.toImg(0, l),
    ];
    const outerPolygonPoints = outerCorners.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    const kitchenCorners = [
      this.toImg(0, nvzFar),
      this.toImg(w, nvzFar),
      this.toImg(w, nvzNear),
      this.toImg(0, nvzNear),
    ];
    const kitchenPolygonPoints = kitchenCorners
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');

    const linePaths = PickleballCourt.courtLines().map((seg) => {
      const cmds: string[] = [];
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        const p = this.toImg(
          seg.a.x + (seg.b.x - seg.a.x) * t,
          seg.a.y + (seg.b.y - seg.a.y) * t
        );
        cmds.push(`${k === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      }
      return {
        d: cmds.join(' '),
        isKitchen: Boolean(seg.isKitchen),
      };
    });

    return { outerPolygonPoints, kitchenPolygonPoints, linePaths };
  }

  static courtLines(): LineSegment2D[] {
    const w = PickleballCourtConstants.COURT_W;
    const l = PickleballCourtConstants.COURT_L;
    const nvz1 = PickleballCourtConstants.NVZ_FAR_Y;
    const nvz2 = PickleballCourtConstants.NVZ_NEAR_Y;
    return [
      // Baselines
      { a: { x: 0, y: 0 }, b: { x: w, y: 0 } },
      { a: { x: 0, y: l }, b: { x: w, y: l } },
      // Sidelines
      { a: { x: 0, y: 0 }, b: { x: 0, y: l } },
      { a: { x: w, y: 0 }, b: { x: w, y: l } },
      // Non-Volley Zone (Kitchen) lines (7 ft from net)
      { a: { x: 0, y: nvz1 }, b: { x: w, y: nvz1 }, isKitchen: true },
      { a: { x: 0, y: nvz2 }, b: { x: w, y: nvz2 }, isKitchen: true },
      // Centerlines (baseline to Kitchen line on each side)
      { a: { x: w / 2, y: 0 }, b: { x: w / 2, y: nvz1 } },
      { a: { x: w / 2, y: nvz2 }, b: { x: w / 2, y: l } },
    ];
  }

  static orderCorners(pts: Point2D[]): Point2D[] {
    if (pts.length !== 4) return pts;
    const cx = pts.reduce((acc, p) => acc + p.x, 0) / 4;
    const cy = pts.reduce((acc, p) => acc + p.y, 0) / 4;
    const cw = [...pts].sort(
      (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
    );
    let top = 0;
    for (let i = 1; i <= 3; i++) {
      if (cw[i].y + cw[(i + 1) % 4].y < cw[top].y + cw[(top + 1) % 4].y) {
        top = i;
      }
    }
    return [0, 1, 2, 3].map((k) => cw[(top + k) % 4]);
  }

  private static courtTargets(orientation: 'behind' | 'side'): Point2D[] {
    const w = PickleballCourtConstants.COURT_W;
    const l = PickleballCourtConstants.COURT_L;
    if (orientation === 'side') {
      return [
        { x: 0, y: 0 },
        { x: 0, y: l },
        { x: w, y: l },
        { x: w, y: 0 },
      ];
    }
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: l },
      { x: 0, y: l },
    ];
  }

  private static solve(a: number[][], b: number[]): number[] {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) {
        if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
      }
      const tmpRow = a[i];
      a[i] = a[p];
      a[p] = tmpRow;
      const tmpB = b[i];
      b[i] = b[p];
      b[p] = tmpB;

      const pivot = Math.abs(a[i][i]) < 1e-12 ? 1e-12 : a[i][i];
      for (let r = i + 1; r < n; r++) {
        const f = a[r][i] / pivot;
        for (let c = i; c < n; c++) a[r][c] -= f * a[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Array<number>(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s -= a[i][c] * x[c];
      const pivot = Math.abs(a[i][i]) < 1e-12 ? 1e-12 : a[i][i];
      x[i] = s / pivot;
    }
    return x;
  }

  static homography(src: Point2D[], dst: Point2D[]): number[] {
    const a: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
    const b = new Array<number>(8).fill(0);
    for (let i = 0; i < 4; i++) {
      const x = src[i].x;
      const y = src[i].y;
      const u = dst[i].x;
      const v = dst[i].y;
      a[2 * i] = [x, y, 1, 0, 0, 0, -u * x, -u * y];
      b[2 * i] = u;
      a[2 * i + 1] = [0, 0, 0, x, y, 1, -v * x, -v * y];
      b[2 * i + 1] = v;
    }
    const h = PickleballCourt.solve(a, b);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1.0];
  }

  static invert3(m: number[]): number[] {
    const [a, b, c, d, e, f, g, h, i] = m;
    const capA = e * i - f * h;
    const capB = -(d * i - f * g);
    const capC = d * h - e * g;
    const rawDet = a * capA + b * capB + c * capC;
    const det = Math.abs(rawDet) < 1e-12 ? 1e-12 : rawDet;
    return [
      capA / det,
      -(b * i - c * h) / det,
      (b * f - c * e) / det,
      capB / det,
      (a * i - c * g) / det,
      -(a * f - c * d) / det,
      capC / det,
      -(a * h - b * g) / det,
      (a * e - b * d) / det,
    ];
  }

  static applyH(h: number[], x: number, y: number): Point2D {
    const rawW = h[6] * x + h[7] * y + h[8];
    const w = Math.abs(rawW) < 1e-9 ? 1e-9 : rawW;
    return {
      x: (h[0] * x + h[1] * y + h[2]) / w,
      y: (h[3] * x + h[4] * y + h[5]) / w,
    };
  }

  static convexHull(pts: Point2D[]): Point2D[] {
    const sorted = [...pts].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
    if (sorted.length <= 2) return sorted;

    const cross = (o: Point2D, a: Point2D, b: Point2D) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    const half = (list: Point2D[]): Point2D[] => {
      const h: Point2D[] = [];
      for (const p of list) {
        while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) {
          h.pop();
        }
        h.push(p);
      }
      if (h.length > 0) h.pop();
      return h;
    };

    return [...half(sorted), ...half([...sorted].reverse())];
  }

  static inHull(hull: Point2D[], x: number, y: number): boolean {
    if (hull.length < 3) return false;
    for (let j = 0; j < hull.length; j++) {
      const a = hull[j];
      const b = hull[(j + 1) % hull.length];
      if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) {
        return false;
      }
    }
    return true;
  }
}

