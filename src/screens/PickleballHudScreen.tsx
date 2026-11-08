import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { InteractiveCourtCalibrationCanvas } from '../components/InteractiveCourtCalibrationCanvas';
import { PickleballHudSvgCanvas } from '../components/PickleballHudSvgCanvas';
import { PlayerCourtHeatmapCard } from '../components/PlayerCourtHeatmapCard';
import { SeekSlider, TrimRangeSlider } from '../components/RangeAndSeekSliders';
import {
  HudFrameStyle,
  HudStageMode,
  HudThemeName,
  PlayerConfig,
  ScoringMode,
} from '../model/PickleballConfig';
import { RenderPipelineResult } from '../pipeline/VideoPipeline';
import { usePickleballHudStore } from '../state/usePickleballHudStore';

const NAVY_BG = '#070F1E';
const NAVY_SURFACE = '#0E1B33';
const NAVY_CARD = '#132342';
const CYAN_ACCENT = '#00E5FF';
const NEON_VOLT = '#B6FF2E';
const MUTED_TEXT = '#9FB4D0';

const STEPS = ['1. Video', '2. Court (NVZ)', '3. Players', '4. Style & Render'];
const COLOR_PRESETS = [
  '#FF5A36',
  '#FFB300',
  '#00E5FF',
  '#7CFF4F',
  '#FF2BD6',
  '#B6FF2E',
];
const THEMES: HudThemeName[] = ['broadcast', 'esports', 'gold', 'volt', 'light'];
const STAGES: { key: HudStageMode; label: string }[] = [
  { key: 'overlay', label: 'Overlay' },
  { key: 'landscape', label: '16:9 Inset' },
  { key: 'portrait', label: '9:16 Reels' },
];
const FRAMES: HudFrameStyle[] = ['angled', 'rounded', 'tech'];

export const PickleballHudScreen: React.FC = () => {
  const store = usePickleballHudStore();
  const { state, currentCourt } = store;
  const [showVideoModal, setShowVideoModal] = useState(false);

  const canAdvance =
    state.currentStep === 1
      ? state.videoMeta !== null
      : state.currentStep === 2
      ? state.corners.length === 4
      : state.currentStep === 3
      ? state.config.players.length > 0
      : false;

  const handlePickVideo = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 1,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        await store.loadUserVideo({
          uri: asset.uri,
          fileName: asset.fileName,
          width: asset.width,
          height: asset.height,
          duration: asset.duration,
        });
      }
    } catch {
      await store.loadBuiltInDemo();
    }
  };

  const handleShareMp4 = async (res: RenderPipelineResult) => {
    try {
      await Share.share({
        title: 'Share Pickleball HUD MP4',
        message: `Pickleball Broadcast HUD Video: ${res.outputFileName} | Final Score: ${
          res.scoreSummary?.finalDisplay ?? '0-0-2'
        } | ${res.ralliesCount} Rallies, ${res.totalShots} Shots, Top Speed ${
          res.topSpeedKmh ?? '--'
        } km/h`,
        url: res.outputUri ?? undefined,
      });
    } catch {
      // Ignore share cancellation
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header Bar */}
      <View style={styles.topHeader}>
        <View style={styles.brandRow}>
          <View style={styles.brandIconCircle}>
            <Text style={styles.brandIconText}>PB</Text>
          </View>
          <View style={styles.brandTitles}>
            <Text style={styles.appTitle}>PICKLEBALL GENERATE HUD</Text>
            <Text style={styles.appSubtitle}>
              ONNX YOLO11-Pose · Kitchen NVZ · 0-0-2 Side-Out · Broadcast MP4
            </Text>
          </View>
        </View>

        <View style={styles.stepTabsRow}>
          {STEPS.map((label, idx) => {
            const stepNum = idx + 1;
            const active = state.currentStep === stepNum;
            const done = state.currentStep > stepNum;
            return (
              <TouchableOpacity
                key={label}
                style={[
                  styles.stepTab,
                  active && styles.stepTabActive,
                  done && styles.stepTabDone,
                ]}
                onPress={() => store.setStep(stepNum)}
              >
                <Text
                  style={[
                    styles.stepTabText,
                    active && styles.stepTabTextActive,
                    done && styles.stepTabTextDone,
                  ]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Main Content ScrollView */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Status Banner */}
        <View style={styles.statusBanner}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>{state.statusMessage}</Text>
        </View>

        {/* STEP 1: VIDEO SELECTION & TRIMMING */}
        {state.currentStep === 1 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>1. Select Pickleball Footage</Text>
            <Text style={styles.sectionSubtitle}>
              Pick an MP4 video recorded from a fixed camera behind or beside the
              court, or use the built-in 16s Pro Doubles Demo.
            </Text>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.primaryBtn, { flex: 1 }]}
                onPress={handlePickVideo}
              >
                <Text style={styles.primaryBtnText}>Pick MP4 Video</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.outlineVoltBtn, { flex: 1 }]}
                onPress={() => store.loadBuiltInDemo()}
              >
                <Text style={styles.outlineVoltBtnText}>Built-in 16s Demo</Text>
              </TouchableOpacity>
            </View>

            {state.videoMeta && (
              <>
                <View style={styles.previewBox}>
                  <PickleballHudSvgCanvas
                    videoW={state.videoMeta.width}
                    videoH={state.videoMeta.height}
                    tSec={state.frameTimeSec}
                    cfg={state.config}
                    court={currentCourt}
                    showHudOverlays={false}
                  />
                  <View style={styles.metaBadgeOverlay}>
                    <Text style={styles.metaBadgeText}>
                      {`${state.videoMeta.name} · ${state.videoMeta.width}×${
                        state.videoMeta.height
                      } · ${Math.round(state.videoMeta.fps)} FPS`}
                    </Text>
                  </View>
                </View>

                <View style={styles.sliderSection}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.sliderTitle}>
                      {`Clip Range: ${state.startSec.toFixed(1)}s – ${state.endSec.toFixed(
                        1
                      )}s (${(state.endSec - state.startSec).toFixed(1)}s)`}
                    </Text>
                    <View style={styles.quickActionRow}>
                      <TouchableOpacity
                        onPress={() =>
                          store.updateTrimRange(
                            0,
                            Math.min(6.5, state.videoMeta!.durationSec)
                          )
                        }
                      >
                        <Text style={styles.quickLinkCyan}>Quick 6s</Text>
                      </TouchableOpacity>
                      <Text style={styles.quickSep}>·</Text>
                      <TouchableOpacity
                        onPress={() =>
                          store.updateTrimRange(0, state.videoMeta!.durationSec)
                        }
                      >
                        <Text style={styles.quickLinkVolt}>Full Clip</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <TrimRangeSlider
                    start={state.startSec}
                    end={state.endSec}
                    min={0}
                    max={Math.max(2, state.videoMeta.durationSec)}
                    onChange={(s, e) => store.updateTrimRange(s, e)}
                  />

                  <Text style={styles.seekLabel}>
                    {`Preview Frame Time: ${state.frameTimeSec.toFixed(1)}s`}
                  </Text>
                  <SeekSlider
                    value={state.frameTimeSec}
                    min={0}
                    max={Math.max(1, state.videoMeta.durationSec)}
                    onChange={(t) => store.seekPreviewFrame(t)}
                  />
                </View>
              </>
            )}
          </View>
        )}

        {/* STEP 2: COURT & 7-FT KITCHEN (NVZ) CALIBRATION */}
        {state.currentStep === 2 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              2. Calibrate 20×44 ft Pickleball Court
            </Text>
            <Text style={styles.sectionSubtitle}>
              Tap or drag the 4 outer court corners in any order. The 7-ft
              Non-Volley Zone (Kitchen) & service lines map automatically.
            </Text>

            <View style={styles.chipRow}>
              <FilterChipPill
                label="Camera Behind Baseline"
                selected={state.config.court.orientation === 'behind'}
                onPress={() => store.setCourtOrientation('behind')}
              />
              <FilterChipPill
                label="Side View"
                selected={state.config.court.orientation === 'side'}
                onPress={() => store.setCourtOrientation('side')}
              />
            </View>

            <InteractiveCourtCalibrationCanvas
              frameW={state.videoMeta?.width ?? 1280}
              frameH={state.videoMeta?.height ?? 720}
              corners={state.corners}
              orientation={state.config.court.orientation}
              showKitchenZone={state.config.court.showKitchenZone}
              onCornersChange={(pts, done) => store.updateCorners(pts, done)}
            />

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[
                  styles.outlineBtn,
                  { flex: 1 },
                  state.corners.length === 0 && styles.disabledBtn,
                ]}
                disabled={state.corners.length === 0}
                onPress={() => store.undoCorner()}
              >
                <Text style={styles.outlineBtnText}>Undo</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.outlineBtn,
                  { flex: 1 },
                  state.corners.length === 0 && styles.disabledBtn,
                ]}
                disabled={state.corners.length === 0}
                onPress={() => store.clearCorners()}
              >
                <Text style={styles.outlineBtnText}>Clear</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryBtn, { flex: 1.4 }]}
                onPress={() => store.resetToDemoCorners()}
              >
                <Text style={styles.primaryBtnText}>Preset 4 Corners</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* STEP 3: PLAYERS & YOLO11-POSE DETECTION */}
        {state.currentStep === 3 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              3. Players & Shirt Fingerprints
            </Text>
            <Text style={styles.sectionSubtitle}>
              YOLO11-pose detects players and locks onto their torso colors so
              doubles partners never swap IDs at the Kitchen line.
            </Text>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  { flex: 1 },
                  state.isDetectingPlayers && styles.disabledBtn,
                ]}
                disabled={state.isDetectingPlayers}
                onPress={() => store.detectPlayersOnCurrentFrame()}
              >
                {state.isDetectingPlayers ? (
                  <ActivityIndicator size="small" color={NAVY_BG} />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    Auto-Detect Players (YOLO11)
                  </Text>
                )}
              </TouchableOpacity>

              {state.config.players.length < 4 && (
                <TouchableOpacity
                  style={styles.outlineBtn}
                  onPress={() => store.addPlayer()}
                >
                  <Text style={styles.outlineBtnText}>+ Add Player</Text>
                </TouchableOpacity>
              )}
            </View>

            {state.config.players.map((player, idx) => (
              <PlayerConfigCard
                key={`pcard-${idx}`}
                index={idx}
                player={player}
                canRemove={state.config.players.length > 2}
                onUpdate={(updated) => store.updatePlayer(idx, updated)}
                onRemove={() => store.removePlayer(idx)}
              />
            ))}
          </View>
        )}

        {/* STEP 4: STYLE, INTERACTIVE HUD LAYOUT EDITOR, RENDER & ANALYTICS */}
        {state.currentStep === 4 && (
          <>
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.sectionTitle}>
                    4. Broadcast HUD Layout & Pickleball Rules
                  </Text>
                  <Text style={styles.sectionSubtitle}>
                    Drag any HUD panel on the preview below to reposition it.
                    Choose themes, 0-0-2 scoring, and render to MP4.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.outlineBtnSmall}
                  onPress={() => store.resetPanelLayout()}
                >
                  <Text style={styles.outlineBtnTextSmall}>Reset Layout</Text>
                </TouchableOpacity>
              </View>

              {/* Live Interactive HUD Layout Preview Canvas (or live render progress frame) */}
              <PickleballHudSvgCanvas
                videoW={state.videoMeta?.width ?? 1280}
                videoH={state.videoMeta?.height ?? 720}
                tSec={
                  state.renderProgress?.previewFrame?.tAbsSec ??
                  state.frameTimeSec
                }
                cfg={state.config}
                court={currentCourt}
                snap={state.renderProgress?.previewFrame?.snap}
                ballState={state.renderProgress?.previewFrame?.ballState}
                trails={state.renderProgress?.previewFrame?.trails}
                preview={state.renderProgress?.phase === 'analyze'}
                interactiveLayout={!state.isRendering}
                onUpdatePlacement={(panelName, placement) =>
                  store.updatePanelPlacement(panelName, placement)
                }
              />

              {/* Render Progress Bar or Render Action Button */}
              {state.isRendering ? (
                <View style={styles.progressContainer}>
                  <View style={styles.progressBarBg}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${Math.round(
                            (state.renderProgress?.fraction ?? 0) * 100
                          )}%`,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.rowBetween}>
                    <Text style={styles.progressText}>
                      {`${Math.round(
                        (state.renderProgress?.fraction ?? 0) * 100
                      )}% · Frame ${state.renderProgress?.currentFrame ?? 0}/${
                        state.renderProgress?.totalFrames ?? 0
                      }`}
                    </Text>
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      onPress={() => store.cancelRender()}
                    >
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.renderActionBtn,
                    (!currentCourt || !state.videoMeta) && styles.disabledBtn,
                  ]}
                  disabled={!currentCourt || !state.videoMeta}
                  onPress={() => store.startRenderPipeline()}
                >
                  <Text style={styles.renderActionBtnText}>
                    {`RENDER PICKLEBALL HUD MP4 (${(
                      state.endSec - state.startSec
                    ).toFixed(1)}s)`}
                  </Text>
                </TouchableOpacity>
              )}

              <View style={styles.divider} />

              {/* HUD Theme Selector */}
              <Text style={styles.groupLabel}>HUD Theme</Text>
              <View style={styles.chipWrap}>
                {THEMES.map((thName) => (
                  <FilterChipPill
                    key={thName}
                    label={thName.charAt(0).toUpperCase() + thName.slice(1)}
                    selected={state.config.render.theme === thName}
                    onPress={() =>
                      store.updateConfig((c) => ({
                        ...c,
                        render: { ...c.render, theme: thName },
                      }))
                    }
                  />
                ))}
              </View>

              {/* Output Aspect / Stage */}
              <Text style={styles.groupLabel}>Output Aspect / Stage</Text>
              <View style={styles.chipWrap}>
                {STAGES.map((st) => (
                  <FilterChipPill
                    key={st.key}
                    label={st.label}
                    selected={state.config.render.stage === st.key}
                    onPress={() =>
                      store.updateConfig((c) => ({
                        ...c,
                        render: { ...c.render, stage: st.key },
                      }))
                    }
                  />
                ))}
              </View>

              {/* Panel Frame */}
              <Text style={styles.groupLabel}>Panel Frame</Text>
              <View style={styles.chipWrap}>
                {FRAMES.map((fr) => (
                  <FilterChipPill
                    key={fr}
                    label={fr.charAt(0).toUpperCase() + fr.slice(1)}
                    selected={state.config.render.frame === fr}
                    onPress={() =>
                      store.updateConfig((c) => ({
                        ...c,
                        render: { ...c.render, frame: fr },
                      }))
                    }
                  />
                ))}
              </View>

              <View style={styles.divider} />

              {/* Pickleball Scoring System */}
              <Text style={styles.groupLabel}>Pickleball Scoring System</Text>
              <View style={styles.chipWrap}>
                <FilterChipPill
                  label="Traditional Side-Out (0-0-2)"
                  selected={
                    state.config.score.mode === ScoringMode.SIDE_OUT_0_0_2
                  }
                  onPress={() => store.setScoringMode(ScoringMode.SIDE_OUT_0_0_2)}
                />
                <FilterChipPill
                  label="Rally Scoring (0-0)"
                  selected={state.config.score.mode === ScoringMode.RALLY_POINT}
                  onPress={() => store.setScoringMode(ScoringMode.RALLY_POINT)}
                />
              </View>

              {/* Pickleball Feature Switches */}
              <FeatureSwitchRow
                title="7-ft Kitchen (NVZ) Presence & Volley Fault Glow"
                subtitle="Tracks % time at Kitchen line & turns player ring red on NVZ foot faults"
                checked={state.config.render.showKitchenPresence}
                onCheckedChange={(on) =>
                  store.updateConfig((c) => ({
                    ...c,
                    render: { ...c.render, showKitchenPresence: on },
                  }))
                }
              />
              <FeatureSwitchRow
                title="2D Ball Bounce Map + Automated IN / OUT Calls"
                subtitle="Plots floor bounces on the radar court map and triggers IN / OUT! / KITCHEN badges"
                checked={state.config.render.showBounceMarkers}
                onCheckedChange={(on) =>
                  store.updateConfig((c) => ({
                    ...c,
                    render: { ...c.render, showBounceMarkers: on },
                  }))
                }
              />
              <FeatureSwitchRow
                title="Pickleball Shot Callouts (DRIVE!, DINK, 3RD SHOT DROP, ATP!)"
                subtitle="Pop-up broadcast callouts with speed ranks (B: 25, A: 40, S: 55, SS: 70, SSS: 85+ km/h)"
                checked={state.config.render.calloutsEnabled}
                onCheckedChange={(on) =>
                  store.updateConfig((c) => ({
                    ...c,
                    render: { ...c.render, calloutsEnabled: on },
                  }))
                }
              />
              <FeatureSwitchRow
                title="YOLO11 Pose Skeleton Overlay"
                subtitle="Draws 17-keypoint body skeletons on tracked players"
                checked={state.config.render.skeleton}
                onCheckedChange={(on) =>
                  store.updateConfig((c) => ({
                    ...c,
                    render: { ...c.render, skeleton: on },
                  }))
                }
              />
            </View>

            {/* Post-Render Match Report & Heatmaps */}
            {state.lastRenderResult && (
              <View style={[styles.card, styles.reportCardBorder]}>
                <Text style={styles.reportHeaderTitle}>
                  PICKLEBALL MATCH REPORT & HEATMAPS
                </Text>
                <Text style={styles.sectionSubtitle}>
                  {`MP4 Saved: ${state.lastRenderResult.outputFileName} (${state.lastRenderResult.totalFrames} frames)`}
                </Text>

                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { flex: 1.2 }]}
                    onPress={() => setShowVideoModal(true)}
                  >
                    <Text style={styles.primaryBtnText}>Watch Rendered MP4</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.outlineBtn, { flex: 0.8 }]}
                    onPress={() => handleShareMp4(state.lastRenderResult!)}
                  >
                    <Text style={styles.outlineBtnText}>Share MP4</Text>
                  </TouchableOpacity>
                </View>

                {/* Summary KPIs */}
                <View style={styles.kpiRow}>
                  <StatMetricPill
                    label="FINAL SCORE"
                    value={
                      state.lastRenderResult.scoreSummary?.finalDisplay ??
                      '0-0-2'
                    }
                    accent={CYAN_ACCENT}
                  />
                  <StatMetricPill
                    label="RALLIES / SHOTS"
                    value={`${state.lastRenderResult.ralliesCount} / ${state.lastRenderResult.totalShots}`}
                    accent={NEON_VOLT}
                  />
                  <StatMetricPill
                    label="TOP DRIVE"
                    value={`${state.lastRenderResult.topSpeedKmh ?? '--'} km/h`}
                    accent="#FF9100"
                  />
                  <StatMetricPill
                    label="BOUNCES (IN/OUT)"
                    value={`${state.lastRenderResult.inBoundsBounces} / ${state.lastRenderResult.outBounces}`}
                    accent="#7CFF4F"
                  />
                </View>

                {/* Rally-by-Rally Side-Out Score Progression */}
                {state.lastRenderResult.scoreSummary &&
                  state.lastRenderResult.scoreSummary.rows.length > 0 && (
                    <View style={styles.subSection}>
                      <Text style={styles.groupLabel}>
                        Rally-by-Rally Score Progression
                      </Text>
                      {state.lastRenderResult.scoreSummary.rows.map((r) => (
                        <View key={`rrow-${r.rallyIndex}`} style={styles.rallyRow}>
                          <Text style={styles.rallyIdxText}>
                            {`Rally #${r.rallyIndex + 1}`}
                          </Text>
                          <Text style={styles.rallyNoteText}>
                            {r.outcomeNote}
                          </Text>
                          <Text style={styles.rallyScoreText}>
                            {r.displayScore}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                {/* Player Performance & Kitchen (NVZ) Presence Table */}
                <View style={styles.subSection}>
                  <Text style={styles.groupLabel}>
                    Player Performance & Kitchen (NVZ) Presence
                  </Text>
                  {state.lastRenderResult.playerReports.map((p, idx) => (
                    <View key={`prep-${idx}`} style={styles.playerPerfRow}>
                      <View style={styles.playerPerfLeft}>
                        <View
                          style={[
                            styles.playerDot,
                            { backgroundColor: p.color },
                          ]}
                        />
                        <Text style={styles.playerPerfName}>
                          {`${p.name} (Team ${p.team})`}
                        </Text>
                      </View>
                      <Text style={styles.playerPerfMetrics}>
                        {`Move: ${p.metrics.distanceM.toFixed(
                          1
                        )}m · Top: ${p.metrics.topSpeedMs.toFixed(
                          1
                        )}m/s · NVZ: ${Math.round(p.metrics.kitchenPct)}%`}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* 2D Pickleball Court & Bounce Heatmaps */}
                <View style={styles.subSection}>
                  <Text style={styles.groupLabel}>
                    2D Pickleball Court & Bounce Heatmaps
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.heatmapScroll}
                  >
                    {state.lastRenderResult.playerReports.map((pr, idx) => (
                      <PlayerCourtHeatmapCard
                        key={`hmcard-${idx}`}
                        title={pr.name}
                        colorHex={pr.color}
                        heatmap={pr.heatmap}
                        bounces={state.lastRenderResult!.allBounces}
                      />
                    ))}
                  </ScrollView>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Wizard Bottom Navigation Bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[
            styles.outlineBtnSmall,
            state.currentStep <= 1 && styles.disabledBtn,
          ]}
          disabled={state.currentStep <= 1}
          onPress={() => store.setStep(state.currentStep - 1)}
        >
          <Text style={styles.outlineBtnTextSmall}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.stepIndicatorText}>
          {`Step ${state.currentStep} of 4`}
        </Text>

        {state.currentStep < 4 ? (
          <TouchableOpacity
            style={[styles.primaryBtnSmall, !canAdvance && styles.disabledBtn]}
            disabled={!canAdvance}
            onPress={() => store.setStep(state.currentStep + 1)}
          >
            <Text style={styles.primaryBtnTextSmall}>Next Step</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 88 }} />
        )}
      </View>

      {/* Rendered HUD Video Player Modal */}
      {showVideoModal && state.lastRenderResult && (
        <RenderedVideoPlayerModal
          result={state.lastRenderResult}
          videoW={state.videoMeta?.width ?? 1280}
          videoH={state.videoMeta?.height ?? 720}
          cfg={state.config}
          court={currentCourt}
          onClose={() => setShowVideoModal(false)}
        />
      )}
    </SafeAreaView>
  );
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

const FilterChipPill: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
}> = ({ label, selected, onPress }) => (
  <TouchableOpacity
    style={[styles.chip, selected && styles.chipSelected]}
    onPress={onPress}
  >
    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
      {label}
    </Text>
  </TouchableOpacity>
);

const PlayerConfigCard: React.FC<{
  index: number;
  player: PlayerConfig;
  canRemove: boolean;
  onUpdate: (updated: PlayerConfig) => void;
  onRemove: () => void;
}> = ({ index, player, canRemove, onUpdate, onRemove }) => (
  <View style={[styles.playerCard, { borderColor: player.color }]}>
    <View style={styles.rowBetween}>
      <View style={{ flex: 1 }}>
        <Text style={styles.inputLabel}>{`Player #${index + 1} Name`}</Text>
        <TextInput
          style={styles.textInput}
          value={player.name}
          onChangeText={(text) => onUpdate({ ...player, name: text })}
          placeholder="Player Name"
          placeholderTextColor={MUTED_TEXT}
        />
      </View>
      {canRemove && (
        <TouchableOpacity style={styles.removeIconBtn} onPress={onRemove}>
          <Text style={styles.removeIconText}>✕</Text>
        </TouchableOpacity>
      )}
    </View>

    <View style={styles.rowBetween}>
      <View style={styles.inlineOptionGroup}>
        <Text style={styles.inlineLabel}>Team:</Text>
        {(['A', 'B'] as const).map((t) => (
          <FilterChipPill
            key={t}
            label={`Team ${t}`}
            selected={player.team === t}
            onPress={() => onUpdate({ ...player, team: t })}
          />
        ))}
      </View>

      <View style={styles.inlineOptionGroup}>
        <Text style={styles.inlineLabel}>Side:</Text>
        {(
          [
            ['far', 'Far'],
            ['near', 'Near'],
          ] as const
        ).map(([k, lbl]) => (
          <FilterChipPill
            key={k}
            label={lbl}
            selected={player.side === k}
            onPress={() => onUpdate({ ...player, side: k })}
          />
        ))}
      </View>
    </View>

    <View style={styles.inlineOptionGroup}>
      <Text style={styles.inlineLabel}>HUD Color:</Text>
      {COLOR_PRESETS.map((hex) => {
        const selected = player.color.toLowerCase() === hex.toLowerCase();
        return (
          <TouchableOpacity
            key={hex}
            style={[
              styles.colorSwatch,
              { backgroundColor: hex },
              selected && styles.colorSwatchSelected,
            ]}
            onPress={() => onUpdate({ ...player, color: hex })}
          />
        );
      })}
    </View>
  </View>
);

const FeatureSwitchRow: React.FC<{
  title: string;
  subtitle: string;
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
}> = ({ title, subtitle, checked, onCheckedChange }) => (
  <View style={styles.switchRow}>
    <View style={{ flex: 1, paddingRight: 10 }}>
      <Text style={styles.switchTitle}>{title}</Text>
      <Text style={styles.switchSubtitle}>{subtitle}</Text>
    </View>
    <Switch
      value={checked}
      onValueChange={onCheckedChange}
      trackColor={{ false: '#263859', true: CYAN_ACCENT }}
      thumbColor="#FFFFFF"
    />
  </View>
);

const StatMetricPill: React.FC<{
  label: string;
  value: string;
  accent: string;
}> = ({ label, value, accent }) => (
  <View style={styles.kpiPill}>
    <Text style={styles.kpiLabel} numberOfLines={1}>
      {label}
    </Text>
    <Text style={[styles.kpiValue, { color: accent }]} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const RenderedVideoPlayerModal: React.FC<{
  result: RenderPipelineResult;
  videoW: number;
  videoH: number;
  cfg: PickleballHudScreenPropsCfg;
  court: ReturnType<typeof usePickleballHudStore>['currentCourt'];
  onClose: () => void;
}> = ({ result, videoW, videoH, cfg, court, onClose }) => {
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const frames = result.renderedFrames;

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const intervalMs = Math.max(25, Math.round(1000 / result.fps));
    const timer = setInterval(() => {
      setFrameIdx((prev) => (prev + 1) % frames.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [playing, frames.length, result.fps]);

  const currentFrame = frames[frameIdx] ?? frames[0];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSurface}>
          <View style={styles.rowBetween}>
            <Text style={styles.modalTitle}>
              Rendered Pickleball HUD Video
            </Text>
            <Text style={styles.modalFrameInfo}>
              {`Frame ${frameIdx + 1}/${frames.length}`}
            </Text>
          </View>

          {currentFrame && (
            <PickleballHudSvgCanvas
              videoW={videoW}
              videoH={videoH}
              tSec={currentFrame.tAbsSec}
              cfg={cfg}
              court={court}
              snap={currentFrame.snap}
              ballState={currentFrame.ballState}
              trails={currentFrame.trails}
              preview={false}
            />
          )}

          <SeekSlider
            value={frameIdx}
            min={0}
            max={Math.max(1, frames.length - 1)}
            onChange={(val) => {
              setPlaying(false);
              setFrameIdx(Math.round(val));
            }}
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.outlineVoltBtn, { flex: 1 }]}
              onPress={() => setPlaying((p) => !p)}
            >
              <Text style={styles.outlineVoltBtnText}>
                {playing ? 'Pause' : 'Play'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1 }]}
              onPress={onClose}
            >
              <Text style={styles.primaryBtnText}>Close Player</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

type PickleballHudScreenPropsCfg = ReturnType<
  typeof usePickleballHudStore
>['state']['config'];

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: NAVY_BG,
  },
  topHeader: {
    backgroundColor: NAVY_SURFACE,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  brandIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: NEON_VOLT,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  brandIconText: {
    color: NAVY_BG,
    fontWeight: '900',
    fontSize: 13,
  },
  brandTitles: {
    flex: 1,
  },
  appTitle: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 16,
  },
  appSubtitle: {
    color: MUTED_TEXT,
    fontSize: 11,
  },
  stepTabsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  stepTab: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: NAVY_CARD,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  stepTabActive: {
    backgroundColor: 'rgba(0, 229, 255, 0.22)',
    borderColor: CYAN_ACCENT,
  },
  stepTabDone: {
    backgroundColor: 'rgba(182, 255, 46, 0.14)',
    borderColor: 'rgba(182, 255, 46, 0.6)',
  },
  stepTabText: {
    fontSize: 11,
    fontWeight: '600',
    color: MUTED_TEXT,
  },
  stepTabTextActive: {
    color: CYAN_ACCENT,
    fontWeight: '800',
  },
  stepTabTextDone: {
    color: NEON_VOLT,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NAVY_CARD,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.35)',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: CYAN_ACCENT,
    marginRight: 8,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 12,
    flex: 1,
  },
  card: {
    backgroundColor: NAVY_CARD,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  reportCardBorder: {
    borderWidth: 1.5,
    borderColor: 'rgba(182, 255, 46, 0.7)',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  reportHeaderTitle: {
    color: NEON_VOLT,
    fontSize: 15,
    fontWeight: '900',
  },
  sectionSubtitle: {
    color: MUTED_TEXT,
    fontSize: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  primaryBtn: {
    backgroundColor: CYAN_ACCENT,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#04101E',
    fontWeight: 'bold',
    fontSize: 13,
  },
  primaryBtnSmall: {
    backgroundColor: CYAN_ACCENT,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  primaryBtnTextSmall: {
    color: '#04101E',
    fontWeight: 'bold',
    fontSize: 12,
  },
  outlineVoltBtn: {
    borderWidth: 1,
    borderColor: NEON_VOLT,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineVoltBtnText: {
    color: NEON_VOLT,
    fontWeight: 'bold',
    fontSize: 13,
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 12,
  },
  outlineBtnSmall: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  outlineBtnTextSmall: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  disabledBtn: {
    opacity: 0.4,
  },
  previewBox: {
    position: 'relative',
    width: '100%',
  },
  metaBadgeOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.68)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  metaBadgeText: {
    color: NEON_VOLT,
    fontSize: 11,
    fontWeight: '600',
  },
  sliderSection: {
    gap: 6,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sliderTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  quickActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickLinkCyan: {
    color: CYAN_ACCENT,
    fontSize: 12,
    fontWeight: 'bold',
  },
  quickSep: {
    color: MUTED_TEXT,
  },
  quickLinkVolt: {
    color: NEON_VOLT,
    fontSize: 12,
    fontWeight: 'bold',
  },
  seekLabel: {
    color: MUTED_TEXT,
    fontSize: 12,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: NAVY_SURFACE,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipSelected: {
    backgroundColor: 'rgba(0, 229, 255, 0.25)',
    borderColor: CYAN_ACCENT,
  },
  chipText: {
    color: MUTED_TEXT,
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  playerCard: {
    backgroundColor: NAVY_SURFACE,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  inputLabel: {
    color: MUTED_TEXT,
    fontSize: 11,
    marginBottom: 4,
  },
  textInput: {
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
  },
  removeIconBtn: {
    marginLeft: 10,
    padding: 8,
  },
  removeIconText: {
    color: MUTED_TEXT,
    fontSize: 16,
  },
  inlineOptionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineLabel: {
    color: MUTED_TEXT,
    fontSize: 12,
  },
  colorSwatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  colorSwatchSelected: {
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },
  progressContainer: {
    gap: 8,
  },
  progressBarBg: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: NEON_VOLT,
  },
  progressText: {
    color: NEON_VOLT,
    fontSize: 12,
    fontWeight: 'bold',
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: '#FF5252',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  cancelBtnText: {
    color: '#FF5252',
    fontSize: 12,
    fontWeight: 'bold',
  },
  renderActionBtn: {
    backgroundColor: NEON_VOLT,
    height: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  renderActionBtnText: {
    color: NAVY_BG,
    fontWeight: '900',
    fontSize: 14,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 2,
  },
  groupLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  switchTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  switchSubtitle: {
    color: MUTED_TEXT,
    fontSize: 11,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
  },
  kpiPill: {
    flex: 1,
    backgroundColor: NAVY_SURFACE,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  kpiLabel: {
    color: MUTED_TEXT,
    fontSize: 9,
    marginBottom: 2,
  },
  kpiValue: {
    fontSize: 13,
    fontWeight: '900',
  },
  subSection: {
    gap: 6,
  },
  rallyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: NAVY_SURFACE,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  rallyIdxText: {
    color: CYAN_ACCENT,
    fontSize: 12,
    fontWeight: 'bold',
  },
  rallyNoteText: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  rallyScoreText: {
    color: NEON_VOLT,
    fontSize: 13,
    fontWeight: '900',
  },
  playerPerfRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: NAVY_SURFACE,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  playerPerfLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  playerPerfName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  playerPerfMetrics: {
    color: MUTED_TEXT,
    fontSize: 11,
  },
  heatmapScroll: {
    gap: 10,
    paddingVertical: 4,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: NAVY_SURFACE,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  stepIndicatorText: {
    color: MUTED_TEXT,
    fontSize: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    padding: 16,
  },
  modalSurface: {
    backgroundColor: NAVY_SURFACE,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: CYAN_ACCENT,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  modalFrameInfo: {
    color: NEON_VOLT,
    fontSize: 12,
    fontWeight: 'bold',
  },
});

