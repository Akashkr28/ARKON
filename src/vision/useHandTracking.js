import { useEffect } from 'react';
import { useHandStore } from '../store/handStore';
import { createGestureRecognizer, runDetectionLoop } from './handTracker';
import { processResult, resetPipeline } from './handPipeline';

function describeTrackerError(error) {
  const message = error?.message ?? String(error);
  if (/fetch|network|load|404/i.test(message)) {
    return `Couldn't download the hand-tracking model (needs internet access to cdn.jsdelivr.net and storage.googleapis.com). ${message}`;
  }
  return message;
}

export function useHandTracking(videoRef, enabled) {
  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let recognizer = null;
    let stopLoop = null;

    const fail = (error) => {
      if (!cancelled) {
        useHandStore.setState({ status: 'error', error: describeTrackerError(error) });
      }
    };

    useHandStore.setState({ status: 'loading', error: null });
    createGestureRecognizer()
      .then(({ recognizer: created, delegate }) => {
        if (cancelled) return created.close();
        recognizer = created;
        useHandStore.setState({ status: 'ready', delegate });
        stopLoop = runDetectionLoop(videoRef.current, created, (result, inferenceMs, now) =>
          processResult(result, videoRef.current, inferenceMs, now), fail);
      })
      .catch(fail);

    return () => {
      cancelled = true;
      stopLoop?.();
      recognizer?.close();
      resetPipeline();
      useHandStore.setState({ status: 'idle' });
    };
  }, [videoRef, enabled]);
}
