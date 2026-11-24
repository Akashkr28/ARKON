import { TRACKING } from '../config';
import { useHandStore } from '../store/handStore';
import { useViewerStore } from '../store/viewerStore';
import { LandmarkFilter } from './smoothing';
import { assignSlots, pruneSlots } from './handIdentity';
import {
  INDEX_TIP,
  distanceMetres,
  openness,
  palmCenter,
  palmSize,
  pinchPoint,
  pinchState,
} from './handMetrics';
import { createViewportMapping, screenToPlane, videoToScreen } from './projection';
import { createGestureEngine } from './gestureEngine';

// Turns raw GestureRecognizer results into smoothed, measured hands and publishes
// them to the hand store. Hand objects are reused frame to frame to avoid garbage.

const point2 = () => ({ x: 0, y: 0 });
const point3 = () => ({ x: 0, y: 0, z: 0 });

function createHand(id) {
  return {
    id,
    handedness: 'Right', // the person's actual hand, corrected for mirroring
    gesture: 'None', // MediaPipe canned gesture: Closed_Fist, Open_Palm, Pointing_Up, …
    gestureScore: 0,
    landmarks: Array.from({ length: 21 }, point3), // smoothed, video pixels
    screen: Array.from({ length: 21 }, point2), // screen pixels (mirroring applied)
    palmSizePx: 1,
    palmSizeScreen: 1,
    openness: 0,
    distanceM: 0,
    pinching: false,
    pinchRatio: 1,
    palmScreen: point2(),
    pinchScreen: point2(),
    indexTipScreen: point2(),
    palmWorld: point3(), // on the plane at the model's depth
    pinchWorld: point3(),
    indexTipWorld: point3(),
  };
}

const slots = new Map();
const gestureEngine = createGestureEngine();
let nextHandId = 1;
const scratch = point2();

function createSlot() {
  const id = nextHandId++;
  return {
    id,
    filter: new LandmarkFilter(),
    hand: createHand(id),
    lastSeenMs: 0,
    // Running vote so a single mislabelled frame doesn't flip LEFT/RIGHT.
    handednessVote: 0,
  };
}

function updateHandedness(slot, label) {
  const reported = TRACKING.swapHandedness ? (label === 'Left' ? 'Right' : 'Left') : label;
  const vote = slot.handednessVote + (reported === 'Right' ? 1 : -1);
  slot.handednessVote = Math.max(-8, Math.min(8, vote));
  slot.hand.handedness = slot.handednessVote >= 0 ? 'Right' : 'Left';
}

function updateHand(slot, detection, frame) {
  const { hand } = slot;
  const { videoWidth, videoHeight, mapping, modelZ, timeSeconds } = frame;

  slot.filter.apply(detection.landmarks, videoWidth, videoHeight, timeSeconds, hand.landmarks);
  updateHandedness(slot, detection.handedness);
  hand.gesture = detection.gesture?.categoryName ?? 'None';
  hand.gestureScore = detection.gesture?.score ?? 0;

  const lm = hand.landmarks;
  hand.palmSizePx = palmSize(lm);
  hand.palmSizeScreen = hand.palmSizePx * mapping.scale;
  hand.openness = openness(lm, hand.palmSizePx);
  hand.distanceM = distanceMetres(hand.palmSizePx, videoWidth);

  const pinch = pinchState(hand.pinching, lm, hand.palmSizePx);
  hand.pinching = pinch.pinching;
  hand.pinchRatio = pinch.ratio;

  for (let i = 0; i < 21; i++) videoToScreen(lm[i], mapping, hand.screen[i]);
  videoToScreen(palmCenter(lm, scratch), mapping, hand.palmScreen);
  videoToScreen(pinchPoint(lm, scratch), mapping, hand.pinchScreen);
  videoToScreen(lm[INDEX_TIP], mapping, hand.indexTipScreen);

  const { screenWidth, screenHeight } = mapping;
  screenToPlane(hand.palmScreen, screenWidth, screenHeight, modelZ, hand.palmWorld);
  screenToPlane(hand.pinchScreen, screenWidth, screenHeight, modelZ, hand.pinchWorld);
  screenToPlane(hand.indexTipScreen, screenWidth, screenHeight, modelZ, hand.indexTipWorld);
}

function toDetections(result) {
  return result.landmarks.map((landmarks, i) => ({
    landmarks,
    handedness: result.handedness[i]?.[0]?.categoryName ?? 'Right',
    gesture: result.gestures[i]?.[0],
  }));
}

let lastFrameMs = 0;
let fpsEstimate = 0;
let inferenceEstimate = 0;

function updateTimings(nowMs, inferenceMs) {
  if (lastFrameMs) {
    const instantFps = 1000 / Math.max(nowMs - lastFrameMs, 1);
    fpsEstimate = fpsEstimate ? fpsEstimate * 0.9 + instantFps * 0.1 : instantFps;
  }
  inferenceEstimate = inferenceEstimate ? inferenceEstimate * 0.9 + inferenceMs * 0.1 : inferenceMs;
  lastFrameMs = nowMs;
}

export function processResult(result, video, inferenceMs, nowMs) {
  const viewer = useViewerStore.getState();
  const frame = {
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    mapping: createViewportMapping(
      video.videoWidth,
      video.videoHeight,
      window.innerWidth,
      window.innerHeight,
      viewer.mirror,
    ),
    modelZ: viewer.position[2],
    timeSeconds: nowMs / 1000,
  };

  const matched = assignSlots(
    toDetections(result),
    slots,
    frame.videoWidth,
    frame.videoHeight,
    createSlot,
  );
  const hands = matched.map(([slot, detection]) => {
    slot.lastSeenMs = nowMs;
    updateHand(slot, detection, frame);
    return slot.hand;
  });
  pruneSlots(slots, nowMs);

  const gesture = gestureEngine.update(
    hands,
    nowMs,
    frame.mapping.screenWidth,
    frame.mapping.screenHeight,
  );

  updateTimings(nowMs, inferenceMs);
  useHandStore.setState((state) => ({
    hands,
    gestureState: gesture.state,
    activeHandIds: gesture.activeHandIds,
    poses: gesture.poses,
    menu: gesture.menu,
    cursors: gesture.cursors,
    flickSpeed: gesture.flickSpeed,
    frame: state.frame + 1,
    trackFps: fpsEstimate,
    inferenceMs: inferenceEstimate,
    videoSize: [frame.videoWidth, frame.videoHeight],
  }));
}

export function resetPipeline() {
  slots.clear();
  gestureEngine.reset();
  lastFrameMs = 0;
  fpsEstimate = 0;
  inferenceEstimate = 0;
  useHandStore.setState({
    hands: [],
    trackFps: 0,
    inferenceMs: 0,
    gestureState: 'IDLE',
    activeHandIds: [],
    poses: {},
    menu: null,
    cursors: [],
    picker: null,
    flickSpeed: null,
  });
}
