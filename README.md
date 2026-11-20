# HoloCAD

A browser-based "holographic" CAD viewer. Your webcam is the background, a glowing 3D model floats
over it, and you control it with hand gestures tracked by MediaPipe. No AR hardware. Upload your
own STEP or GLB files; STEP assemblies are converted on your machine with OpenCASCADE, keeping part
names, colours and structure.

- **Phase 1:** gesture-controlled viewer (`apps/web`).
- **Phase 2:** CAD library: Express API + PostgreSQL (`apps/api`) and a Python STEP → GLB
  converter (`services/converter`).
- **Next:** AI assistant that drives the same viewer actions (Phase 3), multi-user review
  sessions (Phase 4).

Gesture ideas were inspired by [Holo-Explorer](https://github.com/htongyai/holo-explorer) by Augma
Imaginarium. No code or assets are taken from it (it's CC BY-NC 4.0); HoloCAD is its own
implementation.

## Setup

Requires Node 22.9+, PostgreSQL (any install; you don't need its password), [uv](https://docs.astral.sh/uv/)
for Python, and a webcam.

```bash
npm install
npm run setup:converter   # Python venv with OpenCASCADE (OCP) + FastAPI
npm run db:start          # project-local Postgres: .pgdata/, port 5433, no password; writes apps/api/.env
npm run dev               # web :5173, API :3001, converter :8001
```

Open http://localhost:5173 in Chrome or Edge and allow camera access. The camera only works on
`localhost` or over `https://`. The first load downloads the hand-tracking model (~8 MB) from
Google's CDN, so it needs internet access.

`npm run db:start` uses the PostgreSQL programs already installed (it finds `pg_ctl` on your PATH,
in `/Library/PostgreSQL`, Homebrew or Postgres.app) but runs its own server, so your system
database and its password are never involved. Run it again after a reboot; `npm run db:stop`
stops it. To use another Postgres instead, write `apps/api/.env` yourself from
`apps/api/.env.example` and run `npm run db:migrate`.

| Command | What it does |
|---|---|
| `npm run dev` | Web, API and converter together (any one can also run alone; see `package.json`) |
| `npm test` | Web unit tests, API tests (database tests need `DATABASE_URL_TEST`, which `db:start` sets), converter tests |
| `npm run build` | Static build of the viewer into `apps/web/dist/` |
| `npm run db:start` / `db:stop` / `db:status` | Project-local Postgres |
| `npm run db:migrate` | Apply SQL migrations to `DATABASE_URL` |

## Your own models

Use **+ UPLOAD** in the LIBRARY panel, or drop a `.step`, `.stp` or `.glb` file anywhere on the
window.

- **STEP** is converted in the background. Pick DRAFT / STANDARD / FINE mesh detail before
  uploading; the model opens automatically when it's ready. Part names, colours and the assembly
  tree come from the file, so labels and info cards show "Drive gear", not "Part 12".
- **GLB** is ready immediately; parts are read from the file.
- Each mesh becomes an explodable, pickable part, so keep parts as separate bodies in your export.
- Failed conversions show the reason and a RETRY button (you can retry at another detail level).
  Delete asks for a second click.
- Limits: 200 MB per file (`MAX_UPLOAD_MB`), 10 minutes per conversion (`CONVERSION_TIMEOUT_MIN`),
  both in `apps/api/.env`.

A sample STEP assembly lives in `services/converter/samples/mini-gearbox.step`; regenerate it
with `cd services/converter && uv run python -m holocad_converter.sample samples/mini-gearbox.step`.

To ship a model with the app instead (works without the API), copy the `.glb` into
`apps/web/public/models/` and add it to `MODELS` in `apps/web/src/config.js`. The bundled samples
and their attribution are listed in `apps/web/public/models/ATTRIBUTION.md`.

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
| D | Debug overlay (skeletons, landmark ids, state, FPS, inference time, quality) |
| F | Mirror video |
| B | Black & white video |
| C | Next camera |
| Esc | Deselect part |

## Quality

The **QUALITY** menu (top right) sets camera resolution, render sharpness, glow and how often hands
are tracked. **AUTO** picks for your device: LOW on phones/tablets and machines with ≤ 4 cores or
≤ 4 GB RAM, HIGH with ≥ 8 cores and ≥ 8 GB, MEDIUM otherwise.

| Level | Camera | Sharpness (max pixel ratio) | Glow | Hand tracking |
|---|---|---|---|---|
| HIGH | 1080p | 2 | full | GPU, up to 60 Hz |
| MEDIUM | 720p | 1.5 | full | GPU, up to 30 Hz |
| LOW | 720p | 1 | 60%, no antialiasing | GPU, up to 24 Hz |
| SAFE | 480p | 1 | off | CPU, up to 15 Hz |

If rendering stays under 20 FPS for 6 seconds, HoloCAD offers the next level down. Add
`?quality=safe` (or `low`, …) to the URL to force a level, e.g. when the page won't start.
Changing quality reloads the page. Presets live in `QUALITY_PRESETS` in `apps/web/src/config.js`.

## Tuning

Every gesture threshold lives in `apps/web/src/config.js`:

- `TRACKING` – MediaPipe confidences, `swapHandedness` (flip if LEFT/RIGHT are backwards),
  assumed camera FOV and palm size for the distance readout.
- `SMOOTHING` – One Euro filter (`minCutoff` for jitter, `beta` for lag).
- `HAND` – pinch thresholds, what counts as open vs closed.
- `GESTURE` – debounce, flick speed, scale arming, explode sensitivity, twist, menu and clap timing.
- `BLOOM`, `HOLOGRAM`, `RINGS` – the look.

Gesture speeds are measured in palm-lengths per second, so they feel the same near or far from
the camera.

## API

The web app talks to the API through Vite's `/api` proxy. Everything is local (the API and
converter listen on 127.0.0.1 only) and there is no login yet; add authentication before exposing
it beyond your machine.

| Endpoint | |
|---|---|
| `GET /api/health` | `{ status, database, converter, limits: { maxUploadBytes } }`; 503 if anything is down |
| `POST /api/models` | multipart: `file` (.step/.stp/.glb), optional `name`, `quality` (draft/standard/fine). 201 with the model; STEP starts `queued` |
| `GET /api/models` | `{ models: [...] }`, newest first |
| `GET /api/models/:id` | model + `parts` (name, parent, triangle count, colour) + latest conversion `job` |
| `GET /api/models/:id/file` | the GLB (`model/gltf-binary`); 409 until the model is ready |
| `POST /api/models/:id/retry` | re-convert a STEP model, optionally `{ "quality": "fine" }`; 202 |
| `DELETE /api/models/:id` | removes the record and its files; 204 |

A model's `status` goes `queued → converting → ready` or `failed` (with a readable `error`).
Errors are always `{ "error": "message" }`.

**How conversion runs:** uploads are checked by extension *and* file signature, stored under
`storage/uploads/<id>`, and a job is added to the `conversion_jobs` table. A worker in the API
claims jobs with `FOR UPDATE SKIP LOCKED`, sends them to the converter one at a time, and stores
the GLB under `storage/models/<id>.glb` plus one `model_parts` row per part. If the converter
isn't running, jobs wait in the queue and convert once it's back; jobs interrupted by a restart
are re-queued.

## How it's built

```
apps/web/src/
  config.js                 all tunables, sample models, quality presets
  quality.js                AUTO pick, ?quality= / saved choice, slow-frame detector
  store/                    viewerStore (model, view), handStore (live hands), libraryStore (uploads)
  actions/viewerActions.js  the only code that changes viewer state
  actions/libraryActions.js upload, poll, retry, delete through the API
  api/modelsApi.js          HTTP client (XHR for upload progress)
  models/catalog.js         samples + ready uploads; what loadModel(id) can open
  vision/                   MediaPipe loop, smoothing, hand metrics, gesture state machine
  scene/                    R3F canvas, model loading/explode/picking, hologram shader, rings, bloom
  hud/                      controls, library, hand cards, legend, radial menu, part info, debug
  input/                    keyboard and mouse
apps/api/
  migrations/               plain SQL, applied in order by src/db/migrate.js
  src/routes/               health, models
  src/models/               SQL queries, upload checks, JSON shapes
  src/worker.js             conversion queue worker
  src/converterClient.js    HTTP client for the converter
services/converter/holocad_converter/
  convert.py                STEP → GLB (read, mesh by model size, write, report parts)
  app.py                    FastAPI: /health, /convert (paths confined to STORAGE_DIR)
  sample.py                 generates the sample gearbox assembly
scripts/local-db.mjs        project-local Postgres
```

**One rule holds it together:** gestures, keyboard, mouse and the library never touch three.js or
the stores directly; they call plain functions in `viewerActions.js` / `libraryActions.js`
(`explode(factor)`, `selectPart(id)`, `loadModel(id)`, `uploadFile(file)`, …). The AI assistant
and multi-user sessions will call the same functions; `onAction()` is the hook for both. See
`apps/web/src/integrations/README.md`.

**Hologram compositing:** in hologram mode the canvas renders on black and is blended over the
video with CSS `mix-blend-mode: screen`. Black becomes see-through and glow adds light, which keeps
bloom halos intact. Original-materials mode switches to normal alpha compositing without bloom.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Camera permission denied" | Allow the camera in the address bar's site settings, reload |
| "Camera is busy" | Close Zoom/Teams/Photo Booth, reload |
| "Hand tracking unavailable" | Needs internet for cdn.jsdelivr.net and storage.googleapis.com |
| Page won't start, black screen, or stutters | Pick a lower QUALITY, or open `http://localhost:5173/?quality=safe` |
| LEFT/RIGHT swapped | `TRACKING.swapHandedness` in config.js |
| LIBRARY says API OFFLINE | Run `npm run dev`; if `/api/health` says `database: down`, run `npm run db:start` and restart `npm run dev` |
| Models stay QUEUED | The converter isn't running (the panel says so): `npm run dev`, or `npm run setup:converter` once first |
| Conversion fails with "took longer than…" | Upload again at DRAFT quality, raise `CONVERSION_TIMEOUT_MIN`, or split the assembly |
| `createdb` / `psql` ask for a password | Not needed: use `npm run db:start` instead |
| Gestures fire by accident | Raise `GESTURE.debounceFrames` or the relevant threshold |

## Not yet built

Hand occlusion (hands passing in front of the model), AI assistant (Phase 3), multi-user review
(Phase 4), authentication. Each has a `TODO(...)` hook; see `apps/web/src/integrations/README.md`.
