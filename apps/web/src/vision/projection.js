import { VIEW } from '../config';

// Maps between video pixels, screen pixels and the 3D scene, with plain math so the
// vision code never needs three.js.

// The <video> uses object-fit: cover, so the frame is scaled up and cropped to fill
// the screen. This captures that transform (plus mirroring) for one frame.
export function createViewportMapping(videoWidth, videoHeight, screenWidth, screenHeight, mirror) {
  const scale = Math.max(screenWidth / videoWidth, screenHeight / videoHeight);
  return {
    scale,
    offsetX: (screenWidth - videoWidth * scale) / 2,
    offsetY: (screenHeight - videoHeight * scale) / 2,
    screenWidth,
    screenHeight,
    mirror,
  };
}

export function videoToScreen(point, mapping, out) {
  const x = mapping.offsetX + point.x * mapping.scale;
  out.x = mapping.mirror ? mapping.screenWidth - x : x;
  out.y = mapping.offsetY + point.y * mapping.scale;
  return out;
}

// Where a screen point lands on the plane z = planeZ, as seen by the scene camera
// (which sits at z = VIEW.cameraZ looking down -z).
export function screenToPlane(point, screenWidth, screenHeight, planeZ, out) {
  const ndcX = (point.x / screenWidth) * 2 - 1;
  const ndcY = 1 - (point.y / screenHeight) * 2;
  const depth = VIEW.cameraZ - planeZ;
  const halfHeight = Math.tan((VIEW.cameraFov * Math.PI) / 360) * depth;
  out.x = ndcX * halfHeight * (screenWidth / screenHeight);
  out.y = ndcY * halfHeight;
  out.z = planeZ;
  return out;
}

export function screenToNdc(point, screenWidth, screenHeight, out) {
  out.x = (point.x / screenWidth) * 2 - 1;
  out.y = 1 - (point.y / screenHeight) * 2;
  return out;
}
