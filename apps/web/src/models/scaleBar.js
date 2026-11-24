import { VIEW } from '../config';
import { LENGTH_UNITS } from '../units';

// 1, 2, 5 × 10ⁿ: the largest such value not above `value`.
export function niceStep(value) {
  if (!(value > 0)) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  const mantissa = value / power;
  return (mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1) * power;
}

// Real metres per screen pixel at a depth from the camera (scene units).
export function metresPerPixel({ depth, scale, metresPerSceneUnit, viewportHeight }) {
  const worldPerPixel = (2 * Math.tan((VIEW.cameraFov * Math.PI) / 360) * depth) / viewportHeight;
  return (worldPerPixel * metresPerSceneUnit) / scale;
}

// A scale bar about `targetPx` long: { metres, pixels, label } in the user's unit.
export function scaleBar(metresPerPx, unit = 'mm', targetPx = 120) {
  const { label, perMetre } = LENGTH_UNITS[unit] ?? LENGTH_UNITS.mm;
  const length = niceStep(metresPerPx * targetPx * perMetre); // in the unit
  const metres = length / perMetre;
  const shown = length >= 1 ? String(Number(length.toPrecision(6))) : String(Number(length.toPrecision(3)));
  return { metres, pixels: metres / metresPerPx, label: `${shown} ${label}` };
}
