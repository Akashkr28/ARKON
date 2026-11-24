// Standard views as model rotations [x, y]. The camera never moves (hand tracking
// relies on that), so "look from the top" means "turn the model's top toward us".
// Models face +Z (STEP models are converted so their front, -Y in CAD, does).
export const VIEW_PRESETS = {
  front: { label: 'FRONT', rotation: [0, 0] },
  back: { label: 'BACK', rotation: [0, Math.PI] },
  left: { label: 'LEFT', rotation: [0, Math.PI / 2] },
  right: { label: 'RIGHT', rotation: [0, -Math.PI / 2] },
  top: { label: 'TOP', rotation: [Math.PI / 2, 0] },
  bottom: { label: 'BOTTOM', rotation: [-Math.PI / 2, 0] },
  iso: { label: 'ISO', rotation: [0.35, -0.6] },
};

const TURN = Math.PI * 2;

// The equivalent of `target` (± whole turns) closest to `current`, so switching
// views takes the short way round instead of unwinding earlier spins.
export function nearestAngle(current, target) {
  return target + TURN * Math.round((current - target) / TURN);
}

// Rotate a vector by Euler angles in three.js's default 'XYZ' order (matrix
// Rx·Ry·Rz, so Z is applied first), without needing three.js here.
export function rotateXYZ([x, y, z], [ax, ay, az]) {
  const [sx, cx, sy, cy, sz, cz] = [Math.sin(ax), Math.cos(ax), Math.sin(ay), Math.cos(ay), Math.sin(az), Math.cos(az)];
  // Rz
  let x1 = x * cz - y * sz;
  let y1 = x * sz + y * cz;
  let z1 = z;
  // Ry
  const x2 = x1 * cy + z1 * sy;
  const z2 = -x1 * sy + z1 * cy;
  x1 = x2;
  z1 = z2;
  // Rx
  const y3 = y1 * cx - z1 * sx;
  const z3 = y1 * sx + z1 * cx;
  return [x1, y3, z3];
}

// The inverse of rotateXYZ: undo X, then Y, then Z.
export function unrotateXYZ(vector, [ax, ay, az]) {
  const rx = rotateXYZ(vector, [-ax, 0, 0]);
  const ry = rotateXYZ(rx, [0, -ay, 0]);
  return rotateXYZ(ry, [0, 0, -az]);
}

// Scale that keeps the whole model on screen. Exploding pushes parts up to
// (1 + factor) model radii from the centre.
export function fitScale(explodeFactor) {
  return 1 / (1 + Math.max(0, explodeFactor));
}
