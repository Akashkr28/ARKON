import { beforeEach, describe, expect, it } from 'vitest';
import { useViewerStore } from '../src/store/viewerStore.js';
import * as actions from '../src/actions/viewerActions.js';
import { fitScale, nearestAngle } from '../src/scene/viewPresets.js';
import { formatLength, formatSize } from '../src/units.js';

const state = () => useViewerStore.getState();

beforeEach(() => {
  actions.resetModel();
});

describe('formatLength', () => {
  it('shows metres in the chosen unit, trimming decimals on big numbers', () => {
    expect(formatLength(1.78)).toBe('1780 mm');
    expect(formatLength(0.0125)).toBe('12.5 mm');
    expect(formatLength(0.0125, 'cm')).toBe('1.25 cm');
    expect(formatLength(0.0254, 'in')).toBe('1.00 in');
    expect(formatLength(null)).toBe('—');
    expect(formatLength(0.13289, 'mm', { precise: true })).toBe('132.9 mm'); // measurements
  });

  it('formats a bounding box', () => {
    expect(formatSize([0.72, 1.78, 0.388])).toBe('720 × 1780 × 388 mm');
  });
});

describe('nearestAngle', () => {
  it('takes the short way round', () => {
    expect(nearestAngle(0.1, 0)).toBe(0);
    expect(nearestAngle(2 * Math.PI + 0.2, 0)).toBeCloseTo(2 * Math.PI);
    expect(nearestAngle(-3 * Math.PI, Math.PI)).toBeCloseTo(-3 * Math.PI);
  });
});

describe('setView', () => {
  it('turns the model to a preset, keeping whole spins it already made', () => {
    actions.rotateBy(0, 4 * Math.PI + 0.3); // spun twice and a bit
    actions.setView('front');
    const [x, y, z] = state().rotation;
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(4 * Math.PI); // not -4π of unwinding
    expect(z).toBe(0);
  });

  it('stops any spin and ignores unknown views', () => {
    actions.spin(0, 3);
    expect(actions.setView('top')).toBe(true);
    expect(state().spinVelocity).toEqual([0, 0]);
    expect(state().rotation[0]).toBeCloseTo(Math.PI / 2);
    expect(actions.setView('sideways')).toBe(false);
  });
});

describe('zoomAbout', () => {
  it('keeps the point under the cursor fixed', () => {
    actions.moveTo(0.5, 0, 0);
    actions.zoomAbout(1, 1, 2);
    expect(state().scale).toBe(2);
    // The model's centre moves away from (1, 1) by the same factor.
    expect(state().position[0]).toBeCloseTo(0);
    expect(state().position[1]).toBeCloseTo(-1);
  });

  it('respects the zoom limits and moves only by the factor actually applied', () => {
    actions.scaleTo(19);
    actions.zoomAbout(0, 0, 10);
    expect(state().scale).toBe(20);
    actions.zoomAbout(1, 0, 1e-6);
    expect(state().scale).toBe(0.1);
  });
});

describe('fitToView', () => {
  it('centres the model and leaves room for an explode', () => {
    actions.moveTo(2, -1, 0);
    actions.scaleTo(5);
    actions.explode(1);
    actions.fitToView();
    expect(state().position).toEqual([0, 0, 0]);
    expect(state().scale).toBeCloseTo(fitScale(1));
    expect(fitScale(0)).toBe(1);
  });

  it('keyboard explode shrinks a zoomed-in view so parts stay on screen', () => {
    actions.scaleTo(3);
    actions.toggleExplode();
    expect(state().explodeTarget).toBe(1);
    expect(state().scale).toBeCloseTo(0.5);
  });
});
