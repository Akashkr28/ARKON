# HoloCAD

A browser-based "holographic" CAD viewer. Your webcam is the background, a glowing 3D model floats
over it, and you control it with hand gestures tracked by MediaPipe. No AR hardware.

Phase 1 of a larger project (backend + STEP conversion, AI assistant, multi-user review come later).

## Setup

Requires Node 18+ and a webcam.

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome or Edge and allow camera access. The camera only works on
`localhost` or over `https://`. The first load downloads the hand-tracking model (~8 MB) from
Google's CDN, so it needs internet access.

`npm run build` produces a static site in `dist/`.

## Gestures

| Gesture | What it does |
|---|---|
| ✊ Fist (one hand) | Grab and move the model |
| ☝ Point and move the fingertip | Rotate the model with your finger |
| ☝ Point, then flick the finger | Spin the model; it coasts and slows down |
| 🖐🖐 Two open palms, hold still ~0.3 s, then spread / close | Scale up / down |
| ✊✊ Two fists, pull apart | Explode (closer together = less) |
| ✊↺ Twist one fist counter-clockwise (in place) | Explode; twist back to reduce |
| 👌 Pinch a part (while exploded) | Pick it and pull it out; it springs back on release |
| 👌 Keep holding the part ~1 s | Show its info card (name, vertices, bounding box) |
| 👌 Pinch and hold on empty space ~0.6 s | Radial menu: move toward an item, release to choose (EXPLODE/ASSEMBLE, RESET, MATERIAL, SPAWN HERE) |
| 👏 Clap | Reassemble |

Mouse: double-click to move the model to the cursor; while exploded, click a part to select it.

A gesture has to be held for 4 tracked frames (~0.13 s) before it counts. The yellow word in the
status bar is the current gesture state; press **D** to see skeletons, poses and timings.

## Keyboard

| Key | Action |
|---|---|
| E | Explode / assemble |
| R | Reset model |
| M | Hologram / original materials |
| L | Part labels (while exploded) |
| D | Debug overlay (skeletons, landmark ids, state, FPS, inference time) |
| F | Mirror video |
| B | Black & white video |
| C | Next camera |
| Esc | Deselect part |

## Adding your own model

1. Export or convert to `.glb` (binary glTF). Each mesh becomes an explodable, pickable part, so
   keep parts as separate meshes.
2. Copy it into `public/models/`.
3. Add an entry to `MODELS` in `src/config.js`:
   ```js
   { id: 'my-part', label: 'My Part', url: `${base}models/MyPart.glb` },
   ```
4. Pick it from the MODEL menu. It's centred and scaled automatically.

Part names come from the mesh (or its parent node) names in the file. The sample models and their
attribution are listed in `public/models/ATTRIBUTION.md`.

## Tuning

Every threshold lives in `src/config.js`:

- `TRACKING` – MediaPipe confidences, `swapHandedness` (flip if LEFT/RIGHT are backwards),
  assumed camera FOV and palm size for the distance readout.
- `SMOOTHING` – One Euro filter (`minCutoff` for jitter, `beta` for lag).
- `HAND` – pinch thresholds, what counts as open vs closed.
- `GESTURE` – debounce, flick speed, scale arming, explode sensitivity, twist, menu and clap timing.
- `BLOOM`, `HOLOGRAM`, `RINGS` – the look.

Gesture speeds are measured in palm-lengths per second, so they feel the same near or far from
the camera.

## How it's built

```
src/
  config.js                 all tunables
  store/viewerStore.js      model transform, explode, selection, toggles (Zustand)
  store/handStore.js        live hand data + gesture state, written by the vision pipeline
  actions/viewerActions.js  the only code that changes viewer state
  vision/
    handTracker.js          MediaPipe GestureRecognizer setup + per-video-frame loop
    handPipeline.js         identity → One Euro smoothing → metrics → screen/3D projection
    handIdentity.js         keeps each physical hand's filter/state across frames
    smoothing.js            One Euro filter
    handMetrics.js          openness, distance, pinch (hysteresis), palm centre
    projection.js           video ↔ screen (object-fit: cover + mirror) ↔ 3D plane
    handPose.js             FIST / OPEN / POINT / PINCH + debounce
    gestureEngine.js        state machine: IDLE, MOVING, SPINNING, SCALING, EXPLODING, HOLDING_PART, MENU
    clapDetector.js         clap detection (survives MediaPipe losing hands on contact)
  scene/
    Scene.jsx               R3F canvas over the video
    ModelViewer.jsx         loading, explode, part pull-out, highlight, labels
    prepareModel.js         centre/normalise, per-part explode directions
    picking.js              raycast service (gesture code gets part ids, never three.js objects)
    hologramMaterial.js     fresnel + scanline shader
    HandRings.jsx           glowing palm/fingertip rings, pinch pulse
    Effects.jsx             bloom
  hud/                      control panel, hand cards, legend, radial menu, part info, debug canvas
  input/                    keyboard and mouse
```

**One rule holds it together:** gestures, keyboard and mouse never touch three.js or the store
directly; they call functions in `viewerActions.js` (`explode(factor)`, `selectPart(id)`,
`scaleTo(scale)`, …). The AI assistant and multi-user sessions will call the same functions.
`onAction()` in that file is the hook for both. See `src/integrations/README.md`.

**Hologram compositing:** in hologram mode the canvas renders on black and is blended over the
video with CSS `mix-blend-mode: screen`. Black becomes see-through and glow adds light, which keeps
bloom halos intact. Original-materials mode switches to normal alpha compositing without bloom.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Camera permission denied" | Allow the camera in the address bar's site settings, reload |
| "Camera is busy" | Close Zoom/Teams/Photo Booth, reload |
| "Hand tracking unavailable" | Needs internet for cdn.jsdelivr.net and storage.googleapis.com |
| LEFT/RIGHT swapped | `TRACKING.swapHandedness` in config.js |
| Low FPS | Press D: if INFERENCE is high, the GPU delegate may have fallen back to CPU; lower `BLOOM.resolutionScale` or switch to original materials |
| Gestures fire by accident | Raise `GESTURE.debounceFrames` or the relevant threshold |

## Not in Phase 1

Depth occlusion (Depth Anything), backend upload + STEP → GLB, AI assistant, multi-user review.
Each has a `TODO(...)` hook; see `src/integrations/README.md`.
