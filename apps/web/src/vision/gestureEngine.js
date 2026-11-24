import { GESTURE } from '../config';
import { useViewerStore } from '../store/viewerStore';
import * as actions from '../actions/viewerActions';
import { pickPartAt } from '../scene/picking';
import { POSE, PoseDebouncer, classifyPose } from './handPose';
import { createClapDetector } from './clapDetector';
import { screenToNdc } from './projection';
import { setInteractionActive } from '../actions/history';
import { beginHandleDrag, endHandleDrag, moveHandleDrag } from '../actions/handleDrag';
import { undoHere } from '../actions/commands';
import {
  clickAt,
  doubleClickAt,
  hudTargetAt,
  isSlider,
  pressHud,
  scrollHud,
  setHandHover,
  slideHud,
} from '../input/handCursor';

// Turns per-frame hands into viewer actions. One explicit state at a time; each
// state decides when it ends. Never touches three.js — only calls viewerActions
// (and asks the scene's picker which part is under a screen point).
//
// Every hand is also a cursor at its pinch point. A quick pinch is an air tap: on the
// HUD it presses what's there (input/handCursor.js), on the scene it's a mouse click,
// so anything you can click you can tap. Tapping twice fast is a double-click; tapping
// with the other palm open adds to the selection, like Shift.

export const STATE = {
  IDLE: 'IDLE',
  MOVING: 'MOVING',
  SPINNING: 'SPINNING',
  SCALING: 'SCALING',
  EXPLODING: 'EXPLODING',
  HOLDING_PART: 'HOLDING_PART',
  DRAGGING_HANDLE: 'DRAGGING_HANDLE',
  MENU: 'MENU',
  PINCHING: 'PINCHING', // pinched over the scene: a tap, a hold (menu) or a pull?
  HUD_PRESS: 'HUD_PRESS', // pinched over the HUD: a tap presses, a drag scrolls or slides
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

// --- Taps ----------------------------------------------------------------------------

const isTap = (data, nowMs) => !data.moved && nowMs - data.since <= GESTURE.tapMaxMs;
const movedFar = (hand, start) => screenDistance(hand.pinchScreen, start) > GESTURE.tapMaxMove * hand.palmSizeScreen;

// An air tap on the scene at a screen point. The other hand held open makes it additive.
// frame.taps.last remembers the previous tap ({ x, y, ms }) for double taps.
function tapScene(point, frame, handId) {
  const { last } = frame.taps;
  const double =
    last && frame.nowMs - last.ms <= GESTURE.doubleTapMs && screenDistance(point, last) <= GESTURE.doubleTapPx;
  frame.taps.last = double ? null : { x: point.x, y: point.y, ms: frame.nowMs };
  if (double) {
    doubleClickAt(point.x, point.y);
    return;
  }
  const additive = frame.tracked.some((t) => t.hand.id !== handId && t.pose === POSE.OPEN);
  clickAt(point.x, point.y, { additive });
}

const overHud = (point) => hudTargetAt(point.x, point.y);

const idle = {
  enter: () => ({ scaleArmedSince: null }),

  update(data, frame) {
    const fists = withPose(frame, POSE.FIST);
    const opens = withPose(frame, POSE.OPEN);
    // Also require the live pinch, so the debounce tail after a release can't re-trigger.
    const pinches = withPose(frame, POSE.PINCH).filter((t) => t.hand.pinching);

    if (fists.length === 2) return go(STATE.EXPLODING, 'spread', fists[0].hand, fists[1].hand);

    // A pinch starts as whatever is under it: the HUD, a design handle (or, in
    // ASSEMBLE, a part to drag), or the scene.
    const pincher = pinches[0];
    if (pincher) {
      const { hand } = pincher;
      const hud = overHud(hand.pinchScreen);
      if (hud) return go(STATE.HUD_PRESS, hand, hud, frame.nowMs);
      if (beginHandleDrag(hand.pinchScreen.x, hand.pinchScreen.y)) return go(STATE.DRAGGING_HANDLE, hand, frame.nowMs);
      const partId = actions.isExploded() ? partUnderPinch(hand, frame) : null;
      return go(STATE.PINCHING, hand, frame.nowMs, partId);
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

    // Pointing at the HUD is aiming, not turning the model.
    const pointer = withPose(frame, POSE.POINT)[0];
    if (pointer && !overHud(pointer.hand.indexTipScreen)) return go(STATE.SPINNING, pointer.hand);

    return null;
  },
};

// Pinched over the scene. Let go quickly: a tap (click). Hold still: the radial menu,
// or, on a part of an exploded model, pick it up. Move: pull that part out.
const pinching = {
  enter(hand, nowMs, partId) {
    return {
      handIds: [hand.id],
      start: { ...hand.pinchScreen },
      startWorld: { ...hand.pinchWorld },
      since: nowMs,
      partId,
      moved: false,
      hold: 0,
    };
  },

  update(data, frame) {
    const holder = findHand(frame, data.handIds[0]);
    if (!holder || !holder.hand.pinching) {
      if (holder && isTap(data, frame.nowMs)) tapScene(data.start, frame, holder.hand.id);
      return go(STATE.IDLE);
    }
    const { hand } = holder;
    const elapsed = frame.nowMs - data.since;
    if (!data.moved && movedFar(hand, data.start)) data.moved = true;
    if (data.partId && (data.moved || elapsed >= GESTURE.menuHoldMs)) {
      return go(STATE.HOLDING_PART, hand, data.partId, data.since, data.startWorld);
    }
    data.hold = data.moved ? 0 : Math.min(1, elapsed / GESTURE.menuHoldMs);
    if (!data.moved && elapsed >= GESTURE.menuHoldMs) return go(STATE.MENU, hand, data.start, data.startWorld);
    return null; // moved over empty space: nothing until it opens
  },
};

// Pinched over the HUD. Let go without moving: press it (any length of press counts).
// Drag: a slider follows the hand; anything else scrolls its panel.
const hudPress = {
  enter(hand, target, nowMs) {
    const slider = isSlider(target.interactive);
    if (slider) slideHud(target.interactive, hand.pinchScreen.x);
    return {
      handIds: [hand.id],
      target,
      start: { ...hand.pinchScreen },
      last: { ...hand.pinchScreen },
      since: nowMs,
      mode: slider ? 'slide' : null,
    };
  },

  update(data, frame) {
    const holder = findHand(frame, data.handIds[0]);
    if (!holder || !holder.hand.pinching) {
      if (holder && !data.mode) pressHud(data.target, data.start.x, data.start.y);
      return go(STATE.IDLE);
    }
    const { hand } = holder;
    if (!data.mode && movedFar(hand, data.start)) data.mode = 'scroll';
    if (data.mode === 'slide') slideHud(data.target.interactive, hand.pinchScreen.x);
    if (data.mode === 'scroll') {
      const dx = (hand.pinchScreen.x - data.last.x) * GESTURE.scrollGain;
      scrollHud(data.target.element, dx, (hand.pinchScreen.y - data.last.y) * GESTURE.scrollGain);
    }
    Object.assign(data.last, hand.pinchScreen);
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
    if (overHud(hand.indexTipScreen)) {
      Object.assign(data.lastTip, hand.indexTipScreen); // aiming at a button; hold still
      return null;
    }
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
  enter(hand, partId, nowMs, startPinch = hand.pinchWorld) {
    actions.selectPart(partId);
    return {
      handIds: [hand.id],
      partId,
      startPinch: { ...startPinch },
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

// A pinched design handle (in ASSEMBLE, a part) follows the pinch until it opens; one
// undo step. A quick tap that moved nothing is a click: it selects that part.
const draggingHandle = {
  enter(hand, nowMs) {
    return { handIds: [hand.id], start: { ...hand.pinchScreen }, since: nowMs, moved: false };
  },

  update(data, frame) {
    const holder = findHand(frame, data.handIds[0]);
    if (!holder || !holder.hand.pinching) {
      const changed = endHandleDrag();
      if (holder && !changed && isTap(data, frame.nowMs)) tapScene(data.start, frame, holder.hand.id);
      return go(STATE.IDLE);
    }
    if (!data.moved && movedFar(holder.hand, data.start)) data.moved = true;
    moveHandleDrag(holder.hand.pinchScreen.x, holder.hand.pinchScreen.y);
    return null;
  },
};

// Radial menu around the pinch point: move the pinch toward an item, release to run it.
// Items read the moment: with parts selected they act on them, otherwise on everything.
const hasSelection = () => useViewerStore.getState().selectedPartIds.length > 0;

export const MENU_ITEMS = [
  {
    id: 'explode',
    angle: -90,
    label: () => (actions.isExploded() ? 'ASSEMBLE' : 'EXPLODE'),
    run: () => actions.toggleExplode(),
  },
  {
    id: 'select',
    angle: -45,
    label: () => (hasSelection() ? 'DESELECT' : 'SELECT ALL'),
    run: () => (hasSelection() ? actions.clearSelection() : actions.selectAll()),
  },
  {
    id: 'fit',
    angle: 0,
    label: () => (hasSelection() ? 'FIT SELECTION' : 'FIT ALL'),
    run: () => (hasSelection() ? actions.fitToSelection() : actions.fitToView()),
  },
  {
    id: 'isolate',
    angle: 45,
    label: () => (hasSelection() ? 'ISOLATE' : 'SHOW ALL'),
    run: () => (hasSelection() ? actions.isolateParts() : actions.showAllParts()),
  },
  { id: 'material', angle: 90, label: () => 'MATERIAL', run: () => actions.toggleMaterialMode() },
  {
    id: 'hide',
    angle: 135,
    label: () => (hasSelection() ? 'HIDE' : 'SPAWN HERE'),
    run: (data) =>
      hasSelection()
        ? actions.hideParts()
        : actions.spawnAt(data.centerWorld.x, data.centerWorld.y, data.centerWorld.z),
  },
  { id: 'undo', angle: 180, label: () => 'UNDO', run: () => undoHere() },
  { id: 'reset', angle: -135, label: () => 'RESET', run: () => actions.resetModel() },
];

function runMenuItem(id, data) {
  MENU_ITEMS.find((item) => item.id === id)?.run(data);
}

function highlightedItem(center, point) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (Math.hypot(dx, dy) < GESTURE.menuSelectMinPx) return null;
  const angle = Math.atan2(dy, dx) / DEG;
  const half = 180 / MENU_ITEMS.length;
  const nearest = MENU_ITEMS.find((item) => Math.abs(wrapAngle((angle - item.angle) * DEG)) <= half * DEG);
  return nearest?.id ?? null;
}

const menu = {
  enter(hand, center = hand.pinchScreen, centerWorld = hand.pinchWorld) {
    return {
      handIds: [hand.id],
      centerWorld: { ...centerWorld },
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
  [STATE.DRAGGING_HANDLE]: draggingHandle,
  [STATE.MENU]: menu,
  [STATE.PINCHING]: pinching,
  [STATE.HUD_PRESS]: hudPress,
};

// Clap is checked alongside the state machine, except while the hands are busy.
const CLAP_BLOCKED = new Set([STATE.HOLDING_PART, STATE.DRAGGING_HANDLE, STATE.MENU, STATE.PINCHING, STATE.HUD_PRESS]);

// --- Engine ----------------------------------------------------------------

export function createGestureEngine() {
  const motions = new Map(); // hand id -> motion
  const clap = createClapDetector();
  const taps = { last: null };
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
      const frame = { tracked: trackHands(hands, nowMs), nowMs, screenWidth, screenHeight, taps };
      if (!handleClap(hands, nowMs)) {
        const next = STATES[state].update(data, frame);
        if (next) transition(next);
      }
      // Outline what a tap would press, under the hand in control (or the first free one).
      const aiming =
        (data.handIds && findHand(frame, data.handIds[0])) ??
        frame.tracked.find((t) => t.pose !== POSE.FIST && t.pose !== POSE.OPEN);
      const canAim = state === STATE.IDLE || state === STATE.PINCHING || state === STATE.HUD_PRESS;
      if (canAim && aiming) setHandHover(aiming.hand.pinchScreen.x, aiming.hand.pinchScreen.y);
      else setHandHover(null);
      return {
        state,
        cursors: frame.tracked.map((t) => ({
          id: t.hand.id,
          x: t.hand.pinchScreen.x,
          y: t.hand.pinchScreen.y,
          handedness: t.hand.handedness,
          pose: t.pose,
          pinching: t.hand.pinching,
          active: (data.handIds ?? []).includes(t.hand.id),
          // How far a held pinch is toward opening the menu, 0..1.
          hold: state === STATE.PINCHING && data.handIds[0] === t.hand.id ? data.hold : 0,
        })),
        activeHandIds: data.handIds ?? [],
        poses: Object.fromEntries(frame.tracked.map((t) => [t.hand.id, t.pose])),
        menu: state === STATE.MENU ? data.menu : null,
        flickSpeed: state === STATE.SPINNING ? data.speed : null,
      };
    },

    reset() {
      motions.clear();
      clap.reset();
      taps.last = null;
      setHandHover(null);
      state = STATE.IDLE;
      data = idle.enter();
      setInteractionActive('gesture', false);
    },
  };
}
