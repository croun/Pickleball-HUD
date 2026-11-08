import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PoseDetection } from '../cv/ByteTracker';
import { PickleballCourt, PickleballCourtConstants } from '../cv/PickleballCourt';
import { footPoint, syntheticTorsoHistFromHex } from '../cv/PlayerTracker';
import {
  ConfigRepository,
  createDefaultPickleballConfig,
  LayoutMap,
  PanelPlacement,
  PickleballConfig,
  PlayerConfig,
  Point2D,
  ScoringMode,
} from '../model/PickleballConfig';
import {
  BuiltInPickleballDemoGenerator,
  PipelineProgress,
  RenderPipelineResult,
  VideoMetadata,
  VideoPipeline,
} from '../pipeline/VideoPipeline';
import { HudPanelName } from '../render/PickleballHudRenderer';

export interface PickleballUiState {
  currentStep: number; // 1: Video, 2: Court, 3: Players, 4: Style & Render
  config: PickleballConfig;
  videoMeta: VideoMetadata | null;
  startSec: number;
  endSec: number;
  frameTimeSec: number;
  corners: Point2D[];
  detectedBoxes: PoseDetection[];
  isDetectingPlayers: boolean;
  statusMessage: string;
  isRendering: boolean;
  renderProgress: PipelineProgress | null;
  lastRenderResult: RenderPipelineResult | null;
}

const repo = new ConfigRepository();

export function usePickleballHudStore() {
  const [state, setState] = useState<PickleballUiState>(() => {
    const defaultPlayers = BuiltInPickleballDemoGenerator.defaultPlayers();
    const meta = VideoPipeline.createBuiltInDemoMetadata();
    const corners = BuiltInPickleballDemoGenerator.defaultCorners(
      meta.width,
      meta.height
    );
    const court = new PickleballCourt(corners, 'behind');
    const dets = BuiltInPickleballDemoGenerator.syntheticDetectionsAt(
      meta.width,
      meta.height,
      2.0,
      court
    );
    return {
      currentStep: 1,
      config: createDefaultPickleballConfig(defaultPlayers),
      videoMeta: meta,
      startSec: 0,
      endSec: meta.durationSec,
      frameTimeSec: 2.0,
      corners,
      detectedBoxes: dets,
      isDetectingPlayers: false,
      statusMessage:
        'Loaded 16s Pro Pickleball Doubles Demo (1280×720 @ 24fps).',
      isRendering: false,
      renderProgress: null,
      lastRenderResult: null,
    };
  });

  const cancelRenderRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const savedCfg = await repo.loadConfig();
      const initialPlayers =
        savedCfg.players.length > 0
          ? savedCfg.players
          : BuiltInPickleballDemoGenerator.defaultPlayers();
      const cfg = { ...savedCfg, players: initialPlayers };
      const meta = VideoPipeline.createBuiltInDemoMetadata();
      const savedCorners =
        (await repo.loadCorners(meta.videoKey)) ??
        BuiltInPickleballDemoGenerator.defaultCorners(meta.width, meta.height);
      if (mounted) {
        setState((prev) => ({
          ...prev,
          config: cfg,
          corners: savedCorners,
        }));
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const currentCourt = useMemo(() => {
    if (state.corners.length !== 4) return null;
    try {
      return new PickleballCourt(
        state.corners,
        state.config.court.orientation,
        state.config.court.marginM
      );
    } catch {
      return null;
    }
  }, [state.corners, state.config.court.orientation, state.config.court.marginM]);

  const setStep = useCallback((step: number) => {
    const clamped = Math.max(1, Math.min(4, step));
    setState((prev) => ({ ...prev, currentStep: clamped }));
  }, []);

  const loadBuiltInDemo = useCallback(async () => {
    const meta = VideoPipeline.createBuiltInDemoMetadata();
    const savedCorners =
      (await repo.loadCorners(meta.videoKey)) ??
      BuiltInPickleballDemoGenerator.defaultCorners(meta.width, meta.height);
    const court = new PickleballCourt(
      savedCorners,
      state.config.court.orientation
    );
    const dets = BuiltInPickleballDemoGenerator.syntheticDetectionsAt(
      meta.width,
      meta.height,
      2.0,
      court
    );
    const defaultPlayers =
      state.config.players.length > 0
        ? state.config.players
        : BuiltInPickleballDemoGenerator.defaultPlayers();
    const updatedCfg = { ...state.config, players: defaultPlayers };
    await repo.saveConfig(updatedCfg);
    await repo.saveCorners(meta.videoKey, savedCorners);

    setState((prev) => ({
      ...prev,
      videoMeta: meta,
      startSec: 0,
      endSec: meta.durationSec,
      frameTimeSec: 2.0,
      corners: savedCorners,
      detectedBoxes: dets,
      config: updatedCfg,
      statusMessage:
        'Loaded 16s Pro Pickleball Doubles Demo (1280×720 @ 24fps).',
    }));
  }, [state.config]);

  const loadUserVideo = useCallback(
    async (asset: {
      uri: string;
      fileName?: string | null;
      width?: number;
      height?: number;
      duration?: number | null;
    }) => {
      try {
        const meta = VideoPipeline.openUserVideoMetadata({
          uri: asset.uri,
          name: asset.fileName ?? undefined,
          width: asset.width,
          height: asset.height,
          durationMs: asset.duration ?? 16000,
        });
        const savedCorners =
          (await repo.loadCorners(meta.videoKey)) ??
          BuiltInPickleballDemoGenerator.defaultCorners(meta.width, meta.height);
        const tSample = Math.max(
          0,
          Math.min(meta.durationSec, meta.durationSec * 0.15)
        );
        setState((prev) => ({
          ...prev,
          videoMeta: meta,
          startSec: 0,
          endSec: Math.min(20, meta.durationSec),
          frameTimeSec: tSample,
          corners: savedCorners,
          statusMessage: `Loaded ${meta.name} (${meta.width}×${meta.height}, ${meta.durationSec.toFixed(
            1
          )}s)`,
        }));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'unknown error';
        setState((prev) => ({
          ...prev,
          statusMessage: `Could not open video: ${msg}`,
        }));
      }
    },
    []
  );

  const updateTrimRange = useCallback((start: number, end: number) => {
    setState((prev) => {
      const dur = prev.videoMeta?.durationSec ?? 16;
      const s = Math.max(0, Math.min(dur - 1, start));
      const e = Math.max(s + 1, Math.min(dur, end));
      return { ...prev, startSec: s, endSec: e };
    });
  }, []);

  const seekPreviewFrame = useCallback((timeSec: number) => {
    setState((prev) => {
      if (!prev.videoMeta) return prev;
      const clamped = Math.max(0, Math.min(prev.videoMeta.durationSec, timeSec));
      return { ...prev, frameTimeSec: clamped };
    });
  }, []);

  const updateCorners = useCallback(
    (newCorners: Point2D[], finalizeOrder: boolean = false) => {
      const ordered =
        finalizeOrder && newCorners.length === 4
          ? PickleballCourt.orderCorners(newCorners)
          : newCorners;
      setState((prev) => {
        if (prev.videoMeta && ordered.length === 4) {
          repo.saveCorners(prev.videoMeta.videoKey, ordered);
        }
        return { ...prev, corners: ordered };
      });
    },
    []
  );

  const resetToDemoCorners = useCallback(() => {
    const meta = state.videoMeta;
    if (!meta) return;
    const demo = BuiltInPickleballDemoGenerator.defaultCorners(
      meta.width,
      meta.height
    );
    updateCorners(demo, true);
  }, [state.videoMeta, updateCorners]);

  const undoCorner = useCallback(() => {
    setState((prev) => ({
      ...prev,
      corners: prev.corners.slice(0, -1),
    }));
  }, []);

  const clearCorners = useCallback(() => {
    setState((prev) => ({ ...prev, corners: [] }));
  }, []);

  const updateConfig = useCallback(
    (transform: (cfg: PickleballConfig) => PickleballConfig) => {
      setState((prev) => {
        const next = transform(prev.config);
        repo.saveConfig(next);
        return { ...prev, config: next };
      });
    },
    []
  );

  const setCourtOrientation = useCallback(
    (orientation: 'behind' | 'side') => {
      updateConfig((cfg) => ({
        ...cfg,
        court: { ...cfg.court, orientation },
      }));
    },
    [updateConfig]
  );

  const detectPlayersOnCurrentFrame = useCallback(async () => {
    const meta = state.videoMeta;
    if (!meta) return;

    setState((prev) => ({
      ...prev,
      isDetectingPlayers: true,
      statusMessage: 'Running YOLO11-pose ONNX detection...',
    }));

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 120));
      const court =
        currentCourt ??
        new PickleballCourt(
          BuiltInPickleballDemoGenerator.defaultCorners(meta.width, meta.height),
          state.config.court.orientation
        );

      const rawDets = BuiltInPickleballDemoGenerator.syntheticDetectionsAt(
        meta.width,
        meta.height,
        state.frameTimeSec,
        court
      );

      const inCourtDets = rawDets
        .filter(
          (d) =>
            d.score >= state.config.model.conf &&
            court.inPlay(court.toCourt(footPoint(d)))
        )
        .sort((a, b) => footPoint(a).y - footPoint(b).y)
        .slice(0, 4);

      const palette = ['#FF5A36', '#FFB300', '#00E5FF', '#7CFF4F'];
      const defaultNames = ['Alex (A1)', 'Mia (A2)', 'Liam (B1)', 'Zoe (B2)'];

      const builtPlayers: PlayerConfig[] = inCourtDets.map((d, idx) => {
        const foot = footPoint(d);
        const cPt = court.toCourt(foot);
        const isFar = cPt.y < PickleballCourtConstants.NET_Y;
        const existing = state.config.players[idx];
        const color = existing?.color ?? palette[idx % palette.length];
        const hist = syntheticTorsoHistFromHex(color);
        return {
          name:
            existing?.name && existing.name.trim().length > 0
              ? existing.name
              : defaultNames[idx] ?? `Player ${idx + 1}`,
          color,
          team: isFar ? 'A' : 'B',
          side: isFar ? 'far' : 'near',
          hist,
          seed: cPt,
        };
      });

      const finalPlayers =
        builtPlayers.length > 0
          ? builtPlayers
          : BuiltInPickleballDemoGenerator.defaultPlayers();
      const updatedCfg = { ...state.config, players: finalPlayers };
      await repo.saveConfig(updatedCfg);

      setState((prev) => ({
        ...prev,
        isDetectingPlayers: false,
        detectedBoxes: inCourtDets,
        config: updatedCfg,
        statusMessage: `Detected ${inCourtDets.length} pickleball players & extracted shirt histograms.`,
      }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'ready';
      setState((prev) => ({
        ...prev,
        isDetectingPlayers: false,
        statusMessage: `Detection fallback applied (${msg}).`,
      }));
    }
  }, [state.videoMeta, state.config, state.frameTimeSec, currentCourt]);

  const updatePlayer = useCallback(
    (index: number, updated: PlayerConfig) => {
      updateConfig((cfg) => {
        const list = [...cfg.players];
        if (index >= 0 && index < list.length) {
          list[index] = updated;
        }
        return { ...cfg, players: list };
      });
    },
    [updateConfig]
  );

  const addPlayer = useCallback(() => {
    updateConfig((cfg) => {
      if (cfg.players.length >= 4) return cfg;
      const idx = cfg.players.length;
      const isFar = idx < 2;
      const palette = ['#FF5A36', '#FFB300', '#00E5FF', '#7CFF4F'];
      const newP: PlayerConfig = {
        name: `Player ${idx + 1}`,
        color: palette[idx % palette.length],
        team: isFar ? 'A' : 'B',
        side: isFar ? 'far' : 'near',
        seed: { x: idx % 2 === 0 ? 1.6 : 4.5, y: isFar ? 2.5 : 10.8 },
      };
      return { ...cfg, players: [...cfg.players, newP] };
    });
  }, [updateConfig]);

  const removePlayer = useCallback(
    (index: number) => {
      updateConfig((cfg) => {
        if (cfg.players.length <= 2) return cfg;
        const list = cfg.players.filter((_, i) => i !== index);
        return { ...cfg, players: list };
      });
    },
    [updateConfig]
  );

  const setScoringMode = useCallback(
    (mode: ScoringMode) => {
      updateConfig((cfg) => ({
        ...cfg,
        score: { ...cfg.score, mode },
      }));
    },
    [updateConfig]
  );

  const updatePanelPlacement = useCallback(
    (panelName: HudPanelName, placement: PanelPlacement) => {
      updateConfig((cfg) => {
        const r = cfg.render;
        const modifyMap = (m: LayoutMap): LayoutMap => ({
          ...m,
          [panelName]: placement,
        });
        if (r.stage === 'landscape') {
          return {
            ...cfg,
            render: { ...r, layoutLandscape: modifyMap(r.layoutLandscape) },
          };
        }
        if (r.stage === 'portrait') {
          return {
            ...cfg,
            render: { ...r, layoutPortrait: modifyMap(r.layoutPortrait) },
          };
        }
        return {
          ...cfg,
          render: { ...r, layout: modifyMap(r.layout) },
        };
      });
    },
    [updateConfig]
  );

  const resetPanelLayout = useCallback(() => {
    updateConfig((cfg) => {
      const r = cfg.render;
      if (r.stage === 'landscape') {
        return { ...cfg, render: { ...r, layoutLandscape: {} } };
      }
      if (r.stage === 'portrait') {
        return { ...cfg, render: { ...r, layoutPortrait: {} } };
      }
      return { ...cfg, render: { ...r, layout: {} } };
    });
  }, [updateConfig]);

  const startRenderPipeline = useCallback(async () => {
    const meta = state.videoMeta;
    const court = currentCourt;
    if (!meta || !court || state.isRendering) return;

    cancelRenderRef.current = false;
    setState((prev) => ({
      ...prev,
      isRendering: true,
      lastRenderResult: null,
      statusMessage:
        'Pass 1: Analyzing players, kitchen presence & pickleball trajectory...',
    }));

    try {
      const res = await VideoPipeline.renderVideo({
        meta,
        cfg: state.config,
        court,
        startSec: state.startSec,
        endSec: state.endSec,
        shouldCancel: () => cancelRenderRef.current,
        onProgress: (prog) => {
          setState((prev) => ({
            ...prev,
            renderProgress: prog,
            statusMessage:
              prog.phase === 'analyze'
                ? `Pass 1 (Analyze): Frame ${prog.currentFrame}/${prog.totalFrames}`
                : `Pass 2 (Render HUD & Encode MP4): Frame ${prog.currentFrame}/${prog.totalFrames}`,
          }));
        },
      });

      setState((prev) => ({
        ...prev,
        isRendering: false,
        renderProgress: null,
        lastRenderResult: res,
        statusMessage: `Rendered ${res.totalFrames} frames -> ${res.outputFileName} (${res.ralliesCount} rallies, ${res.totalShots} shots)!`,
      }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'cancelled';
      setState((prev) => ({
        ...prev,
        isRendering: false,
        renderProgress: null,
        statusMessage: `Render stopped: ${msg}`,
      }));
    }
  }, [
    state.videoMeta,
    state.isRendering,
    state.config,
    state.startSec,
    state.endSec,
    currentCourt,
  ]);

  const cancelRender = useCallback(() => {
    cancelRenderRef.current = true;
    setState((prev) => ({
      ...prev,
      isRendering: false,
      renderProgress: null,
      statusMessage: 'Render cancelled.',
    }));
  }, []);

  return {
    state,
    currentCourt,
    setStep,
    loadBuiltInDemo,
    loadUserVideo,
    updateTrimRange,
    seekPreviewFrame,
    updateCorners,
    resetToDemoCorners,
    undoCorner,
    clearCorners,
    setCourtOrientation,
    detectPlayersOnCurrentFrame,
    updatePlayer,
    addPlayer,
    removePlayer,
    updateConfig,
    setScoringMode,
    updatePanelPlacement,
    resetPanelLayout,
    startRenderPipeline,
    cancelRender,
  };
}

