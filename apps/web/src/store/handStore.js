import { create } from 'zustand';

// Live sensor data, written by the vision pipeline every tracked frame.
// Per-frame readers (scene, debug canvas) use getState(); React components
// that subscribe should throttle (see hud/useThrottledHands.js).
export const useHandStore = create(() => ({
  status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
  error: null,
  delegate: null, // 'GPU' | 'CPU'

  hands: [], // see createHand() in vision/handPipeline.js
  frame: 0,
  trackFps: 0,
  inferenceMs: 0,
  videoSize: [0, 0],

  gestureState: 'IDLE',
  activeHandIds: [], // hands driving the current gesture
  poses: {}, // hand id -> debounced pose (FIST, OPEN, POINT, PINCH, NONE)
  menu: null, // radial menu while open: { x, y, radius, items, highlighted }
  cursors: [], // one per hand, at its pinch point: { id, x, y, pose, pinching, active, hold }
  picker: null, // a dropdown's options as big buttons, opened by an air tap: { x, y, label, options }
  flickSpeed: null, // fingertip speed (palm-lengths/s) while SPINNING, for tuning
}));
