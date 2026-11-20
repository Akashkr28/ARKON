# HoloCAD

A browser-based "holographic" CAD viewer. Your webcam is the background, a glowing 3D model floats
over it, and you control it with hand gestures tracked by MediaPipe. No AR hardware.

Phase 1 of a larger project (backend + STEP conversion, AI assistant, multi-user review come later).

## Setup

Requires Node 22.9+, PostgreSQL, [uv](https://docs.astral.sh/uv/) (Python), and a webcam.

```bash
npm install
npm run setup:converter   # Python venv with OpenCASCADE (OCP) + FastAPI
npm run db:start          # project-local Postgres: .pgdata/, port 5433, no password; writes apps/api/.env
npm run dev               # web :5173, API :3001, converter :8001
```

`npm run db:start` uses the PostgreSQL programs already installed (it finds `pg_ctl` on your PATH,
in `/Library/PostgreSQL`, Homebrew or Postgres.app) but runs its own server, so your system
database and its password are never involved. Run it again after a reboot; `npm run db:stop`
stops it. To use another Postgres instead, write `apps/api/.env` yourself from
`apps/api/.env.example` and run `npm run db:migrate`.

The repo is an npm workspace: `apps/web` (the viewer), `apps/api` (Express + Postgres), plus
`services/converter` (Python, STEP → GLB with OpenCASCADE). `npm test` runs the API and
converter tests; database tests are skipped unless `DATABASE_URL_TEST` is set.

**Your own models:** use **+ UPLOAD** in the LIBRARY panel, or drop a `.step`, `.stp` or `.glb`
file anywhere on the window. STEP files are converted in the background (pick DRAFT / STANDARD /
FINE mesh detail first) and open automatically when ready.

A sample STEP assembly lives in `services/converter/samples/mini-gearbox.step`; regenerate it
with `cd services/converter && uv run python -m holocad_converter.sample samples/mini-gearbox.step`.

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

Upload it from the LIBRARY panel or drop it on the window (see Setup). STEP (`.step`, `.stp`) is
converted to GLB with part names, colours and assembly structure kept; `.glb` is used as is. Each
mesh becomes an explodable, pickable part, so keep parts as separate bodies in your CAD export.

To ship a model with the app instead (available even without the API), copy the `.glb` into
`apps/web/public/models/` and add it to `MODELS` in `apps/web/src/config.js`:

```js
{ id: 'my-part', label: 'My Part', url: `${base}models/MyPart.glb` },
```

Models are centred and scaled automatically. The bundled samples and their attribution are listed
in `apps/web/public/models/ATTRIBUTION.md`.

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
