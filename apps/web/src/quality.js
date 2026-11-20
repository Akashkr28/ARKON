import { PERFORMANCE, QUALITY_LEVELS, QUALITY_PRESETS } from './config';

const STORAGE_KEY = 'holocad.quality';

export function isMobileDevice({ userAgent = '', maxTouchPoints = 0 }) {
  // iPadOS reports itself as a Mac; touch points give it away.
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

// deviceMemory is Chromium-only; assume a typical laptop when it's missing.
export function pickAutoLevel(device) {
  if (isMobileDevice(device)) return 'low';
  const { hardwareConcurrency: cores = 8, deviceMemory: memoryGb = 8 } = device;
  if (cores <= 4 || memoryGb <= 4) return 'low';
  if (cores >= 8 && memoryGb >= 8) return 'high';
  return 'medium';
}

// Priority: ?quality= in the URL, then the saved choice, then AUTO.
export function resolveQuality({ search = '', stored = null, device = {} }) {
  const fromUrl = new URLSearchParams(search).get('quality');
  for (const choice of [fromUrl, stored]) {
    if (QUALITY_LEVELS.includes(choice)) return { level: choice, auto: false };
  }
  return { level: pickAutoLevel(device), auto: true };
}

export function nextLowerLevel(level) {
  return QUALITY_LEVELS[QUALITY_LEVELS.indexOf(level) + 1] ?? null;
}

// Fires once when the smoothed frame rate stays under minFps for `slowForSeconds`.
export class SlowFrameDetector {
  constructor({ minFps = PERFORMANCE.minFps, slowForSeconds = PERFORMANCE.slowForSeconds } = {}) {
    this.minFps = minFps;
    this.slowForSeconds = slowForSeconds;
    this.averageDt = 1 / 60;
    this.slowFor = 0;
    this.fired = false;
  }

  // dt in seconds; returns true on the one frame it decides things are too slow.
  update(dt) {
    if (this.fired || !(dt > 0)) return false;
    // Clamp so a single hitch (tab switch, GC) can't trip it on its own.
    this.averageDt += (Math.min(dt, 0.25) - this.averageDt) * 0.1;
    this.slowFor = 1 / this.averageDt < this.minFps ? this.slowFor + dt : 0;
    if (this.slowFor < this.slowForSeconds) return false;
    this.fired = true;
    return true;
  }
}

function readStoredLevel() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode or storage disabled
  }
}

function currentDevice() {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
  };
}

// Decided once at startup; everything else reads `quality` and `preset`.
export const quality =
  typeof window === 'undefined'
    ? { level: 'medium', auto: true }
    : resolveQuality({ search: location.search, stored: readStoredLevel(), device: currentDevice() });
export const preset = QUALITY_PRESETS[quality.level];

// 'auto' or a level. Saves the choice and reloads, since the camera, renderer and
// tracker are all created with these settings.
export function changeQuality(choice) {
  try {
    if (choice === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Can't persist: fall through to the URL parameter, which works without storage.
  }
  const url = new URL(location.href);
  if (choice === 'auto') url.searchParams.delete('quality');
  else url.searchParams.set('quality', choice);
  location.href = url.href;
}
