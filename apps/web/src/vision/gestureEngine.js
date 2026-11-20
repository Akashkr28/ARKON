import { GESTURE } from '../config';
import { useViewerStore } from '../store/viewerStore';
import * as actions from '../actions/viewerActions';
import { pickPartAt } from '../scene/picking';
import { POSE, PoseDebouncer, classifyPose } from './handPose';
import { createClapDetector } from './clapDetector';
import { screenToNdc } from './projection';
import { setInteractionActive } from '../actions/history';

// Turns per-frame hands into viewer actions. One explicit state at a time; each
// state decides when it ends. Never touches three.js — only calls viewerActions
// (and asks the scene's picker which part is under a screen point).

export const STATE = {
  IDLE: 'IDLE',
  MOVING: 'MOVING',
  SPINNING: 'SPINNING',
  SCALING: 'SCALING',
  EXPLODING: 'EXPLODING',
  HOLDING_PART: 'HOLDING_PART',
  MENU: 'MENU',
};

const DEG = Math.PI / 180;
const clamp = (v, limit) => Math.max(-limit, Math.min(limit, v));
const screenDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function wrapAngle(angle) {
  if (angle > Math.PI) return angle - 2 * Math.PI;
  if (angle < -Math.PI) return angle + 2 * Math.PI;
  return angle;
}

// Angle of the wrist → middle-knuckle line on screen. Counter-clockwise is positive
// (screen y points down, hence the minus).
function handAngle(hand) {
  const wrist = hand.screen[0];
  const knuckle = hand.screen[9];
  return Math.atan2(-(knuckle.y - wrist.y), knuckle.x - wrist.x);
}

// Distance between two hands' palms, in palm-lengths.
function palmSpread(a, b) {
  return screenDistance(a.palmScreen, b.palmScreen) / ((a.palmSizeScreen + b.palmSizeScreen) / 2);
}

// --- Per-hand motion tracking ----------------------------------------------

function createMotion(hand, nowMs) {
  return {
    debouncer: new PoseDebouncer(),
    lastMs: nowMs,
    lastPalm: { ...hand.palmScreen },
    lastTip: { ...hand.indexTipScreen },
    palmSpeed: 0, // palm-lengths per second
    tipVelocity: { x: 0, y: 0 }, // palm-lengths per second, screen axes
  };
}

function updateMotion(motion, hand, nowMs) {
  const dt = Math.max((nowMs - motion.lastMs) / 1000, 1e-3);
  const palmLength = hand.palmSizeScreen;

  const palmSpeed = screenDistance(hand.palmScreen, motion.lastPalm) / dt / palmLength;
  motion.palmSpeed += (palmSpeed - motion.palmSpeed) * GESTURE.velocitySmoothing;

  const k = GESTURE.flickVelocitySmoothing;
  const tipVx = (hand.indexTipScreen.x - motion.lastTip.x) / dt / palmLength;
  const tipVy = (hand.indexTipScreen.y - motion.lastTip.y) / dt / palmLength;
  motion.tipVelocity.x += (tipVx - motion.tipVelocity.x) * k;
  motion.tipVelocity.y += (tipVy - motion.tipVelocity.y) * k;

  motion.lastMs = nowMs;
  Object.assign(motion.lastPalm, hand.palmScreen);
  Object.assign(motion.lastTip, hand.indexTipScreen);
}

// --- States ----------------------------------------------------------------
// Each state: enter(...) returns its private data; update(data, frame) returns the
// next state as go(name, ...args), or null to stay.

const go = (name, ...args) => ({ name, args });
const findHand = (frame, id) => frame.tracked.find((t) => t.hand.id === id);
const withPose = (frame, pose) => frame.tracked.filter((t) => t.pose === pose);

function partUnderPinch(hand, frame) {
  const ndc = screenToNdc(hand.pinchScreen, frame.screenWidth, frame.screenHeight, {});
  return pickPartAt(ndc.x, ndc.y);
}

const idle = {
  enter: () => ({ scaleArmedSince: null, pinch: null }),

  update(data, frame) {
    const fists = withPose(frame, POSE.FIST);
    const opens = withPose(frame, POSE.OPEN);
    // Also require the live pinch, so the debounce tail after a release can't re-trigger.
    const pinches = withPose(frame, POSE.PINCH).filter((t) => t.hand.pinching);

    if (fists.length === 2) return go(STATE.EXPLODING, 'spread', fists[0].hand, fists[1].hand);

    // Pinch: grab a part if exploded and one is under the fingers, otherwise
    // holding the pinch on empty space opens the menu.
    const pincher = pinches[0];
    if (!pincher) {
      data.pinch = null;
    } else if (data.pinch?.handId !== pincher.hand.id) {
      data.pinch = { handId: pincher.hand.id, since: frame.nowMs };
      if (actions.isExploded()) {
        const partId = partUnderPinch(pincher.hand, frame);
        if (partId) return go(STATE.HOLDING_PART, pincher.hand, partId, frame.nowMs);
      }
    } else if (frame.nowMs - data.pinch.since >= GESTURE.menuHoldMs) {
      return go(STATE.MENU, pincher.hand);
    }

    const bothStill = opens.length === 2 && opens.every((t) => t.motion.palmSpeed < GESTURE.stillMaxSpeed);
    if (bothStill) {
      data.scaleArmedSince ??= frame.nowMs;
      if (frame.nowMs - data.scaleArmedSince >= GESTURE.scaleArmMs) {
        return go(STATE.SCALING, opens[0].hand, opens[1].hand);
      }
    } else if (opens.length < 2) {
      data.scaleArmedSince = null;
    }

    if (fists.length === 1) return go(STATE.MOVING, fists[0].hand);

    const pointer = withPose(frame, POSE.POINT)[0];
    if (pointer) return go(STATE.SPINNING, pointer.hand);

    return null;
  },
};

// Grab: the model follows the fist's movement (relative, so it never jumps to the hand).
// Twisting the fist in place instead hands over to a twist-explode.
const moving = {
  enter(hand) {
    actions.stopSpin();
    const angle = handAngle(hand);
    return {
      handIds: [hand.id],
      startPalm: { ...hand.palmWorld },
      startPalmScreen: { ...hand.palmScreen },
      startPosition: [...useViewerStore.getState().position],
      previousAngle: angle,
      twist: 0,
    };
  },

  update(data, frame) {
    const grabbing = findHand(frame, data.handIds[0]);
    if (!grabbing || grabbing.pose !== POSE.FIST) return go(STATE.IDLE);
    if (withPose(frame, POSE.FIST).length > 1) return go(STATE.IDLE);
    // Opening the hand shifts the palm centre; stop following on the very first
    // un-fisted frame rather than waiting out the debounce.
    if (grabbing.rawPose !== POSE.FIST) return null;

    const { hand } = grabbing;
    const angle = handAngle(hand);
    data.twist += wrapAngle(angle - data.previousAngle);
    data.previousAngle = angle;

    const drift = screenDistance(hand.palmScreen, data.startPalmScreen) / hand.palmSizeScreen;
    if (data.twist > GESTURE.twistDeadzoneDeg * DEG && drift < GESTURE.twistMaxDrift) {
      actions.moveTo(...data.startPosition); // undo the small drift the twist caused
      return go(STATE.EXPLODING, 'twist', hand, data.twist);
    }

    const [x, y, z] = data.startPosition;
    actions.moveTo(
      x + (hand.palmWorld.x - data.startPalm.x) * GESTURE.moveGain,
      y + (hand.palmWorld.y - data.startPalm.y) * GESTURE.moveGain,
      z,
    );
    return null;
  },
};

// Point: the model turns with the fingertip (drag). Flick: one spin impulse that
// keeps going after you stop. Spin decays in viewerActions.tick.
const spinning = {
  enter: (hand) => ({
    handIds: [hand.id],
    armed: true,
    lastTip: { ...hand.indexTipScreen },
    speed: 0,
  }),

  update(data, frame) {
    const pointer = findHand(frame, data.handIds[0]);
    if (!pointer || pointer.pose !== POSE.POINT) return go(STATE.IDLE);

    const { hand } = pointer;
    if (pointer.rawPose === POSE.POINT) {
      const dx = (hand.indexTipScreen.x - data.lastTip.x) / hand.palmSizeScreen;
      const dy = (hand.indexTipScreen.y - data.lastTip.y) / hand.palmSizeScreen;
      actions.rotateBy(dy * GESTURE.pointDragGain, dx * GESTURE.pointDragGain);
    }
    Object.assign(data.lastTip, hand.indexTipScreen);

    const { x, y } = pointer.motion.tipVelocity;
    const speed = Math.hypot(x, y);
    data.speed = speed;
    if (data.armed && speed > GESTURE.flickMinSpeed) {
      // Horizontal flick turns the model around its vertical axis; vertical flick tilts it.
      actions.spin(
        clamp(y * GESTURE.flickSpinGain, GESTURE.maxSpinSpeed),
        clamp(x * GESTURE.flickSpinGain, GESTURE.maxSpinSpeed),
      );
      data.armed = false;
    } else if (!data.armed && speed < GESTURE.flickRearmSpeed) {
      data.armed = true;
    }
    return null;
  },
};

// Two open palms: scale follows the ratio of the current to the starting hand spread.
const scaling = {
  enter(handA, handB) {
    return {
      handIds: [handA.id, handB.id],
      startSpread: Math.max(screenDistance(handA.palmScreen, handB.palmScreen), 1),
      startScale: useViewerStore.getState().scale,
    };
  },

  update(data, frame) {
    const a = findHand(frame, data.handIds[0]);
    const b = findHand(frame, data.handIds[1]);
    if (!a || !b || a.pose !== POSE.OPEN || b.pose !== POSE.OPEN) return go(STATE.IDLE);

    const spread = screenDistance(a.hand.palmScreen, b.hand.palmScreen);
    actions.scaleTo(data.startScale * (spread / data.startSpread));
    return null;
  },

  // A clap starts like a scale gesture; undo any scaling it caused.
  onClap(data) {
    actions.scaleTo(data.startScale);
  },
};

// Two variants: 'spread' (two fists pulled apart) and 'twist' (one fist rotated CCW).
// Either way the explode factor is relative to where it was when the gesture began.
const exploding = {
  enter(variant, handA, handBOrTwist) {
    const startFactor = useViewerStore.getState().explodeTarget;
    if (variant === 'spread') {
      return {
        variant,
        handIds: [handA.id, handBOrTwist.id],
        startFactor,
        startSpread: palmSpread(handA, handBOrTwist),
      };
    }
    return {
      variant,
      handIds: [handA.id],
      startFactor,
      startTwist: handBOrTwist,
      twist: handBOrTwist,
      previousAngle: handAngle(handA),
    };
  },

  update(data, frame) {
    const hands = data.handIds.map((id) => findHand(frame, id));
    if (hands.some((t) => !t || t.pose !== POSE.FIST)) return go(STATE.IDLE);
    if (hands.some((t) => t.rawPose !== POSE.FIST)) return null; // releasing; hold still

    if (data.variant === 'spread') {
      const spread = palmSpread(hands[0].hand, hands[1].hand);
      actions.explode(data.startFactor + (spread - data.startSpread) * GESTURE.explodePerPalm);
    } else {
      const angle = handAngle(hands[0].hand);
      data.twist += wrapAngle(angle - data.previousAngle);
      data.previousAngle = angle;
      // Counter-clockwise explodes further, clockwise winds it back.
      const extra = (data.twist - data.startTwist) / (GESTURE.twistFullExplodeDeg * DEG);
      actions.explode(data.startFactor + 0.15 + extra);
    }
    return null;
  },
};

// A pinched part follows the pinch point; after a moment its info card appears.
const holdingPart = {
  enter(hand, partId, nowMs) {
    actions.selectPart(partId);
    return {
      handIds: [hand.id],
      partId,
      startPinch: { ...hand.pinchWorld },
      since: nowMs,
      infoShown: false,
    };
  },

  update(data, frame) {
    const holder = findHand(frame, data.handIds[0]);
    // Release on the raw (hysteresis) pinch, not the debounced pose, so letting go feels instant.
    if (!holder || !holder.hand.pinching) {
      actions.releasePart();
      return go(STATE.IDLE);
    }

    const { pinchWorld } = holder.hand;
    actions.pullPart(pinchWorld.x - data.startPinch.x, pinchWorld.y - data.startPinch.y, 0);

    if (!data.infoShown && frame.nowMs - data.since >= GESTURE.partInfoHoldMs) {
      actions.showPartInfo(data.partId);
      data.infoShown = true;
    }
    return null;
  },
};

// Radial menu around the pinch point: move the pinch toward an item, release to run it.
const MENU_ITEMS = [
  { id: 'explode', angle: -90, label: () => (actions.isExploded() ? 'ASSEMBLE' : 'EXPLODE') },
  { id: 'reset', angle: 0, label: () => 'RESET' },
  { id: 'material', angle: 90, label: () => 'MATERIAL' },
  { id: 'spawn', angle: 180, label: () => 'SPAWN HERE' },
];

function runMenuItem(id, data) {
  if (id === 'explode') actions.toggleExplode();
  if (id === 'reset') actions.resetModel();
  if (id === 'material') actions.toggleMaterialMode();
  if (id === 'spawn') actions.spawnAt(data.centerWorld.x, data.centerWorld.y, data.centerWorld.z);
}

function highlightedItem(center, point) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (Math.hypot(dx, dy) < GESTURE.menuSelectMinPx) return null;
  const angle = Math.atan2(dy, dx) / DEG;
  const nearest = MENU_ITEMS.find((item) => Math.abs(wrapAngle((angle - item.angle) * DEG)) <= 45 * DEG);
  return nearest?.id ?? null;
}

const menu = {
  enter(hand) {
    const center = { ...hand.pinchScreen };
    return {
      handIds: [hand.id],
      centerWorld: { ...hand.pinchWorld },
      menu: {
        x: center.x,
        y: center.y,
        radius: GESTURE.menuRadiusPx,
        items: MENU_ITEMS.map((item) => ({ id: item.id, angle: item.angle, label: item.label() })),
        highlighted: null,
      },
    };
  },

  update(data, frame) {
    const holder = findHand(frame, data.handIds[0]);
    if (!holder || !holder.hand.pinching) {
      if (holder && data.menu.highlighted) runMenuItem(data.menu.highlighted, data);
      return go(STATE.IDLE);
    }
    const highlighted = highlightedItem(data.menu, holder.hand.pinchScreen);
    // New object only when the highlight changes, so the HUD re-renders only then.
    if (highlighted !== data.menu.highlighted) data.menu = { ...data.menu, highlighted };
    return null;
  },
};

const STATES = {
  [STATE.IDLE]: idle,
  [STATE.MOVING]: moving,
  [STATE.SPINNING]: spinning,
  [STATE.SCALING]: scaling,
  [STATE.EXPLODING]: exploding,
  [STATE.HOLDING_PART]: holdingPart,
  [STATE.MENU]: menu,
};

// Clap is checked alongside the state machine, except while the hands are busy.
const CLAP_BLOCKED = new Set([STATE.HOLDING_PART, STATE.MENU]);

// --- Engine ----------------------------------------------------------------

export function createGestureEngine() {
  const motions = new Map(); // hand id -> motion
  const clap = createClapDetector();
  let state = STATE.IDLE;
  let data = idle.enter();

  function trackHands(hands, nowMs) {
    const seen = new Set();
    const tracked = hands.map((hand) => {
      seen.add(hand.id);
      let motion = motions.get(hand.id);
      if (!motion) {
        motion = createMotion(hand, nowMs);
        motions.set(hand.id, motion);
      } else {
        updateMotion(motion, hand, nowMs);
      }
      const rawPose = classifyPose(hand);
      return { hand, motion, rawPose, pose: motion.debouncer.update(rawPose) };
    });
    for (const id of motions.keys()) if (!seen.has(id)) motions.delete(id);
    return tracked;
  }

  function transition(next) {
    state = next.name;
    data = STATES[state].enter(...next.args);
    // A whole gesture (grab → move → release) becomes one undo step.
    setInteractionActive('gesture', state !== STATE.IDLE);
  }

  function handleClap(hands, nowMs) {
    const clapped = clap.update(hands, nowMs);
    if (!clapped || CLAP_BLOCKED.has(state)) return false;
    STATES[state].onClap?.(data);
    actions.assemble();
    transition(go(STATE.IDLE));
    return true;
  }

  return {
    update(hands, nowMs, screenWidth, screenHeight) {
      const frame = { tracked: trackHands(hands, nowMs), nowMs, screenWidth, screenHeight };
      if (!handleClap(hands, nowMs)) {
        const next = STATES[state].update(data, frame);
        if (next) transition(next);
      }
      return {
        state,
        activeHandIds: data.handIds ?? [],
        poses: Object.fromEntries(frame.tracked.map((t) => [t.hand.id, t.pose])),
        menu: state === STATE.MENU ? data.menu : null,
        flickSpeed: state === STATE.SPINNING ? data.speed : null,
      };
    },

    reset() {
      motions.clear();
      clap.reset();
      state = STATE.IDLE;
      data = idle.enter();
      setInteractionActive('gesture', false);
    },
  };
}
