import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Plane, Vector3 } from 'three';
import { useViewerStore } from '../src/store/viewerStore.js';
import * as actions from '../src/actions/viewerActions.js';
import { startHistory, useHistoryStore } from '../src/actions/history.js';
import { NO_SECTION, sectionPlane, sectionPosition } from '../src/scene/sectionPlane.js';
import { isPickable } from '../src/scene/picking.js';

const BOUNDS = { min: [-0.36, 0, -0.2], max: [0.36, 1.78, 0.19] }; // the exosuit, metres
const state = () => useViewerStore.getState();

// Is a model-space point kept (not cut away) by this section?
function kept(section, point) {
  const { normal, constant } = sectionPlane(section, BOUNDS);
  return new Plane(new Vector3(...normal), constant).distanceToPoint(new Vector3(...point)) >= 0;
}

describe('section plane maths', () => {
  it('places the plane across the model bounds', () => {
    expect(sectionPosition({ axis: 'y', offset: 0 }, BOUNDS)).toBeCloseTo(0);
    expect(sectionPosition({ axis: 'y', offset: 0.5 }, BOUNDS)).toBeCloseTo(0.89);
    expect(sectionPosition({ axis: 'x', offset: 1 }, BOUNDS)).toBeCloseTo(0.36);
  });

  it('cuts away the far side, or the near side when flipped', () => {
    const waist = { axis: 'y', offset: 0.5, flip: false };
    expect(kept(waist, [0, 0.2, 0])).toBe(true); // legs stay
    expect(kept(waist, [0, 1.6, 0])).toBe(false); // head is cut away
    expect(kept({ ...waist, flip: true }, [0, 1.6, 0])).toBe(true);
    expect(kept({ ...waist, flip: true }, [0, 0.2, 0])).toBe(false);
  });

  it('has no plane when off or before the model is measured', () => {
    expect(sectionPlane(NO_SECTION, BOUNDS)).toBeNull();
    expect(sectionPlane({ axis: 'x', offset: 0.5 }, null)).toBeNull();
  });
});

describe('section actions', () => {
  beforeEach(() => {
    useViewerStore.setState({ section: NO_SECTION, showSectionPlane: true, modelBounds: BOUNDS });
  });

  it('S cycles off → X → Y → Z → off', () => {
    const axes = [];
    for (let i = 0; i < 4; i++) {
      actions.cycleSection();
      axes.push(state().section.axis);
    }
    expect(axes).toEqual(['x', 'y', 'z', null]);
  });

  it('clamps the offset and flips', () => {
    actions.setSectionAxis('z');
    actions.setSectionOffset(1.7);
    expect(state().section.offset).toBe(1);
    actions.setSectionOffset(-1);
    expect(state().section.offset).toBe(0);
    actions.flipSection();
    expect(state().section.flip).toBe(true);
    actions.setSectionAxis('w');
    expect(state().section.axis).toBe('z');
  });

  describe('undo', () => {
    let stop;
    beforeEach(() => {
      vi.useFakeTimers();
      stop = startHistory();
    });
    afterEach(() => {
      stop();
      vi.useRealTimers();
    });

    it('turning a section on and dragging its slider are named steps', () => {
      actions.setSectionAxis('y');
      vi.advanceTimersByTime(500);
      expect(useHistoryStore.getState().undoLabel).toBe('Section Y');
      for (const offset of [0.45, 0.4, 0.35, 0.3]) actions.setSectionOffset(offset); // one slider drag
      vi.advanceTimersByTime(500);
      expect(actions.undo()).toBe('Move section');
      expect(state().section.offset).toBe(0.5);
      expect(actions.undo()).toBe('Section Y');
      expect(state().section.axis).toBeNull();
    });

    it('showing or hiding the plane outline is not an undo step', () => {
      actions.toggleSectionPlane();
      vi.advanceTimersByTime(500);
      expect(state().showSectionPlane).toBe(false);
      expect(useHistoryStore.getState().undoLabel).toBeNull();
    });
  });
});

describe('picking a sectioned model', () => {
  const cutAboveWaist = new Plane(new Vector3(0, -1, 0), 0.89); // keeps y ≤ 0.89
  const hitAt = (y, extras = {}) => ({
    object: { visible: true, userData: { partId: 'part-0' }, material: { clippingPlanes: [cutAboveWaist] }, ...extras },
    point: new Vector3(0, y, 0),
  });

  it('ignores hits on the cut-away side', () => {
    expect(isPickable(hitAt(0.3))).toBe(true);
    expect(isPickable(hitAt(1.5))).toBe(false);
  });

  it('still ignores hidden meshes and non-parts', () => {
    expect(isPickable(hitAt(0.3, { visible: false }))).toBe(false);
    expect(isPickable(hitAt(0.3, { userData: {} }))).toBe(false);
  });
});
