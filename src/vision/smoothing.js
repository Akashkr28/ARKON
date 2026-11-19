import { SMOOTHING } from '../config';

// One Euro filter (Casiez et al. 2012): a low-pass filter whose cutoff rises with
// speed, so slow movements are smoothed hard and fast ones stay responsive.

function smoothingFactor(cutoffHz, dt) {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  constructor({ minCutoff, beta, derivativeCutoff } = SMOOTHING) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.reset();
  }

  reset() {
    this.lastTime = null;
    this.lastValue = 0;
    this.lastDerivative = 0;
  }

  filter(value, timeSeconds) {
    if (this.lastTime === null) {
      this.lastTime = timeSeconds;
      this.lastValue = value;
      return value;
    }

    const dt = Math.max(timeSeconds - this.lastTime, 1e-3);
    const rawDerivative = (value - this.lastValue) / dt;
    const derivative =
      this.lastDerivative +
      smoothingFactor(this.derivativeCutoff, dt) * (rawDerivative - this.lastDerivative);

    const cutoff = this.minCutoff + this.beta * Math.abs(derivative);
    const smoothed = this.lastValue + smoothingFactor(cutoff, dt) * (value - this.lastValue);

    this.lastTime = timeSeconds;
    this.lastValue = smoothed;
    this.lastDerivative = derivative;
    return smoothed;
  }
}

const LANDMARK_COUNT = 21;

// Filters all 21 landmarks of one hand. Input is MediaPipe's normalised coords;
// output is written into `out` in video pixels (where the beta value makes sense).
export class LandmarkFilter {
  constructor() {
    this.filters = Array.from({ length: LANDMARK_COUNT * 3 }, () => new OneEuroFilter());
  }

  apply(normalized, videoWidth, videoHeight, timeSeconds, out) {
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const point = normalized[i];
      const target = out[i];
      target.x = this.filters[i * 3].filter(point.x * videoWidth, timeSeconds);
      target.y = this.filters[i * 3 + 1].filter(point.y * videoHeight, timeSeconds);
      // MediaPipe's z uses roughly the same scale as x.
      target.z = this.filters[i * 3 + 2].filter(point.z * videoWidth, timeSeconds);
    }
    return out;
  }
}
