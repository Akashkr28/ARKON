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

// Scale that keeps the whole model on screen. Exploding pushes parts up to
// (1 + factor) model radii from the centre.
export function fitScale(explodeFactor) {
  return 1 / (1 + Math.max(0, explodeFactor));
}
