import { TRACKING } from '../config';

// MediaPipe doesn't keep hand order stable between frames, so we match each
// detection to the tracked hand whose wrist was nearest last frame. Each tracked
// hand ("slot") owns its own filter and gesture history.

// Detections are normalised; slot landmarks are already in video pixels.
function wristDistance(detection, slot, videoWidth, videoHeight) {
  const wrist = detection.landmarks[0];
  const previous = slot.hand.landmarks[0];
  return Math.hypot(wrist.x * videoWidth - previous.x, wrist.y * videoHeight - previous.y);
}

export function assignSlots(detections, slots, videoWidth, videoHeight, createSlot) {
  const maxDistance = TRACKING.maxMatchDistance * videoWidth;
  const candidates = [];
  detections.forEach((detection, index) => {
    for (const slot of slots.values()) {
      const distance = wristDistance(detection, slot, videoWidth, videoHeight);
      if (distance < maxDistance) candidates.push({ index, slot, distance });
    }
  });
  candidates.sort((a, b) => a.distance - b.distance);

  const assigned = new Array(detections.length).fill(null);
  const takenSlots = new Set();
  for (const { index, slot } of candidates) {
    if (assigned[index] || takenSlots.has(slot)) continue;
    assigned[index] = slot;
    takenSlots.add(slot);
  }

  return detections.map((detection, index) => {
    const slot = assigned[index] ?? createSlot();
    slots.set(slot.id, slot);
    return [slot, detection];
  });
}

export function pruneSlots(slots, nowMs) {
  for (const [id, slot] of slots) {
    if (nowMs - slot.lastSeenMs > TRACKING.lostHandGraceMs) slots.delete(id);
  }
}
