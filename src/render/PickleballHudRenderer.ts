import { PickleballCourt, PickleballCourtConstants } from '../cv/PickleballCourt';
import { PlayerSnapshotItem } from '../cv/PlayerTracker';
import {
  HudStageMode,
  HudThemeName,
  LayoutMap,
  PanelPlacement,
  PickleballConfig,
  Point2D,
} from '../model/PickleballConfig';

export interface HudThemeColors {
  panelR: number;
  panelG: number;
  panelB: number;
  accentHex: string;
  mutedHex: string;
  textHex: string;
  glow: number;
}

export function hexWithAlpha(hex: string, alphaFraction: number = 1): string {
  const clean = hex.trim().replace('#', '');
  let r = 0;
  let g = 229;
  let b = 255;
  if (clean.length === 6) {
    const base = parseInt(clean, 16);
    if (!Number.isNaN(base)) {
      r = (base >> 16) & 0xff;
      g = (base >> 8) & 0xff;
      b = base & 0xff;
    }
  } else if (clean.length === 3) {
    r = parseInt(clean[0], 16) * 17;
    g = parseInt(clean[1], 16) * 17;
    b = parseInt(clean[2], 16) * 17;
  }
  const a = Math.max(0, Math.min(1, alphaFraction));
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

export function panelColorRgba(theme: HudThemeColors, alphaFraction: number = 0.82): string {
  const a = Math.max(0, Math.min(1, alphaFraction));
  return `rgba(${theme.panelR},${theme.panelG},${theme.panelB},${a.toFixed(3)})`;
}

export const HudThemes: Record<HudThemeName, HudThemeColors> = {
  broadcast: {
    panelR: 8,
    panelG: 18,
    panelB: 40,
    accentHex: '#00E5FF',
    mutedHex: '#9FB4D0',
    textHex: '#FFFFFF',
    glow: 1.0,
  },
  esports: {
    panelR: 26,
    panelG: 6,
    panelB: 42,
    accentHex: '#FF2BD6',
    mutedHex: '#C9A6E6',
    textHex: '#FFFFFF',
    glow: 1.4,
  },
  gold: {
    panelR: 16,
    panelG: 13,
    panelB: 8,
    accentHex: '#FFC400',
    mutedHex: '#CDBF96',
    textHex: '#FFFFFF',
    glow: 0.8,
  },
  volt: {
    panelR: 8,
    panelG: 22,
    panelB: 14,
    accentHex: '#B6FF2E',
    mutedHex: '#A2C79C',
    textHex: '#FFFFFF',
    glow: 1.0,
  },
  light: {
    panelR: 246,
    panelG: 248,
    panelB: 251,
    accentHex: '#1F6BFF',
    mutedHex: '#5A6A80',
    textHex: '#0B1220',
    glow: 0.0,
  },
};

export type HudPanelName = 'topHud' | 'playerPanel' | 'courtMap' | 'speedBadge';

const TOP_W1 = 4 * 290 + 3 * 16;
export const BADGE_FADE = 0.3;
export const BADGE_W = 195;
export const BADGE_H = 50;
export const PANEL_W = 480;
export const PANEL_W_STATS = 700;
export const KP_CONF = 0.35;
export const BONES: [number, number][] = [
  [5, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
];

const UNIT_CIRCLE: Point2D[] = Array.from({ length: 73 }, (_, i) => {
  const angle = (i / 72) * 2 * Math.PI;
  return { x: Math.cos(angle), y: Math.sin(angle) };
});

export class PickleballHudRenderer {
  public cfg: PickleballConfig;
  public court: PickleballCourt | null;
  public readonly videoW: number;
  public readonly videoH: number;
  public readonly s: number;
  public readonly stage: HudStageMode;

  public outW: number;
  public outH: number;
  public videoRect: [number, number, number, number];
  private defScale: Partial<Record<HudPanelName, number>> = {};

  constructor(
    cfg: PickleballConfig,
    court: PickleballCourt | null,
    videoW: number,
    videoH: number,
    stageOverride?: HudStageMode
  ) {
    this.cfg = cfg;
    this.court = court;
    this.videoW = videoW;
    this.videoH = videoH;
    this.s = videoH / 1080;
    const rawStage = stageOverride ?? cfg.render.stage;
    this.stage =
      rawStage === 'landscape' || rawStage === 'portrait' ? rawStage : 'overlay';
    this.outW = videoW;
    this.outH = videoH;
    this.videoRect = [0, 0, videoW, videoH];
    this.computeGeometry();
  }

  private even(v: number): number {
    return Math.max(2, Math.round(v / 2) * 2);
  }

  get panelW(): number {
    return this.cfg.render.playerStats ? PANEL_W_STATS : PANEL_W;
  }

  get isInset(): boolean {
    return this.stage !== 'overlay';
  }

  get badgeSecs(): number {
    return this.cfg.render.badge.secs + BADGE_FADE;
  }

  get theme(): HudThemeColors {
    return HudThemes[this.cfg.render.theme] ?? HudThemes.broadcast;
  }

  get isAngled(): boolean {
    return !this.cfg.render.frame || this.cfg.render.frame === 'angled';
  }

  computeGeometry(): void {
    const w = this.videoW;
    const h = this.videoH;
    const m = 28 * this.s;
    this.defScale = {};

    if (this.stage === 'landscape') {
      let vw = w - (PANEL_W * this.s + 3 * m);
      let vh = (vw * h) / w;
      if (vh > h - 96 * this.s - 3 * m) {
        vh = h - 96 * this.s - 3 * m;
        vw = (vh * w) / h;
      }
      this.outW = this.videoW;
      this.outH = this.videoH;
      this.videoRect = [m, m, vw, vh];
      this.defScale.playerPanel = PANEL_W / this.panelW;
    } else if (this.stage === 'portrait') {
      const ow = this.even(h);
      const oh = this.even((ow * 16) / 9);
      const vh = (ow * h) / w;
      const kTop = (ow - 2 * m) / (TOP_W1 * this.s);
      const [mw, mh] = this.mapInner(1);
      const kRow = (ow - 3 * m) / ((this.panelW + mw + 44) * this.s);
      const n = Math.max(1, this.cfg.players.length);
      const rowH = Math.max(
        (34 + 64 * n) * this.s * kRow,
        (mh + 82) * this.s * kRow
      );
      const total = 96 * this.s * kTop + m + vh + m + rowH;
      const top = Math.max(m, (oh - total) / 2);
      this.outW = ow;
      this.outH = oh;
      this.videoRect = [0, top + 96 * this.s * kTop + m, ow, vh];
      this.defScale.topHud = kTop;
      this.defScale.playerPanel = kRow;
      this.defScale.courtMap = kRow;
    } else {
      this.outW = this.videoW;
      this.outH = this.videoH;
      this.videoRect = [0, 0, w, h];
    }
  }

  private currentLayoutMap(): LayoutMap {
    if (this.stage === 'landscape') return this.cfg.render.layoutLandscape;
    if (this.stage === 'portrait') return this.cfg.render.layoutPortrait;
    return this.cfg.render.layout;
  }

  placementOf(name: HudPanelName): PanelPlacement | null | undefined {
    const map = this.currentLayoutMap();
    return map[name];
  }

  scaleOf(name: HudPanelName): number {
    const raw = this.placementOf(name)?.scale ?? this.defScale[name] ?? 1.0;
    return Math.max(0.4, Math.min(2.5, raw));
  }

  mapInner(scale: number): [number, number] {
    const longPx = 290 * scale;
    const shortPx =
      (longPx * PickleballCourtConstants.COURT_W) / PickleballCourtConstants.COURT_L;
    return this.court?.orientation === 'side' ? [longPx, shortPx] : [shortPx, longPx];
  }

  rect(
    name: HudPanelName,
    nPlayers: number = Math.max(1, this.cfg.players.length),
    nTop: number = this.cfg.score.enabled ? 4 : 3
  ): [number, number, number, number] {
    const sc = this.s * this.scaleOf(name);
    const m = 28 * this.s;
    const wOut = this.outW;
    const hOut = this.outH;
    const [vx, vy, vw, vh] = this.videoRect;

    let w: number;
    let h: number;
    if (name === 'topHud') {
      w = nTop * 290 * sc + (nTop - 1) * 16 * sc;
      h = 96 * sc;
    } else if (name === 'playerPanel') {
      w = this.panelW * sc;
      h = 34 * sc + 64 * sc * Math.max(1, nPlayers);
    } else if (name === 'speedBadge') {
      w = BADGE_W * sc;
      h = BADGE_H * sc;
    } else {
      const [mw, mh] = this.mapInner(sc);
      w = mw + 44 * sc;
      h = mh + 82 * sc;
    }

    let x: number;
    let y: number;
    if (name === 'speedBadge') {
      x = vx + vw - m - w;
      y = vy + vh * 0.28;
    } else if (this.stage === 'landscape') {
      if (name === 'topHud') {
        x = vx + (vw - w) / 2;
        y = vy + vh + m;
      } else if (name === 'playerPanel') {
        x = wOut - m - w;
        y = m;
      } else {
        const k = this.s * this.scaleOf('playerPanel');
        x = wOut - m - (this.panelW * k + w) / 2;
        y = 2 * m + (34 + 64 * Math.max(1, nPlayers)) * k;
      }
    } else if (this.stage === 'portrait') {
      if (name === 'topHud') {
        x = (wOut - w) / 2;
        y = vy - m - h;
      } else if (name === 'playerPanel') {
        x = m;
        y = vy + vh + m;
      } else {
        x = wOut - m - w;
        y = vy + vh + m;
      }
    } else {
      if (name === 'topHud') {
        x = (wOut - w) / 2;
        y = 24 * this.s;
      } else if (name === 'playerPanel') {
        x = m;
        y = hOut - m - h;
      } else {
        x = wOut - m - w;
        y = hOut - m - h;
      }
    }

    const custom = this.placementOf(name);
    if (custom) {
      x = custom.x * wOut;
      y = custom.y * hOut;
    }
    const clampedX = Math.max(0, Math.min(Math.max(0, wOut - w), x));
    const clampedY = Math.max(0, Math.min(Math.max(0, hOut - h), y));
    return [clampedX, clampedY, w, h];
  }

  buildFramePathD(
    x: number,
    y: number,
    w: number,
    h: number,
    skew: number = 0,
    radius: number = 8
  ): string {
    const f = this.cfg.render.frame;
    if (f === 'rounded') {
      const r = Math.min(h / 2, 22 * this.s);
      return this.roundedRectPathD(x, y, w, h, r);
    }
    if (f === 'tech') {
      return `M${x.toFixed(1)},${y.toFixed(1)} H${(x + w).toFixed(1)} V${(y + h).toFixed(1)} H${x.toFixed(1)} Z`;
    }
    if (skew > 0) {
      return `M${(x + skew).toFixed(1)},${y.toFixed(1)} L${(x + w).toFixed(1)},${y.toFixed(1)} L${(x + w - skew).toFixed(1)},${(y + h).toFixed(1)} L${x.toFixed(1)},${(y + h).toFixed(1)} Z`;
    }
    return this.roundedRectPathD(x, y, w, h, radius * this.s);
  }

  private roundedRectPathD(x: number, y: number, w: number, h: number, r: number): string {
    const cr = Math.max(0, Math.min(r, w / 2, h / 2));
    return [
      `M${(x + cr).toFixed(1)},${y.toFixed(1)}`,
      `H${(x + w - cr).toFixed(1)}`,
      `A${cr.toFixed(1)},${cr.toFixed(1)} 0 0 1 ${(x + w).toFixed(1)},${(y + cr).toFixed(1)}`,
      `V${(y + h - cr).toFixed(1)}`,
      `A${cr.toFixed(1)},${cr.toFixed(1)} 0 0 1 ${(x + w - cr).toFixed(1)},${(y + h).toFixed(1)}`,
      `H${(x + cr).toFixed(1)}`,
      `A${cr.toFixed(1)},${cr.toFixed(1)} 0 0 1 ${x.toFixed(1)},${(y + h - cr).toFixed(1)}`,
      `V${(y + cr).toFixed(1)}`,
      `A${cr.toFixed(1)},${cr.toFixed(1)} 0 0 1 ${(x + cr).toFixed(1)},${y.toFixed(1)}`,
      'Z',
    ].join(' ');
  }

  techCornerPathsD(x: number, y: number, w: number, h: number): string[] {
    if (this.cfg.render.frame !== 'tech') return [];
    const len = Math.min(16 * this.s, Math.min(w / 4, h / 3));
    const corners: [number, number, number, number][] = [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x + w, y + h, -1, -1],
      [x, y + h, 1, -1],
    ];
    return corners.map(
      ([cx, cy, dx, dy]) =>
        `M${cx.toFixed(1)},${(cy + dy * len).toFixed(1)} L${cx.toFixed(1)},${cy.toFixed(1)} L${(cx + dx * len).toFixed(1)},${cy.toFixed(1)}`
    );
  }

  ringColorHex(p: PlayerSnapshotItem): string {
    const r = this.cfg.render;
    if (r.showKitchenPresence && p.inKitchen) return '#FF5252';
    if (r.ringColor === 'team') {
      return p.team === 'A' ? r.teamAColor : r.teamBColor;
    }
    if (r.ringColor === 'theme') {
      return this.theme.accentHex;
    }
    return p.color;
  }

  projCircle(centerCourt: Point2D, radiusM: number, pts: Point2D[] = UNIT_CIRCLE): Point2D[] {
    if (!this.court) return [];
    return pts.map((u) =>
      this.court!.toImg(centerCourt.x + u.x * radiusM, centerCourt.y + u.y * radiusM)
    );
  }

  pointsToPathD(pts: Point2D[], close: boolean = true): string {
    if (pts.length === 0) return '';
    const cmds = pts.map(
      (p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`
    );
    if (close) cmds.push('Z');
    return cmds.join(' ');
  }

  rotatingArcPathsD(centerCourt: Point2D, t: number): string[] {
    const paths: string[] = [];
    for (let k = 0; k < 3; k++) {
      const a0 = ((t * 90 + k * 120) * Math.PI) / 180;
      const arcPts = Array.from({ length: 12 }, (_, i) => {
        const a = a0 + (i / 11) * ((38 * Math.PI) / 180);
        return { x: Math.cos(a), y: Math.sin(a) };
      });
      const proj = this.projCircle(
        centerCourt,
        this.cfg.render.ringRadiusM * 1.22,
        arcPts
      );
      paths.push(this.pointsToPathD(proj, false));
    }
    return paths;
  }
}

