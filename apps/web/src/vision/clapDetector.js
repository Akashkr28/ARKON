import { GESTURE } from '../config';

// Palms touching usually makes MediaPipe lose one or both hands, so a clap is
// "two hands closed in fast (or vanished while closing in), then reappeared apart".
// Spread is measured in palm-lengths so it works at any distance from the camera.

function spreadOf([a, b]) {
  const distance = Math.hypot(a.palmScreen.x - b.palmScreen.x, a.palmScreen.y - b.palmScreen.y);
  return distance / ((a.palmSizeScreen + b.palmSizeScreen) / 2);
}

export function createClapDetector() {
  const settings = GESTURE.clap;
  const history = []; // { t, spread } for recent two-hand frames
  let phase = 'open';
  let closedAt = 0;
  let lastTwoHandsMs = -Infinity;
  let lastSpread = Infinity;
  let cooldownUntil = 0;

  function approachedFast(currentSpread) {
    let maxSpread = 0;
    for (const sample of history) maxSpread = Math.max(maxSpread, sample.spread);
    return maxSpread - currentSpread >= settings.minApproach;
  }

  return {
    // Returns true on the frame a clap completes.
    update(hands, nowMs) {
      const twoHands = hands.length === 2;
      const spread = twoHands ? spreadOf(hands) : null;
      if (twoHands) {
        history.push({ t: nowMs, spread });
        lastTwoHandsMs = nowMs;
        lastSpread = spread;
      }
      while (history.length && nowMs - history[0].t > settings.approachWindowMs) history.shift();
      if (nowMs < cooldownUntil) return false;

      if (phase === 'open') {
        const touching = twoHands && spread < settings.closeSpread;
        const vanishedWhileClosing =
          !twoHands && nowMs - lastTwoHandsMs < 250 && lastSpread < settings.closeSpread * 1.8;
        if ((touching || vanishedWhileClosing) && approachedFast(twoHands ? spread : lastSpread)) {
          phase = 'closed';
          closedAt = nowMs;
          history.length = 0;
        }
        return false;
      }

      if (nowMs - closedAt > settings.reopenWindowMs) {
        phase = 'open';
        return false;
      }
      if (twoHands && spread > settings.openSpread) {
        phase = 'open';
        cooldownUntil = nowMs + settings.cooldownMs;
        history.length = 0;
        return true;
      }
      return false;
    },

    reset() {
      history.length = 0;
      phase = 'open';
      lastTwoHandsMs = -Infinity;
      lastSpread = Infinity;
      cooldownUntil = 0;
    },
  };
}
