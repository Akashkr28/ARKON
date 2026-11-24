# HoloCAD controls

One page with every way to drive HoloCAD. Everything below goes through the same
`viewerActions`, so gestures, mouse, keyboard (and later the AI assistant) can be mixed freely
and all share one undo history.

## Mouse, trackpad, touch

| Input | Action |
|---|---|
| Left drag / one finger | Rotate (around the point you grab, so close-ups stay in view) |
| Right or middle drag, Shift + drag | Pan (the grabbed point follows the cursor 1:1) |
| Wheel, trackpad scroll, pinch | Zoom toward the surface under the cursor, down to ~2 mm across the screen |
| Click a part | Select it (click empty space to clear) |
| Shift / Ctrl / Cmd + click | Add to or remove from the selection |
| Double-click a part | Frame that part (empty space: the whole model) |
| Hover, with SPECS open | Names the CAD face or edge under the cursor (Ø80 hole, R5 fillet, flat face facing +Z, Ø80 circular edge…) and highlights it |
| Click, with SPECS open | Also keeps that face or edge in the spec sheet |
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
| Esc | Back out: half-finished measurement → measure tool → mate tool → selection |
| H / I / U | Hide selection / isolate selection / show all |
| X | X-ray selection (see-through) |
| P | Spec sheet of the selection (again: back to PARTS) |
| G | Ruler grid in real units: on the section plane when there is one, else the floor; cell size follows the zoom |
| Q | Measure: off → distance → angle |
| S | Section: off → X → Y → Z |
| E | Explode / assemble |
| R | Reset the model's position and view |
| L | Part labels (while exploded) |
| M | Hologram / original materials |
| D | Debug overlay (hand skeletons, FPS, quality) |
| F / B / C | Mirror video / black & white / next camera |

## Hand gestures (webcam)

Each hand has a **cursor**: a ring between your thumb and index finger (cyan for the right
hand, pink for the left). Whatever a tap would press is outlined in yellow. Aim with a
relaxed or open hand; pointing turns the model.

**Tap to do anything you could click:**

| Gesture | Action |
|---|---|
| 👌 Tap (quick pinch and release) on a button, tab, checkbox | Press it: switch VIEW / DESIGN / ASSEMBLE, add features, export, … |
| 👌 Tap a dropdown | Its options open as big buttons; tap one to choose |
| 👌 Tap a part | Select it (as a click: shows its info; in ASSEMBLE selects that part; measuring places a point; with a mate tool picks a face) |
| 👌 Tap empty space | Clear the selection |
| 🖐 + 👌 Tap with the other palm open | Add or remove a part from the selection (like Shift-click) |
| 👌👌 Double tap | Frame that part (empty space: everything) |
| 👌↕ Pinch and drag on a panel | Scroll it |
| 👌↔ Pinch a slider | Drag it |
| 👌 Tap a text or number field | Focus it (type the value on the keyboard) |

**Move and shape:**

| Gesture | Action |
|---|---|
| ✊ Fist | Grab and move the model |
| ☝ Point, move the fingertip | Rotate with your finger |
| ☝ Point, then flick | Spin (coasts to a stop) |
| 🖐🖐 Two open palms, hold, spread / close | Scale |
| ✊✊ Two fists pulled apart | Explode |
| ✊↺ Twist a fist counter-clockwise | Explode |
| 👌 Pinch a part (exploded), move or hold | Pull it out; hold 1 s for its info card |
| 👌 Pinch a handle (DESIGN) / a part (ASSEMBLE) and move | Shape the part / move the part |
| 👏 Clap | Reassemble |

**Radial menu:** pinch and hold still on empty space (the ring fills), move toward an item,
release. With parts selected the items act on them:

| Direction | Nothing selected | Parts selected |
|---|---|---|
| ↑ | Explode / assemble | same |
| ↗ | Select all | Deselect |
| → | Fit all | Fit selection |
| ↘ | Show all | Isolate |
| ↓ | Hologram / original materials | same |
| ↙ | Spawn here | Hide |
| ← | Undo (in this workspace) | same |
| ↖ | Reset | same |

A whole gesture (grab → move → release) is one undo step. Esc closes a dropdown opened by a tap.

## Panels

- **Top-left:** status (model, real size, tracking) and the selection card (name, place in the
  assembly, size, part number and mass, HIDE / ISOLATE / X-RAY / SPECS).
- **Right:** PARTS (assembly tree, search, eye toggles), SPECS (the selected part's spec sheet:
  part number, material and mass, exact size, volume, area, centre of mass, holes / outer
  diameters / fillets; pick another material to see its mass; MM / IN; totals for a
  multi-selection; BOM export: CSV for spreadsheets / ERP, PDF report with a picture of the
  current view, totals, mass by material and the full parts list), LIBRARY (upload, conversions, samples), DISPLAY (mirror, B&W, labels, debug,
  materials, dim, quality, camera).
- **Bottom-right:** scale bar (follows the zoom), grid spacing, and the X / Y / Z coordinates
  (Y up) of the surface under the cursor, with the part's name.
- **Bottom-left:** UNDO / REDO, FIT, views, units; beside it SECTION and measuring
  (↔ DIST / ∠ ANGLE) with the measurement list.

## URL options

| Option | Effect |
|---|---|
| `?quality=high\|medium\|low\|safe` | Force a quality level (`safe` if the page won't start) |
| `?tracking=off` | Skip hand tracking (mouse-only use, no camera model download) |

## Design workspace (DESIGN tab)

- Starts with a mounting plate; **Base shape…** swaps the base (box, cylinder, tube, prism),
  **+ Add feature…** adds holes, pockets, bosses, fillets, chamfers or a shell.
- Click a feature to edit its numbers (mm); the part rebuilds as you type. Checkbox: suppress;
  ▲ ▼: reorder; ✕: delete. A feature that can't be built says why and is skipped.
- Holes and bosses go down from / up on the top face at X, Y; patterns: row, grid, circle.
- **Parameters and formulas:** PARAMETERS holds named values (length = 120, margin = 15, or a
  formula using others). Any dimension can be a number or a formula: type `length - 2 * margin`
  into a field (yellow = formula, its result beside it). `+ - * / ^ ( )`, `min max abs round
  floor ceil sqrt sin cos tan` (degrees), `pi`. Renaming a parameter updates every formula.
  Mistakes (unknown names, loops) show on the parameter or feature, and that feature is skipped.
- **Shaping by hand:** the selected feature (or the base shape) shows yellow handles on the part.
  Drag an **arrow** to change that dimension (box length/width/height, diameters, pocket
  depth, boss height); drag a **ring** to slide a hole, pocket or boss across the top face. Steps
  of 1 mm, **Shift** for 0.1 mm. With the webcam, **pinch** a handle and move. A dimension that is
  a parameter's name moves the parameter (everything using it follows); one set by a real formula
  is greyed and says which formula. A whole drag is one undo step.
- **Undo / redo** (UNDO / REDO, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) step through design edits while in
  DESIGN; typing into one field counts as one step.
- **Autosave:** the design is kept in this browser between visits. **SAVE DESIGN** downloads it as
  `.holocad.json` (features, parameters, formulas) and **OPEN DESIGN** reopens one.
- **MATERIAL & LOOK:** the material (15, from steel to oak) sets the part's colour and its mass;
  pick your own **colour** (↺ goes back to the material's) and a **finish** (matte, satin,
  polished). Changing the look switches the view to ORIGINAL materials (M toggles back to the
  hologram). The look is saved with the design and can be undone.
- PROPERTIES: size, volume, area, faces, and mass in the part's material.
- **EXPORT GLB** downloads the part as shown (colour and finish) for Blender, AR viewers, the web.
- **EXPORT STEP** downloads the part for any CAD program; **SAVE TO LIBRARY** converts it like an
  uploaded STEP file (spec sheet, face inspector, BOM). **RE-FIT** re-centres after big changes.
- Navigation, measuring, section planes and the hologram work on the part as on any model.
- **USE IN ASSEMBLY** puts a copy of the part into the ASSEMBLE workspace.

## Assembly workspace (ASSEMBLE tab)

- **Add parts:** **+ THIS DESIGN** (a copy of the part in DESIGN as it is now), **+ DESIGN FILE…**
  (a saved `.holocad.json`), or **+ Add a model** (the bundled samples and anything READY in your
  library). New parts are laid out side by side, at real size.
- **Move:** drag a part (mouse, or **pinch** it with the webcam). A free part follows the pointer
  in the plane facing you; steps of 1 mm, **Shift** for 0.1 mm. Click a part to select it; its
  panel takes exact X / Y / Z (mm, Z up) and turns it a quarter about X, Y or Z.
  **Shift + drag** pans the view instead; drag empty space to orbit as usual.
- **Mate** two parts: choose **FACE TO FACE** or **ON AXIS**, click a face on the part that
  moves, then a face on the part it attaches to. The face under the cursor lights up yellow and is
  named (flat face, round face Ø8.0 mm); the first pick stays blue. Esc cancels.
  - *Face to face:* two flat faces, pressed together. Free: slide across the face, gap, angle.
  - *On axis:* two round faces (a pin and a hole, a shaft and a bore) share an axis. Free: slide
    along it, angle.
  - Dragging a mated part slides it only the way its mate allows; the panel has the exact
    numbers, **⟲ 90° / 15°** turns it about the mate, **FLIP** turns it over, **UNMATE** detaches
    it where it is. Each part attaches to one other; moving a part carries everything attached
    to it.
- Faces come from the CAD data: a designed part's own faces, or a converted model's face data.
  A model without face data offers single triangles ("flat spot"), enough for face to face.
- **LOOK** (selected part): a designed part's material, colour and finish (its own, starting
  from its design's); a model can be **Painted** one colour and finish, or kept **Original**.
- **PROPERTIES:** part count and total mass, then each kind of part with quantity, mass,
  material and size. Designed parts weigh what their material says; models weigh what their
  CAD file's materials say, and parts without a material are counted, not guessed.
- **EXPORT:** **EXPORT GLB** (everything, placed and coloured), **EXPORT STEP** (the designed
  parts as one STEP assembly, each part named, coloured and placed; models are meshes here, so
  they're left out and the message names them), **BOM CSV**, and **SAVE TO LIBRARY** (the
  assembly becomes a model you can open, explode and measure in the viewer).
- **Undo / redo** step through assembly edits; a whole drag is one step. The assembly autosaves
  in this browser; **SAVE ASSEMBLY / OPEN ASSEMBLY** use `.holocad-assembly.json` (designed parts
  are stored inside it; models are referenced by their library id).

