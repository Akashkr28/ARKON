import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import { TRACKING } from '../config';

function recognizerOptions(delegate) {
  return {
    baseOptions: { modelAssetPath: TRACKING.modelUrl, delegate },
    runningMode: 'VIDEO',
    numHands: TRACKING.numHands,
    minHandDetectionConfidence: TRACKING.minHandDetectionConfidence,
    minHandPresenceConfidence: TRACKING.minHandPresenceConfidence,
    minTrackingConfidence: TRACKING.minTrackingConfidence,
  };
}

// GestureRecognizer also returns the full hand landmarks, so one model covers both.
// preferredDelegate 'CPU' (SAFE quality) skips the GPU attempt entirely.
export async function createGestureRecognizer(preferredDelegate = 'GPU') {
  const fileset = await FilesetResolver.forVisionTasks(TRACKING.wasmUrl);
  if (preferredDelegate === 'CPU') {
    const recognizer = await GestureRecognizer.createFromOptions(fileset, recognizerOptions('CPU'));
    return { recognizer, delegate: 'CPU' };
  }
  try {
    const recognizer = await GestureRecognizer.createFromOptions(fileset, recognizerOptions('GPU'));
    return { recognizer, delegate: 'GPU' };
  } catch (gpuError) {
    console.warn('GPU delegate unavailable, falling back to CPU:', gpuError);
    const recognizer = await GestureRecognizer.createFromOptions(fileset, recognizerOptions('CPU'));
    return { recognizer, delegate: 'CPU' };
  }
}

// Runs recognition once per new video frame, at most maxHz times a second.
// Returns a stop function.
export function runDetectionLoop(video, recognizer, onResult, onError, { maxHz = 60 } = {}) {
  let frameHandle = 0;
  let lastVideoTime = -1;
  let lastTimestamp = 0;
  // A little slack so a 30 Hz cap doesn't drop every other frame of a 30 fps camera.
  const minIntervalMs = (1000 / maxHz) * 0.9;

  const loop = () => {
    frameHandle = requestAnimationFrame(loop);
    // The display refreshes faster than the camera; skip frames we've already seen.
    if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
    const now = performance.now();
    if (now - lastTimestamp < minIntervalMs) return;
    lastVideoTime = video.currentTime;

    // MediaPipe rejects timestamps that don't strictly increase.
    const timestamp = Math.max(now, lastTimestamp + 1);
    lastTimestamp = timestamp;

    try {
      const started = performance.now();
      const result = recognizer.recognizeForVideo(video, timestamp);
      onResult(result, performance.now() - started, timestamp);
    } catch (error) {
      cancelAnimationFrame(frameHandle);
      onError(error);
    }
  };

  frameHandle = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(frameHandle);
}
