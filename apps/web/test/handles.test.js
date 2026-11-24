import { describe, expect, it } from 'vitest';
import { draggedValues, driverOf, handlesFor, lockedReason, snapValue } from '../src/cad/handles.js';
import { makeFeature } from '../src/cad/features.js';

const params = [
  { id: 'p1', name: 'length', expression: '120' },
  { id: 'p2', name: 'margin', expression: '15' },
  { id: 'p3', name: 'derived', expression: 'length / 2' },
];

describe('what a handle drives', () => {
  it('a number, a plain parameter, or nothing (a real formula)', () => {
    expect(driverOf(40, params)).toEqual({ kind: 'number' });
    expect(driverOf({ expr: 'length' }, params)).toEqual({ kind: 'parameter', parameterId: 'p1', name: 'length' });
    expect(driverOf({ expr: ' length ' }, params).kind).toBe('parameter');
    expect(driverOf({ expr: 'length - 2 * margin' }, params)).toMatchObject({ kind: 'locked' });
    // A parameter that is itself a formula can't be dragged either.
    expect(driverOf({ expr: 'derived' }, params).kind).toBe('locked');
  });
});

describe('handles for each feature', () => {
  const box = makeFeature('box', { length: 120, width: 80, height: 10 });

  it('box: arrows on the +X, +Y faces and the top, in viewer metres (Y up)', () => {
    const [length, width, height] = handlesFor(box, box, [], 10);
    expect(length).toMatchObject({ keys: ['length'], origin: [0.06, 0.005, -0], dir: [1, 0, 0], factor: 2 });
    expect(width).toMatchObject({ keys: ['width'], origin: [0, 0.005, -0.04], dir: [0, 0, -1], factor: 2 });
    expect(height).toMatchObject({ keys: ['height'], origin: [0, 0.01, -0], dir: [0, 1, 0], factor: 1 });
  });

  it('hole: a position pad and a diameter arrow on the top face', () => {
    const hole = makeFeature('hole', { x: 20, y: 10, diameter: 8 });
    const [pad, diameter] = handlesFor(hole, hole, [], 25);
    expect(pad).toMatchObject({ kind: 'plane', keys: ['x', 'y'], origin: [0.02, 0.025, -0.01] });
    expect(diameter.origin[0]).toBeCloseTo(0.024);
  });

  it('fillets have no handles; suppressed features neither', () => {
    expect(handlesFor(makeFeature('fillet'), makeFeature('fillet'), [], 10)).toEqual([]);
    expect(handlesFor({ ...box, enabled: false }, box, [], 10)).toEqual([]);
  });

  it('a formula-driven dimension is locked, with the reason', () => {
    const raw = { ...box, params: { ...box.params, length: { expr: 'length - 2 * margin' } } };
    const [length] = handlesFor(box, raw, params, 10);
    expect(lockedReason(length)).toBe('Set by the formula “length - 2 * margin”');
  });
});

describe('dragging', () => {
  const box = makeFeature('box', { length: 120, width: 80, height: 10 });
  const [length, , height] = handlesFor(box, box, [], 10);

  it('changes the dimension by the distance moved times its factor, snapped to mm', () => {
    // The +X face moves 10.4 mm: the box (centred) grows by twice that.
    expect(draggedValues(length, 10.4)).toEqual({ length: 141 });
    expect(draggedValues(length, 10.4, { fine: true }).length).toBeCloseTo(140.8);
    expect(draggedValues(height, -3.2)).toEqual({ height: 7 });
    expect(draggedValues(height, -50)).toEqual({ height: 0.1 }); // never below zero
  });

  it('slides a pad by the offset', () => {
    const hole = makeFeature('hole', { x: 20, y: 10 });
    const [pad] = handlesFor(hole, hole, [], 10);
    expect(draggedValues(pad, [5.4, -2.6])).toEqual({ x: 25, y: 7 });
  });

  it('snaps to whole or tenth millimetres', () => {
    expect(snapValue(12.46)).toBe(12);
    expect(snapValue(12.46, true)).toBeCloseTo(12.5);
  });
});
