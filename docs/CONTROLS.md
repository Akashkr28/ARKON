# HoloCAD controls

One page with every way to drive HoloCAD. Everything below goes through the same
`viewerActions`, so gestures, mouse, keyboard (and later the AI assistant) can be mixed freely
and all share one undo history.

## Mouse, trackpad, touch

| Input | Action |
|---|---|
| Left drag / one finger | Rotate |
| Right or middle drag, Shift + drag | Pan |
| Wheel, trackpad scroll, pinch | Zoom toward the cursor |
| Click a part | Select it (click empty space to clear) |
| Shift / Ctrl / Cmd + click | Add to or remove from the selection |
| Double-click a part | Frame that part (empty space: the whole model) |
| Drop a `.step` / `.stp` / `.glb` on the window | Upload it to the library |

## Keyboard

| Key | Action |
|---|---|
| 0 | Fit to screen (visible parts only, if some are hidden) |
| . | Frame the selection |
| 1 / 3 / 7 / 5 | Front / right / top / iso view |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z, Ctrl + Y | Redo |
| Ctrl/Cmd + A | Select all parts |
| Esc | Back out: half-finished measurement → measure tool → selection |
| H / I / U | Hide selection / isolate selection / show all |
| X | X-ray selection (see-through) |
| Q | Measure: off → distance → angle |
| S | Section: off → X → Y → Z |
| E | Explode / assemble |
| R | Reset the model's position and view |
| L | Part labels (while exploded) |
| M | Hologram / original materials |
| D | Debug overlay (hand skeletons, FPS, quality) |
| F / B / C | Mirror video / black & white / next camera |

## Hand gestures (webcam)

| Gesture | Action |
|---|---|
| ✊ Fist | Grab and move the model |
| ☝ Point, move the fingertip | Rotate with your finger |
| ☝ Point, then flick | Spin (coasts to a stop) |
| 🖐🖐 Two open palms, hold, spread / close | Scale |
| ✊✊ Two fists pulled apart | Explode |
| ✊↺ Twist a fist counter-clockwise | Explode |
| 👌 Pinch a part (exploded) | Pull it out; hold 1 s for its info card |
| 👌 Pinch and hold on empty space | Radial menu |
| 👏 Clap | Reassemble |

A whole gesture (grab → move → release) is one undo step.

## Panels

- **Top-left:** status (model, real size, tracking) and the selection card (name, place in the
  assembly, size, HIDE / ISOLATE / X-RAY).
- **Right:** PARTS (assembly tree, search, eye toggles), LIBRARY (upload, conversions, samples),
  DISPLAY (mirror, B&W, labels, debug, materials, dim, quality, camera).
- **Bottom-left:** UNDO / REDO, FIT, views, units; beside it SECTION and measuring
  (↔ DIST / ∠ ANGLE) with the measurement list.

## URL options

| Option | Effect |
|---|---|
| `?quality=high\|medium\|low\|safe` | Force a quality level (`safe` if the page won't start) |
| `?tracking=off` | Skip hand tracking (mouse-only use, no camera model download) |
