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
export async function createGestureRecognizer() {
  const fileset = await FilesetResolver.forVisionTasks(TRACKING.wasmUrl);
  try {
    const recognizer = await GestureRecognizer.createFromOptions(fileset, recognizerOptions('GPU'));
    return { recognizer, delegate: 'GPU' };
  } catch (gpuError) {
    console.warn('GPU delegate unavailable, falling back to CPU:', gpuError);
    const recognizer = await GestureRecognizer.createFromOptions(fileset, recognizerOptions('CPU'));
    return { recognizer, delegate: 'CPU' };
  }
}

// Runs recognition once per new video frame. Returns a stop function.
export function runDetectionLoop(video, recognizer, onResult, onError) {
  let frameHandle = 0;
  let lastVideoTime = -1;
  let lastTimestamp = 0;

  const loop = () => {
    frameHandle = requestAnimationFrame(loop);
    // The display refreshes faster than the camera; skip frames we've already seen.
    if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;

    // MediaPipe rejects timestamps that don't strictly increase.
    const timestamp = Math.max(performance.now(), lastTimestamp + 1);
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
