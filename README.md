# Pickleball Generate HUD

Pickleball Generate HUD is a React Native (TypeScript) application for analyzing pickleball rally footage and rendering a customizable broadcast-style Heads-Up Display (HUD) overlay. It combines 2D-to-3D perspective court homography, multi-object player tracking, ONNX-based ball and pose detection, shot classification, and pickleball scoring into an interactive mobile and web studio.

## Features

### Court Calibration and Homography
- **Regulation Pickleball Geometry**: Full support for standard USA Pickleball court dimensions (20 ft x 44 ft / 6.10 m x 13.41 m) including the 7-ft (2.13 m) Non-Volley Zone (Kitchen) on both sides of the net.
- **Interactive 4-Corner Calibration**: Drag-and-drop corner handles (`TL`, `TR`, `BR`, `BL`) with live perspective grid subdivision (Kitchen lines, net line, and centerline) and a 3x magnifier loupe for sub-pixel alignment.
- **3D Trajectory Projection**: 8x8 Gaussian elimination homography solver (`PickleballCourt`) mapping image pixels to court meters and projecting 3D ball arcs and ground shadows onto the camera plane.

### Computer Vision and Tracking
- **WASB Ball Detection**: 3-frame temporal sliding window ONNX detector (`wasb.onnx`, 288x512 RGB tensor) for tracking high-speed optic-yellow pickleball trajectories.
- **YOLO11 Pose Estimation**: 17-keypoint COCO pose detector (`yolo11n-pose.onnx`, 640x640 letterboxed tensor with NMS) for rendering player skeletons and estimating ankle/foot ground contact.
- **ByteTrack + 4-Slot Player Assignment**: Two-stage IoU tracker (`ByteTracker`) paired with a 4-slot court tracker (`PlayerTracker`) for doubles play (Near-Left, Near-Right, Far-Left, Far-Right), exponential moving average (EMA) keypoint smoothing, stamina estimation, Kitchen (NVZ) presence percentage, and 2D spatial heatmaps.

### Rally Analysis and Shot Classification
- **Two-Pass Trajectory Pipeline**: Gap interpolation, Savitzky-Golay smoothing, V-shape vertical velocity bounce detection, and player proximity hit attribution.
- **Automated Shot Callouts**: Classifies shots into `SERVE`, `RETURN`, `3RD SHOT DROP`, `DINK`, `DRIVE`, `VOLLEY`, `LOB`, `OVERHEAD`, `ERNIE`, `ATP` (Around The Post), `SPEED-UP`, and `NVZ FAULT`.
- **Speed Tier Ranking**: Categorizes shot speeds into `DINK`, `DROP`, `DRIVE`, `RIP`, and `CRUSH` tiers.

### Pickleball Scoring Systems
- **Side-Out Scoring (0-0-2)**: Traditional doubles side-out state machine where points are scored only by the serving team, tracking server numbers (1 and 2) and starting at `0-0-2`.
- **Rally Scoring**: Point-per-rally scoring mode.

### Broadcast HUD Overlay
- **Interactive Drag-and-Drop Panels**: Reposition and scale the Top Scoreboard HUD, Player Stats Panel, 2D Court Radar Map, and Shot Speed Gauge directly on the canvas.
- **Customizable Visual Elements**: Toggle 3D under-foot player rings (`neon`, `solid`, `minimal`), floating player head tags with stamina/NVZ indicators, 17-keypoint pose skeletons, comet-tail ball trails, 3D ball shadow drop lines, and bounce callout badges (`IN`, `OUT`, `KITCHEN`).
- **Stage Modes and Themes**: Render in full-bleed `overlay` mode or broadcast `inset` stage mode with selectable color themes (`broadcast`, `cyber`, `minimal`).

## Project Structure

```text
PickleballGenerateHUD/
├── App.tsx                                         # Root application entry component
├── index.js                                        # Expo / React Native registration entry
├── package.json                                    # Dependencies, scripts, and security overrides
├── tsconfig.json                                   # TypeScript compiler configuration
├── assets/
│   ├── fonts/                                      # BebasNeue-Regular, Kanit-Regular, Kanit-SemiBold
│   └── models/                                     # wasb.onnx and yolo11n-pose.onnx weights
├── src/
│   ├── model/
│   │   └── PickleballConfig.ts                     # Configuration types, scoring rules, and AsyncStorage persistence
│   ├── cv/
│   │   ├── PickleballCourt.ts                      # 20x44 ft court geometry, homography solver, and NVZ checks
│   │   ├── ByteTracker.ts                          # Two-stage IoU multi-object tracker
│   │   ├── PlayerTracker.ts                        # 4-player slot assignment, distance, stamina, and heatmaps
│   │   └── OnnxDetectors.ts                        # WASB ball and YOLO11n-pose ONNX inference wrappers
│   ├── analysis/
│   │   └── PickleballRallyAnalyzer.ts              # Trajectory smoothing, bounce/hit detection, and shot callouts
│   ├── render/
│   │   └── PickleballHudRenderer.ts                # HUD panel geometry, theme palettes, and SVG path builders
│   ├── pipeline/
│   │   └── VideoPipeline.ts                        # Two-pass video analysis pipeline and built-in doubles demo
│   ├── components/
│   │   ├── PickleballHudSvgCanvas.tsx              # Broadcast SVG HUD overlay and interactive panel layout editor
│   │   ├── InteractiveCourtCalibrationCanvas.tsx   # 4-corner homography calibration canvas with 3x loupe
│   │   ├── PlayerCourtHeatmapCard.tsx              # Post-rally 2D court coverage and bounce map card
│   │   └── RangeAndSeekSliders.tsx                 # Video timeline seek and frame trim range sliders
│   ├── state/
│   │   └── usePickleballHudStore.ts                # React state store managing config, calibration, and rendering
│   └── screens/
│       └── PickleballHudScreen.tsx                 # Main 4-step workflow UI (Source, Court, HUD & Players, Render)
└── __tests__/
    └── PickleballAnalysis.test.ts                  # Jest unit test suite for homography, scoring, callouts, and pipeline
```

## Getting Started

### Prerequisites
- Node.js (v18 or newer)
- npm (v9 or newer)

### Installation

```bash
npm install
```

### Running the Application

Start the Expo development server:

```bash
npm start
```

Run on specific targets:

```bash
npm run android
npm run ios
npm run web
```

### Type Checking and Testing

Run the TypeScript compiler check:

```bash
npm run typecheck
```

Run the Jest unit test suite:

```bash
npm test
```

## Workflow

1. **Step 1 - Video Source and Trim**: Load a video file or use the built-in doubles rally simulation, then set the start and end frame trim range.
2. **Step 2 - Court Calibration**: Drag the 4 corner markers onto the outer corners of the 20x44 ft pickleball court and verify that the 7-ft Non-Volley Zone (Kitchen) lines align with the court markings.
3. **Step 3 - HUD Studio, Players, and Scoring**: Configure player names, team assignments, jersey colors, scoring mode (`0-0-2` side-out or rally), HUD theme, and visual toggles. Enable interactive layout mode to drag HUD panels to custom screen positions.
4. **Step 4 - Render and Analytics**: Run the two-pass analysis pipeline to inspect frame-by-frame HUD playback, shot distribution counts, Kitchen occupancy percentages, and 2D player court heatmaps.

