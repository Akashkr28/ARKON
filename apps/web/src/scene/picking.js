import { Raycaster, Vector2 } from 'three';
import { VIEW } from '../config';

// The scene registers a picker; gesture and mouse code ask "which part is under this
// screen point?" with plain numbers and get back a part id, never a three.js object.

let activePicker = null;

// Raycasts ignore clipping, so a section plane's cut-away side would still be
// clickable. A hit counts only if it's visible and on the kept side of every plane.
export function isPickable(hit) {
  if (!hit.object.visible || !hit.object.userData.partId) return false;
  const planes = hit.object.material?.clippingPlanes;
  return !planes?.some((plane) => plane.distanceToPoint(hit.point) < 0);
}

export function registerPicker(picker) {
  activePicker = picker;
  return () => {
    if (activePicker === picker) activePicker = null;
  };
}

export function pickPartAt(ndcX, ndcY) {
  return activePicker ? activePicker(ndcX, ndcY) : null;
}

const raycaster = new Raycaster();
const pointer = new Vector2();
const hits = [];
// Centre first, then a small cross around it, so thin parts are still easy to grab.
const SAMPLE_OFFSETS = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function createPicker(root, camera) {
  return (ndcX, ndcY) => {
    for (const [dx, dy] of SAMPLE_OFFSETS) {
      pointer.set(ndcX + dx * VIEW.pickRadiusNdc, ndcY + dy * VIEW.pickRadiusNdc);
      raycaster.setFromCamera(pointer, camera);
      hits.length = 0;
      raycaster.intersectObject(root, true, hits);
      const hit = hits.find(isPickable);
      if (hit) return hit.object.userData.partId;
    }
    return null;
  };
}
