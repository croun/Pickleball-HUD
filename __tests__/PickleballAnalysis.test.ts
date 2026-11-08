import {
  BounceEvent,
  createHitEvent,
  HitEvent,
  PickleballAnalysisResult,
  PickleballRallyAnalyzer,
  RallySegment,
} from '../src/analysis/PickleballRallyAnalyzer';
import { PickleballCourt, PickleballCourtConstants } from '../src/cv/PickleballCourt';
import { BoxWithPlayer } from '../src/cv/PlayerTracker';
import {
  CalloutType,
  createDefaultPickleballConfig,
  PlayerConfig,
  Point2D,
  ScoringMode,
} from '../src/model/PickleballConfig';
import { BuiltInPickleballDemoGenerator, VideoPipeline } from '../src/pipeline/VideoPipeline';

describe('PickleballAnalysis (React Native TypeScript)', () => {
  const sampleCorners: Point2D[] = [
    { x: 396, y: 136 },
    { x: 884, y: 136 },
    { x: 1100, y: 633 },
    { x: 180, y: 633 },
  ];

  test('courtHomography and Kitchen NVZ zones are accurate', () => {
    const court = new PickleballCourt(sampleCorners, 'behind');

    // Top-left corner maps to (0, 0)
    const tl = court.toCourt(396, 136);
    expect(tl.x).toBeCloseTo(0, 1);
    expect(tl.y).toBeCloseTo(0, 1);

    // Bottom-right corner maps to (6.10, 13.41)
    const br = court.toCourt(1100, 633);
    expect(br.x).toBeCloseTo(PickleballCourtConstants.COURT_W, 1);
    expect(br.y).toBeCloseTo(PickleballCourtConstants.COURT_L, 1);

    // Kitchen (Non-Volley Zone) is 7 ft (2.1336m) from net (6.705m)
    expect(court.isInKitchen({ x: 3.0, y: 5.2 })).toBe(true);
    expect(court.isInKitchen({ x: 3.0, y: 8.1 })).toBe(true);
    expect(court.isInKitchen({ x: 3.0, y: 1.5 })).toBe(false);
    expect(court.isInKitchen({ x: 3.0, y: 11.8 })).toBe(false);

    // Bounce in/out bounds
    expect(court.isBounceInBounds({ x: 3.0, y: 13.38 })).toBe(true);
    expect(court.isBounceInBounds({ x: 3.0, y: 14.1 })).toBe(false);
  });

  test('sideOutScoring 0-0-2 progresses correctly', () => {
    const court = new PickleballCourt(sampleCorners, 'behind');
    const players: PlayerConfig[] = [
      { name: 'Alex', color: '#FF5A36', team: 'A', side: 'far' },
      { name: 'Mia', color: '#FFB300', team: 'A', side: 'far' },
      { name: 'Liam', color: '#00E5FF', team: 'B', side: 'near' },
      { name: 'Zoe', color: '#7CFF4F', team: 'B', side: 'near' },
    ];
    const cfg = createDefaultPickleballConfig(players);
    cfg.score = {
      enabled: true,
      mode: ScoringMode.SIDE_OUT_0_0_2,
      startA: 0,
      startB: 0,
      startServerNum: 2,
    };

    // Rally 1: Team B serves (player 2) at 0-0-2 and wins rally via in-bounds winner bounce on far court
    const r1Hits: HitEvent[] = [
      createHitEvent({ frame: 10, player: 2, court: { x: 4.5, y: 13.0 } }),
      createHitEvent({ frame: 30, player: 0, court: { x: 1.5, y: 1.5 } }),
      createHitEvent({ frame: 50, player: 2, court: { x: 4.5, y: 9.0 } }),
    ];
    const r1Bounce: BounceEvent = {
      frame: 60,
      imgPos: court.toImg(1.2, 2.0),
      courtPos: { x: 1.2, y: 2.0 },
      isInBounds: true,
      isInKitchen: false,
      rallyIdx: 0,
    };

    // Rally 2: Team B serves at 1-0-2 and hits OUT past baseline -> Side Out to Team A (0-1-1)!
    const r2Hits: HitEvent[] = [
      createHitEvent({ frame: 100, player: 2, court: { x: 1.5, y: 13.0 } }),
      createHitEvent({ frame: 120, player: 1, court: { x: 4.5, y: 2.0 } }),
      createHitEvent({ frame: 140, player: 3, court: { x: 1.8, y: 9.2 } }),
    ];
    const r2OutBounce: BounceEvent = {
      frame: 155,
      imgPos: court.toImg(3.0, -0.8),
      courtPos: { x: 3.0, y: -0.8 },
      isInBounds: false,
      isInKitchen: false,
      rallyIdx: 1,
    };

    const an: PickleballAnalysisResult = {
      pos: new Array(200).fill(null),
      view: new Array(200).fill(null),
      hits: [...r1Hits, ...r2Hits],
      bounces: [r1Bounce, r2OutBounce],
      rallies: [
        {
          start: 10,
          end: 65,
          limit: null,
          hits: r1Hits,
          bounces: [r1Bounce],
          serve: r1Hits[0],
          box: null,
          byServe: false,
        },
        {
          start: 100,
          end: 160,
          limit: null,
          hits: r2Hits,
          bounces: [r2OutBounce],
          serve: r2Hits[0],
          box: null,
          byServe: false,
        },
      ],
    };

    const summary = PickleballRallyAnalyzer.buildPickleballScore(an, cfg, court);
    expect(summary.rows.length).toBe(2);
    expect(summary.rows[0].displayScore).toBe('1 - 0 - 2');
    expect(summary.rows[1].displayScore).toBe('0 - 1 - 1');
  });

  test('pickleballCallouts detect ThirdShotDrop, Dink, Drive, and ATP', () => {
    const hits: HitEvent[] = [
      createHitEvent({ frame: 10, player: 2, court: { x: 4.5, y: 13.0 }, speedKmh: 52 }),
      createHitEvent({ frame: 35, player: 0, court: { x: 1.6, y: 1.8 }, speedKmh: 48 }),
      // Shot #3 (index 2): from near baseline (y=11.5) into Kitchen (y=4.5) at 32 km/h -> 3RD SHOT DROP!
      createHitEvent({ frame: 60, player: 2, court: { x: 4.4, y: 11.5 }, speedKmh: 32 }),
      // Shot #4 (index 3): Kitchen to Kitchen at 22 km/h -> DINK
      createHitEvent({ frame: 90, player: 0, court: { x: 1.7, y: 4.5 }, speedKmh: 22 }),
      // Shot #5 (index 4): Around The Post (x crosses net outside [0, 6.1]) -> ATP!
      createHitEvent({ frame: 115, player: 3, court: { x: -0.35, y: 8.8 }, speedKmh: 44 }),
      createHitEvent({ frame: 135, player: 0, court: { x: -0.15, y: 4.8 }, speedKmh: 68 }),
    ];
    const rally: RallySegment = {
      start: 10,
      end: 145,
      limit: null,
      hits,
      bounces: [],
      serve: hits[0],
      box: null,
      byServe: false,
    };
    const emptyBoxes: BoxWithPlayer[][] = Array.from({ length: 160 }, () => []);

    PickleballRallyAnalyzer.markPickleballCallouts([rally], emptyBoxes, 30, 55);

    expect(hits[2].callout).toBe(CalloutType.THIRD_SHOT_DROP);
    expect(hits[3].callout).toBe(CalloutType.DINK);
    expect(hits[4].callout).toBe(CalloutType.ATP);
  });

  test('full two-pass VideoPipeline.renderVideo executes on built-in demo', async () => {
    const meta = VideoPipeline.createBuiltInDemoMetadata();
    const corners = BuiltInPickleballDemoGenerator.defaultCorners(meta.width, meta.height);
    const court = new PickleballCourt(corners, 'behind');
    const cfg = createDefaultPickleballConfig(BuiltInPickleballDemoGenerator.defaultPlayers());

    const result = await VideoPipeline.renderVideo({
      meta,
      cfg,
      court,
      startSec: 0,
      endSec: 6.5,
    });

    expect(result.totalFrames).toBeGreaterThan(100);
    expect(result.ralliesCount).toBeGreaterThanOrEqual(1);
    expect(result.totalShots).toBeGreaterThanOrEqual(4);
    expect(result.playerReports.length).toBe(4);
    expect(result.renderedFrames.length).toBe(result.totalFrames);
  });
});

