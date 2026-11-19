import { GESTURE } from '../config';
import { WRIST, distance2D } from './handMetrics';

// Coarse hand poses the gesture engine works with.
export const POSE = {
  NONE: 'NONE',
  FIST: 'FIST',
  OPEN: 'OPEN',
  POINT: 'POINT',
  PINCH: 'PINCH',
};

// [middle joint (PIP), tip] for each non-thumb finger.
const INDEX = [6, 8];
const OTHER_FINGERS = [
  [10, 12],
  [14, 16],
  [18, 20],
];

function isExtended(landmarks, [pip, tip]) {
  return (
    distance2D(landmarks[tip], landmarks[WRIST]) >
    distance2D(landmarks[pip], landmarks[WRIST]) * GESTURE.fingerExtendedRatio
  );
}

// Combines MediaPipe's canned gesture with our own landmark checks. MediaPipe only
// knows "Pointing_Up", so pointing sideways is detected from finger extension.
export function classifyPose(hand) {
  const lm = hand.landmarks;
  const othersExtended = OTHER_FINGERS.filter((finger) => isExtended(lm, finger)).length;

  // Point is checked first: with only one finger out, average openness is low enough
  // to look like a fist. A real fist never has the index extended, so this is safe.
  // One loosely curled finger is tolerated; holding all three perfectly tucked is tiring.
  const pointing = isExtended(lm, INDEX) && othersExtended <= 1;
  if (!hand.pinching && (hand.gesture === 'Pointing_Up' || pointing)) return POSE.POINT;

  if (hand.gesture === 'Closed_Fist') return POSE.FIST;
  if (hand.pinching) return POSE.PINCH;
  if (hand.openness < GESTURE.fistMaxOpenness) return POSE.FIST;

  if (hand.gesture === 'Open_Palm' || (hand.openness > GESTURE.openMinOpenness && othersExtended === 3)) {
    return POSE.OPEN;
  }
  return POSE.NONE;
}

// A pose only changes after the new one has been seen `frames` times in a row.
export class PoseDebouncer {
  constructor(frames = GESTURE.debounceFrames) {
    this.frames = frames;
    this.pose = POSE.NONE;
    this.candidate = POSE.NONE;
    this.count = 0;
  }

  update(rawPose) {
    if (rawPose === this.pose) {
      this.count = 0;
    } else if (rawPose === this.candidate) {
      this.count += 1;
      if (this.count >= this.frames) {
        this.pose = rawPose;
        this.count = 0;
      }
    } else {
      this.candidate = rawPose;
      this.count = 1;
    }
    return this.pose;
  }
}
