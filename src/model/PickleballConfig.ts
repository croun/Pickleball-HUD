import AsyncStorage from '@react-native-async-storage/async-storage';

export enum ScoringMode {
  SIDE_OUT_0_0_2 = 'SIDE_OUT_0_0_2', // Traditional Pickleball 0-0-2 side-out scoring
  RALLY_POINT = 'RALLY_POINT',       // Rally-point scoring (0-0)
}

export enum CalloutType {
  DRIVE = 'DRIVE',
  DINK = 'DINK',
  THIRD_SHOT_DROP = 'THIRD_SHOT_DROP',
  ATP = 'ATP',
  SPEED_UP = 'SPEED_UP',
  NVZ_FAULT = 'NVZ_FAULT',
}

export interface CalloutMeta {
  label: string;
  colorHex: string;
}

export const CALLOUT_INFO: Record<CalloutType, CalloutMeta> = {
  [CalloutType.DRIVE]: { label: 'DRIVE!', colorHex: '#FF9100' },
  [CalloutType.DINK]: { label: 'DINK', colorHex: '#00E5FF' },
  [CalloutType.THIRD_SHOT_DROP]: { label: '3RD SHOT DROP!', colorHex: '#7CFF4F' },
  [CalloutType.ATP]: { label: 'ATP! AROUND THE POST', colorHex: '#FF2BD6' },
  [CalloutType.SPEED_UP]: { label: 'SPEED-UP!', colorHex: '#FFE14D' },
  [CalloutType.NVZ_FAULT]: { label: 'NVZ KITCHEN FAULT!', colorHex: '#FF3D3D' },
};

export interface Point2D {
  x: number;
  y: number;
}

export interface PlayerConfig {
  name: string;
  color: string;
  team: 'A' | 'B';
  side: 'far' | 'near';
  hist?: number[] | null;
  seed?: Point2D | null;
}

export interface CourtConfig {
  orientation: 'behind' | 'side';
  marginM: number;
  showKitchenZone: boolean;
}

export interface ModelConfig {
  poseFile: string;
  ballFile: string;
  conf: number;
  iou: number;
  stride: number;
  useOnnxBall: boolean;
}

export interface TrackingConfig {
  maxSpeed: number;
  maxJump: number;
  lostTtl: number;
}

export interface StaminaConfig {
  start: number;
  drainPerMeter: number;
  min: number;
}

export interface SmoothingConfig {
  posAlpha: number;
  tagAlpha: number;
}

export interface ScoreConfig {
  enabled: boolean;
  mode: ScoringMode;
  startA: number;
  startB: number;
  startServerNum: number; // Traditional Pickleball starts at 0-0-2
}

export interface HighlightConfig {
  enabled: boolean;
  count: number;
}

export interface BadgeRankThresholds {
  sss: number;
  ss: number;
  s: number;
  a: number;
  b: number;
}

export interface BadgeConfig {
  mode: 'hit' | 'fixed' | 'off';
  secs: number;
  ranks: BadgeRankThresholds;
}

export interface PanelPlacement {
  x: number;
  y: number;
  scale: number;
}

export interface LayoutMap {
  topHud?: PanelPlacement | null;
  playerPanel?: PanelPlacement | null;
  courtMap?: PanelPlacement | null;
  speedBadge?: PanelPlacement | null;
}

export type HudThemeName = 'broadcast' | 'esports' | 'gold' | 'volt' | 'light';
export type HudFrameStyle = 'angled' | 'rounded' | 'tech';
export type HudRingStyle = 'neon' | 'solid' | 'minimal';
export type HudStageMode = 'overlay' | 'landscape' | 'portrait';

export interface RenderConfig {
  ringRadiusM: number;
  tags: boolean;
  topHud: boolean;
  playerPanel: boolean;
  courtMap: boolean;
  ballMark: boolean;
  showIds: boolean;
  tagScale: number;
  playerStats: boolean;
  trails: boolean;
  skeleton: boolean;
  theme: HudThemeName;
  frame: HudFrameStyle;
  ringStyle: HudRingStyle;
  ringColor: 'player' | 'team' | 'theme';
  teamAColor: string;
  teamBColor: string;
  showKitchenPresence: boolean;
  showBounceMarkers: boolean;
  calloutsEnabled: boolean;
  driveMinKmh: number;
  badge: BadgeConfig;
  stage: HudStageMode;
  layout: LayoutMap;
  layoutLandscape: LayoutMap;
  layoutPortrait: LayoutMap;
}

export interface PickleballConfig {
  players: PlayerConfig[];
  court: CourtConfig;
  model: ModelConfig;
  tracking: TrackingConfig;
  stamina: StaminaConfig;
  deadbandM: number;
  smoothing: SmoothingConfig;
  score: ScoreConfig;
  highlight: HighlightConfig;
  render: RenderConfig;
}

export function createDefaultPickleballConfig(players: PlayerConfig[] = []): PickleballConfig {
  return {
    players,
    court: {
      orientation: 'behind',
      marginM: 1.2,
      showKitchenZone: true,
    },
    model: {
      poseFile: 'models/yolo11n-pose.onnx',
      ballFile: 'models/wasb.onnx',
      conf: 0.3,
      iou: 0.5,
      stride: 2,
      useOnnxBall: true,
    },
    tracking: {
      maxSpeed: 7.0,
      maxJump: 1.5,
      lostTtl: 1.0,
    },
    stamina: {
      start: 100,
      drainPerMeter: 0.25,
      min: 5,
    },
    deadbandM: 0.15,
    smoothing: {
      posAlpha: 0.45,
      tagAlpha: 0.25,
    },
    score: {
      enabled: true,
      mode: ScoringMode.SIDE_OUT_0_0_2,
      startA: 0,
      startB: 0,
      startServerNum: 2,
    },
    highlight: {
      enabled: true,
      count: 3,
    },
    render: {
      ringRadiusM: 0.52,
      tags: true,
      topHud: true,
      playerPanel: true,
      courtMap: true,
      ballMark: true,
      showIds: false,
      tagScale: 0.65,
      playerStats: true,
      trails: true,
      skeleton: false,
      theme: 'broadcast',
      frame: 'angled',
      ringStyle: 'neon',
      ringColor: 'player',
      teamAColor: '#FF5A36',
      teamBColor: '#2E9BFF',
      showKitchenPresence: true,
      showBounceMarkers: true,
      calloutsEnabled: true,
      driveMinKmh: 55,
      badge: {
        mode: 'hit',
        secs: 0.8,
        ranks: {
          sss: 85,
          ss: 70,
          s: 55,
          a: 40,
          b: 25,
        },
      },
      stage: 'overlay',
      layout: {},
      layoutLandscape: {},
      layoutPortrait: {},
    },
  };
}

export interface SpeedRankInfo {
  rank: string;
  name: string;
  colorHex: string;
}

export const PickleballSpeedRanks = {
  TIERS: [
    { rank: 'SSS', name: 'SONIC DRIVE', colorHex: '#D96BFF' },
    { rank: 'SS', name: 'RIPPED DRIVE', colorHex: '#FF3D7F' },
    { rank: 'S', name: 'POWER DRIVE', colorHex: '#FF9100' },
    { rank: 'A', name: 'FAST PACE', colorHex: '#FFC400' },
    { rank: 'B', name: 'DROP / COUNTER', colorHex: '#7CFF4F' },
    { rank: 'C', name: 'SOFT DINK', colorHex: '#00E5FF' },
  ] as SpeedRankInfo[],

  rankOf(
    kmh: number,
    thresholds: BadgeRankThresholds = { sss: 85, ss: 70, s: 55, a: 40, b: 25 }
  ): SpeedRankInfo {
    if (kmh >= thresholds.sss) return this.TIERS[0];
    if (kmh >= thresholds.ss) return this.TIERS[1];
    if (kmh >= thresholds.s) return this.TIERS[2];
    if (kmh >= thresholds.a) return this.TIERS[3];
    if (kmh >= thresholds.b) return this.TIERS[4];
    return this.TIERS[5];
  },
};

const KEY_CONFIG = 'phud.config.v1';

export class ConfigRepository {
  private memoryCache = new Map<string, string>();

  async loadConfig(): Promise<PickleballConfig> {
    try {
      const raw = (await AsyncStorage.getItem(KEY_CONFIG)) ?? this.memoryCache.get(KEY_CONFIG);
      if (!raw) return createDefaultPickleballConfig();
      const parsed = JSON.parse(raw) as Partial<PickleballConfig>;
      const def = createDefaultPickleballConfig();
      return {
        ...def,
        ...parsed,
        court: { ...def.court, ...parsed.court },
        model: { ...def.model, ...parsed.model },
        tracking: { ...def.tracking, ...parsed.tracking },
        stamina: { ...def.stamina, ...parsed.stamina },
        smoothing: { ...def.smoothing, ...parsed.smoothing },
        score: { ...def.score, ...parsed.score },
        highlight: { ...def.highlight, ...parsed.highlight },
        render: {
          ...def.render,
          ...parsed.render,
          badge: {
            ...def.render.badge,
            ...parsed.render?.badge,
            ranks: { ...def.render.badge.ranks, ...parsed.render?.badge?.ranks },
          },
        },
      };
    } catch {
      return createDefaultPickleballConfig();
    }
  }

  async saveConfig(cfg: PickleballConfig): Promise<void> {
    const serialized = JSON.stringify(cfg);
    this.memoryCache.set(KEY_CONFIG, serialized);
    try {
      await AsyncStorage.setItem(KEY_CONFIG, serialized);
    } catch {
      // Fallback to in-memory cache if AsyncStorage is unavailable in test/CLI environments
    }
  }

  async loadCorners(videoKey: string): Promise<Point2D[] | null> {
    const k = `corners_${videoKey}`;
    try {
      const raw = (await AsyncStorage.getItem(k)) ?? this.memoryCache.get(k);
      if (!raw) return null;
      const pts = JSON.parse(raw) as Point2D[];
      return Array.isArray(pts) && pts.length === 4 ? pts : null;
    } catch {
      return null;
    }
  }

  async saveCorners(videoKey: string, corners: Point2D[]): Promise<void> {
    const k = `corners_${videoKey}`;
    const serialized = JSON.stringify(corners);
    this.memoryCache.set(k, serialized);
    try {
      await AsyncStorage.setItem(k, serialized);
    } catch {
      // Ignore storage write errors in non-device environments
    }
  }

  async clearAll(): Promise<void> {
    this.memoryCache.clear();
    try {
      await AsyncStorage.clear();
    } catch {
      // Ignore
    }
  }
}

