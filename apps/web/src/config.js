// Every tunable number lives here. Gesture thresholds get added as each gesture lands.

const base = import.meta.env.BASE_URL;

// Bundled sample models, available even when the API is offline. Your own models
// are uploaded through the LIBRARY panel (or dropped onto the window) instead.
export const MODELS = [
  { id: 'engine', label: '2-Cylinder Engine', url: `${base}models/2CylinderEngine.glb` },
  { id: 'gearbox', label: 'Gearbox Assembly', url: `${base}models/GearboxAssy.glb` },
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
  minScale: 0.25,
  maxScale: 4,
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

  // Pinch held this long on empty space opens the radial menu.
  menuHoldMs: 600,
  menuRadiusPx: 110,
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
  color: '#2ee6ff',
  baseOpacity: 0.06,
  fresnelPower: 2.2,
  fresnelStrength: 1.1,
};
