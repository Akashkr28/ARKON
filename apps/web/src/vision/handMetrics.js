import { HAND, TRACKING } from '../config';

// Pure measurements on one hand's smoothed landmarks (video pixels).
// Landmark indices: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker

export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;
export const PINKY_MCP = 17;

const FINGERTIPS = [4, 8, 12, 16, 20];
const PALM_POINTS = [0, 5, 9, 13, 17];

export function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Palm size ≈ wrist-to-middle-knuckle length. Knuckle width × 1.3 estimates the same
// length; taking the larger of the two means turning or tilting the hand (which
// foreshortens one of them) doesn't make the palm look smaller.
export function palmSize(landmarks) {
  const length = distance2D(landmarks[WRIST], landmarks[MIDDLE_MCP]);
  const widthEstimate = distance2D(landmarks[INDEX_MCP], landmarks[PINKY_MCP]) * 1.3;
  return Math.max(length, widthEstimate, 1);
}

// 0 = fist, 1 = fully open.
export function openness(landmarks, palm) {
  let total = 0;
  for (const tip of FINGERTIPS) total += distance2D(landmarks[tip], landmarks[WRIST]);
  const ratio = total / FINGERTIPS.length / palm;
  const t = (ratio - HAND.closedRatio) / (HAND.openRatio - HAND.closedRatio);
  return Math.min(1, Math.max(0, t));
}

// Pinhole camera: distance = focalLength × realSize / pixelSize.
export function distanceMetres(palmPixels, videoWidth) {
  const halfFov = (TRACKING.assumedHorizontalFovDeg * Math.PI) / 360;
  const focalLengthPx = videoWidth / 2 / Math.tan(halfFov);
  return (focalLengthPx * TRACKING.palmReferenceMetres) / palmPixels;
}

// Hysteresis: easier to stay pinched than to start, so the pinch doesn't flicker
// when the fingers hover at the threshold.
export function pinchState(wasPinching, landmarks, palm) {
  const ratio = distance2D(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / palm;
  const pinching = wasPinching ? ratio < HAND.pinchExit : ratio < HAND.pinchEnter;
  return { pinching, ratio };
}

export function palmCenter(landmarks, out) {
  out.x = 0;
  out.y = 0;
  for (const i of PALM_POINTS) {
    out.x += landmarks[i].x;
    out.y += landmarks[i].y;
  }
  out.x /= PALM_POINTS.length;
  out.y /= PALM_POINTS.length;
  return out;
}

export function pinchPoint(landmarks, out) {
  out.x = (landmarks[THUMB_TIP].x + landmarks[INDEX_TIP].x) / 2;
  out.y = (landmarks[THUMB_TIP].y + landmarks[INDEX_TIP].y) / 2;
  return out;
}
