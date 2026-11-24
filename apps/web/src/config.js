// Every tunable number lives here. Gesture thresholds get added as each gesture lands.

const base = import.meta.env.BASE_URL;

// Bundled sample models, available even when the API is offline. Your own models
// are uploaded through the LIBRARY panel (or dropped onto the window) instead.
// The first entry is what opens on startup.
export const MODELS = [
  {
    id: 'aster',
    label: 'Aster C1 (compact car)',
    url: `${base}models/AsterC1.glb`,
    // Measured part specs, written by the converter beside the GLB (see ATTRIBUTION.md).
    specsUrl: `${base}models/AsterC1.specs.json`,
    facesUrl: `${base}models/AsterC1.faces.json`, // CAD faces and edges, for the inspector
  },
];

// Materials for the spec sheet's mass calculation; density in kg/m³. A part's material
// from the CAD file is offered first; these are for parts without one, or what-ifs.
// color / metal: how a part in this material looks when you don't choose otherwise.
export const MATERIAL_LIBRARY = [
  { id: 'steel', name: 'Steel (structural)', density: 7850, color: '#8a9097', metal: true },
  { id: 'stainless', name: 'Stainless steel 304', density: 8000, color: '#c3c8cc', metal: true },
  { id: 'cast-iron', name: 'Grey cast iron', density: 7200, color: '#5d6166', metal: true },
  { id: 'aluminium', name: 'Aluminium 6061', density: 2700, color: '#b9c0c7', metal: true },
  { id: 'titanium', name: 'Titanium Ti-6Al-4V', density: 4430, color: '#8f8a85', metal: true },
  { id: 'brass', name: 'Brass', density: 8500, color: '#c9a441', metal: true },
  { id: 'copper', name: 'Copper', density: 8960, color: '#c27a4a', metal: true },
  { id: 'abs', name: 'ABS', density: 1050, color: '#e8e4da', metal: false },
  { id: 'pla', name: 'PLA', density: 1240, color: '#3b82c4', metal: false },
  { id: 'nylon', name: 'Nylon PA6', density: 1140, color: '#ece8dc', metal: false },
  { id: 'polycarbonate', name: 'Polycarbonate', density: 1200, color: '#d9e6ee', metal: false },
  { id: 'rubber', name: 'Rubber', density: 1150, color: '#26282a', metal: false },
  { id: 'glass', name: 'Glass', density: 2500, color: '#a9d6e5', metal: false },
  { id: 'cfrp', name: 'Carbon fibre composite', density: 1600, color: '#2d3035', metal: false },
  { id: 'oak', name: 'Wood (oak)', density: 750, color: '#a87b4f', metal: false },
];

export const LIBRARY = {
  // While any model is queued or converting, its status is re-checked this often.
  pollMs: 1000,
  // While the API is unreachable, check back this often so the panel recovers on its own.
  offlineRetryMs: 5000,
  acceptedExtensions: ['.step', '.stp', '.glb'],
  defaultQuality: 'standard',
};

// Rendering/tracking quality. AUTO picks one per device (see quality.js); users can
// override it in the HUD or with ?quality=low in the URL. Changing it reloads the page,
// because camera resolution, antialiasing and the tracking delegate are fixed at startup.
export const QUALITY_LEVELS = ['high', 'medium', 'low', 'safe'];
export const QUALITY_PRESETS = {
  high: {
    label: 'HIGH',
    description: '1080p camera, sharpest rendering, full glow',
    camera: { width: 1920, height: 1080 },
    maxPixelRatio: 2,
    antialias: true,
    bloom: 1, // multiplier on BLOOM.intensity; 0 turns the effect off
    delegate: 'GPU',
    maxDetectHz: 60,
  },
  medium: {
    label: 'MEDIUM',
    description: '720p camera, full glow; good for most laptops',
    camera: { width: 1280, height: 720 },
    maxPixelRatio: 1.5,
    antialias: true,
    bloom: 1,
    delegate: 'GPU',
    maxDetectHz: 30,
  },
  low: {
    label: 'LOW',
    description: '720p camera, lighter glow, no antialiasing',
    camera: { width: 1280, height: 720 },
    maxPixelRatio: 1,
    antialias: false,
    bloom: 0.6,
    delegate: 'GPU',
    maxDetectHz: 24,
  },
  safe: {
    label: 'SAFE',
    description: '480p camera, no glow, tracking on the CPU; use if the page won’t start',
    camera: { width: 640, height: 480 },
    maxPixelRatio: 1,
    antialias: false,
    bloom: 0,
    delegate: 'CPU',
    maxDetectHz: 15,
  },
};

// If rendering stays below minFps for this many seconds, offer the next level down.
export const PERFORMANCE = {
  minFps: 20,
  slowForSeconds: 6,
};

export const VIEW = {
  cameraFov: 45,
  cameraZ: 5,
  // Every model is scaled so its bounding sphere has this radius (scene units).
  modelRadius: 1,
  // Zoom range (the model is scaled; the camera stays put).
  minScale: 0.1,
  maxScale: 20, // at least; real models may zoom further (closestViewMetres)
  // Zooming stops when this much of the model (metres) fills the screen height at the
  // model's depth: 2 mm, enough to read a thread or a small fillet on a 4 m car.
  closestViewMetres: 0.002,
  // Ruler grid (G): cells about this many pixels wide at the hovered depth; a brighter
  // line every 10 cells; this many cells each side of the centre.
  gridCellPx: 40,
  gridHalfCells: 30,
  maxExplode: 1.5,
  // Higher = snappier. Used as 1 - exp(-damping * dt) so it's frame-rate independent.
  transformDamping: 12,
  explodeDamping: 5,
  // Spin velocity decays by this factor per second (exponential).
  spinFriction: 1.6,
  maxLabels: 40,
  // How quickly a pulled part follows the hand / springs back.
  pullDamping: 14,
  // Picking also tries points this far (in NDC) around the pinch, for thin parts.
  pickRadiusNdc: 0.025,
};

// Measuring: snap radius in screen pixels, and what counts as a real edge.
export const MEASURE = {
  snapVertexPx: 10,
  snapEdgePx: 7,
  // Inspector (SPECS tab open): a CAD edge this close to the cursor is picked over the face.
  inspectEdgePx: 6,
  // Faces meeting at more than this angle form an edge you can snap to; smaller
  // creases are just the tessellation of a curved surface.
  featureEdgeAngleDeg: 25,
};

// Mouse, trackpad and touch navigation.
export const NAVIGATION = {
  rotatePerPixel: 0.008, // radians of model rotation per pixel dragged
  wheelZoomPerPixel: 0.0015, // zoom factor = exp(-deltaY × this)
  // A press that moves less than this is a click (select), not a drag.
  dragThresholdPx: 4,
};

export const TRACKING = {
  wasmUrl: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${__MEDIAPIPE_VERSION__}/wasm`,
  modelUrl:
    'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
  numHands: 2,
  minHandDetectionConfidence: 0.6,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,

  // MediaPipe's left/right labels come out swapped for raw (un-mirrored) webcam frames.
  // If LEFT/RIGHT on the hand cards are backwards for you, flip this.
  swapHandedness: true,

  // Webcams don't report their field of view; 60° horizontal is typical for laptops.
  assumedHorizontalFovDeg: 60,
  // Real-world size of our "palm size" measure (≈ wrist to middle knuckle, adult hand).
  palmReferenceMetres: 0.085,

  // A hand that vanishes for this long gets a fresh identity (and filter) when it returns.
  lostHandGraceMs: 300,
  // Max wrist jump between frames, as a fraction of video width, to count as the same hand.
  maxMatchDistance: 0.25,
};

// One Euro filter, applied to landmarks in video-pixel units.
export const SMOOTHING = {
  minCutoff: 1.0, // Hz. Lower = less jitter at rest, more lag.
  beta: 0.007, // Higher = less lag during fast motion.
  derivativeCutoff: 1.0,
};

export const HAND = {
  // Pinch when thumb–index distance < pinchEnter × palm size; release above pinchExit.
  pinchEnter: 0.25,
  pinchExit: 0.35,
  // Average fingertip–wrist distance / palm size for a fist and a fully open hand.
  closedRatio: 1.0,
  openRatio: 1.9,
};

// Speeds are in palm-lengths per second, so they feel the same near or far from the camera.
export const GESTURE = {
  // A pose must be seen this many consecutive tracked frames before it counts.
  debounceFrames: 4,

  fistMaxOpenness: 0.25,
  openMinOpenness: 0.7,
  // A finger is extended when its tip is this much farther from the wrist than its middle joint.
  fingerExtendedRatio: 1.1,

  // Fist move: model moves this many scene units per scene unit of palm movement.
  moveGain: 1.0,

  // Point: while pointing, moving the fingertip rotates the model directly (drag),
  // radians per palm-length of fingertip movement.
  pointDragGain: 1.2,
  // Flick: fire when the fingertip passes flickMinSpeed, re-arm below flickRearmSpeed.
  // Press D to see the live fingertip speed while pointing.
  flickMinSpeed: 3,
  flickRearmSpeed: 1.5,
  flickSpinGain: 0.5, // radians/sec of spin per palm-length/sec of flick
  maxSpinSpeed: 12, // radians/sec
  // Fingertip velocity smoothing; higher keeps more of a quick flick's peak speed.
  flickVelocitySmoothing: 0.8,

  // Two open palms must be held this still for this long before scaling engages.
  scaleArmMs: 300,
  stillMaxSpeed: 1.5,

  // Smoothing for measured hand velocities (0..1, higher = more responsive).
  velocitySmoothing: 0.5,

  // Two fists: each extra palm-length of spread between them adds this much explode.
  explodePerPalm: 0.25,

  // Fist twist (counter-clockwise as you see it) explodes. It only engages past the
  // deadzone, and only if the fist hasn't wandered more than maxDrift palm-lengths.
  twistDeadzoneDeg: 30,
  twistFullExplodeDeg: 90, // further twist needed for +1 explode
  twistMaxDrift: 0.6,

  // Air tap: a pinch released within tapMaxMs, having moved less than tapMaxMove
  // palm-lengths, clicks whatever is under it. Two taps within doubleTapMs and
  // doubleTapPx of each other are a double-click.
  tapMaxMs: 350,
  tapMaxMove: 0.35,
  doubleTapMs: 450,
  doubleTapPx: 50,
  // Pinch-dragging a panel scrolls it this many pixels per pixel of hand movement.
  scrollGain: 1.5,

  // Pinch held this long on empty space opens the radial menu.
  menuHoldMs: 600,
  menuRadiusPx: 140,
  menuSelectMinPx: 45, // pinch must move this far from centre to highlight an item

  // Holding a picked part this long shows its info card.
  partInfoHoldMs: 1000,

  // Clap: palms close (< closeSpread palm-lengths apart) after approaching by at least
  // minApproach within approachWindowMs, then reopen past openSpread within reopenWindowMs.
  clap: {
    closeSpread: 1.6,
    openSpread: 2.0,
    minApproach: 1.8,
    approachWindowMs: 500,
    reopenWindowMs: 800,
    cooldownMs: 1200,
  },
};

// Overlapping additive parts add up quickly, so the threshold sits above the
// faint faces and only the fresnel edges and rings glow.
export const BLOOM = {
  luminanceThreshold: 0.45,
  luminanceSmoothing: 0.3,
  intensity: 0.9,
  radius: 0.55,
  // Bloom renders at this fraction of screen resolution; lower is cheaper.
  resolutionScale: 0.5,
};

export const RINGS = {
  leftColor: '#ff4fd8',
  rightColor: '#2ee6ff',
  palmRadius: 0.55, // in palm-lengths
  pulseSeconds: 0.5,
};

export const HOLOGRAM = {
  selectedColor: '#ffd23f',
  // X-ray: dim hologram colour, or this opacity for original materials.
  xrayColor: '#0b3f48',
  xrayOpacity: 0.18,
  color: '#2ee6ff',
  baseOpacity: 0.06,
  fresnelPower: 2.2,
  fresnelStrength: 1.1,
};
