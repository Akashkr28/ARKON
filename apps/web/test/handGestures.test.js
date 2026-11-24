import { beforeEach, describe, expect, it, vi } from 'vitest';

// The gesture engine driven by made-up hands: no camera, no page, no scene. What's under
// a point and what a tap does are stubbed, so these check the decisions only.
const HUD = { element: { id: 'panel' }, interactive: { id: 'button' } };
let hudAt = () => null;
vi.mock('../src/input/handCursor.js', () => ({
  hudTargetAt: vi.fn((x, y) => hudAt(x, y)),
  clickAt: vi.fn(),
  doubleClickAt: vi.fn(),
  pressHud: vi.fn(),
  scrollHud: vi.fn(),
  slideHud: vi.fn(),
  isSlider: vi.fn(() => false),
  setHandHover: vi.fn(),
}));
vi.mock('../src/actions/handleDrag.js', () => ({
  beginHandleDrag: vi.fn(() => false),
  endHandleDrag: vi.fn(() => false),
  moveHandleDrag: vi.fn(),
}));
vi.mock('../src/actions/commands.js', () => ({ undoHere: vi.fn() }));
vi.mock('../src/scene/picking.js', () => ({ pickPartAt: vi.fn(() => null) }));
vi.mock('../src/actions/viewerActions.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fitToView: vi.fn(),
  selectAll: vi.fn(),
}));

const cursor = await import('../src/input/handCursor.js');
const handleDrag = await import('../src/actions/handleDrag.js');
const viewer = await import('../src/actions/viewerActions.js');
const { createGestureEngine, MENU_ITEMS, STATE } = await import('../src/vision/gestureEngine.js');

function hand(id, { x = 500, y = 400, pinching = false, gesture = 'None' } = {}) {
  const point = () => ({ x, y });
  return {
    id,
    handedness: id === 1 ? 'Right' : 'Left',
    gesture,
    landmarks: Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })),
    screen: Array.from({ length: 21 }, point),
    palmSizeScreen: 100,
    openness: 0.5,
    pinching,
    palmScreen: point(),
    pinchScreen: point(),
    indexTipScreen: point(),
    palmWorld: { x: 0, y: 0, z: 0 },
    pinchWorld: { x: 0, y: 0, z: 0 },
    indexTipWorld: { x: 0, y: 0, z: 0 },
  };
}

let engine;
let now;
// Feeds `frames` camera frames (30 fps) of the same hands; → the last result.
function run(frames, ...hands) {
  let result;
  for (let i = 0; i < frames; i++) {
    now += 33;
    result = engine.update(hands, now, 1000, 800);
  }
  return result;
}
const tap = (x = 500, y = 400, ...others) => {
  run(4, hand(1, { x, y, pinching: true }), ...others); // the pose settles over 4 frames
  return run(1, hand(1, { x, y }), ...others);
};

beforeEach(() => {
  vi.clearAllMocks();
  hudAt = () => null;
  engine = createGestureEngine();
  now = 0;
});

describe('air tap', () => {
  it('a quick pinch clicks the scene where it happened', () => {
    const result = tap(320, 240);
    expect(cursor.clickAt).toHaveBeenCalledExactlyOnceWith(320, 240, { additive: false });
    expect(result.state).toBe(STATE.IDLE);
  });

  it('with the other palm open it adds to the selection, like Shift', () => {
    const palm = hand(2, { x: 100, gesture: 'Open_Palm' });
    run(5, palm);
    tap(320, 240, palm);
    expect(cursor.clickAt).toHaveBeenCalledWith(320, 240, { additive: true });
  });

  it('two taps in a row are a double-click', () => {
    tap();
    run(2, hand(1));
    tap(505, 402);
    expect(cursor.clickAt).toHaveBeenCalledTimes(1);
    expect(cursor.doubleClickAt).toHaveBeenCalledExactlyOnceWith(505, 402);
  });

  it('a slow pinch is not a tap', () => {
    run(4, hand(1, { pinching: true }));
    run(14, hand(1, { pinching: true })); // ~460 ms: past a tap, short of the menu
    run(1, hand(1));
    expect(cursor.clickAt).not.toHaveBeenCalled();
  });

  it('on the HUD it presses the button there', () => {
    hudAt = (x) => (x > 900 ? HUD : null);
    tap(950, 100);
    expect(cursor.pressHud).toHaveBeenCalledExactlyOnceWith(HUD, 950, 100);
    expect(cursor.clickAt).not.toHaveBeenCalled();
  });

  it('pinch-dragging on the HUD scrolls instead of pressing', () => {
    hudAt = () => HUD;
    run(4, hand(1, { x: 950, y: 300, pinching: true }));
    expect(run(1, hand(1, { x: 950, y: 300, pinching: true })).state).toBe(STATE.HUD_PRESS);
    run(1, hand(1, { x: 950, y: 260, pinching: true }));
    run(1, hand(1, { x: 950, y: 220, pinching: true }));
    run(1, hand(1, { x: 950, y: 220 }));
    expect(cursor.scrollHud).toHaveBeenCalledWith(HUD.element, 0, -60);
    expect(cursor.pressHud).not.toHaveBeenCalled();
  });

  it('pointing at the HUD aims; it does not turn the model', () => {
    hudAt = () => HUD;
    const point = { ...hand(1), gesture: 'Pointing_Up' };
    expect(run(6, point).state).toBe(STATE.IDLE);
  });

  it('tapping a design handle (or an assembly part) without moving it clicks', () => {
    handleDrag.beginHandleDrag.mockReturnValueOnce(true);
    run(4, hand(1, { pinching: true }));
    expect(run(1, hand(1, { pinching: true })).state).toBe(STATE.DRAGGING_HANDLE);
    run(1, hand(1));
    expect(handleDrag.endHandleDrag).toHaveBeenCalled();
    expect(cursor.clickAt).toHaveBeenCalledOnce();
  });

  it('every hand has a cursor at its pinch point', () => {
    const result = run(5, hand(1, { x: 10, y: 20 }), hand(2, { x: 30, y: 40, pinching: true }));
    expect(result.cursors.map(({ x, y, pinching }) => [x, y, pinching])).toEqual([
      [10, 20, false],
      [30, 40, true],
    ]);
  });
});

describe('radial menu', () => {
  it('a still pinch opens it; the cursor sweeps round on the way', () => {
    run(4, hand(1, { pinching: true }));
    const halfway = run(9, hand(1, { pinching: true }));
    expect(halfway.state).toBe(STATE.PINCHING);
    expect(halfway.cursors[0].hold).toBeGreaterThan(0.3);
    const open = run(12, hand(1, { pinching: true }));
    expect(open.state).toBe(STATE.MENU);
    expect(open.menu.items).toHaveLength(8);
  });

  it('release toward an item runs it: right is FIT ALL with nothing selected', () => {
    run(25, hand(1, { pinching: true }));
    const menu = run(1, hand(1, { x: 580, pinching: true })).menu;
    expect(menu.highlighted).toBe('fit');
    expect(menu.items.find((item) => item.id === 'fit').label).toBe('FIT ALL');
    run(1, hand(1, { x: 580 }));
    expect(viewer.fitToView).toHaveBeenCalledOnce();
    expect(cursor.clickAt).not.toHaveBeenCalled();
  });

  it('up-right selects everything', () => {
    run(25, hand(1, { pinching: true }));
    run(1, hand(1, { x: 560, y: 340, pinching: true }));
    run(1, hand(1, { x: 560, y: 340 }));
    expect(viewer.selectAll).toHaveBeenCalledOnce();
  });

  it('has eight commands, evenly round the ring', () => {
    expect(MENU_ITEMS.map((item) => item.angle).sort((a, b) => a - b)).toEqual([-135, -90, -45, 0, 45, 90, 135, 180]);
  });
});
