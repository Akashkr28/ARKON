import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Euler, Vector3 } from 'three';
import { useViewerStore } from '../src/store/viewerStore.js';
import * as actions from '../src/actions/viewerActions.js';
import {
  addMeasurePoint,
  angleAt,
  cancelMeasuring,
  clearMeasurements,
  cycleMeasureTool,
  distanceBetween,
  setMeasureTool,
  useMeasureStore,
} from '../src/actions/measureActions.js';
import { registerSceneQueries } from '../src/scene/sceneQueries.js';
import { rotateXYZ } from '../src/scene/viewPresets.js';

const measure = () => useMeasureStore.getState();
const point = (metres) => ({ partId: 'part-0', local: metres, metres, kind: 'vertex' });

describe('distance and angle maths', () => {
  it('measures straight-line distance in metres', () => {
    expect(distanceBetween([0, 0, 0], [0.3, 0.4, 0])).toBeCloseTo(0.5);
  });

  it('measures the angle at the middle point', () => {
    expect(angleAt([1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(90);
    expect(angleAt([1, 0, 0], [0, 0, 0], [1, 1, 0])).toBeCloseTo(45);
    expect(angleAt([1, 0, 0], [0, 0, 0], [-1, 0, 0])).toBeCloseTo(180);
    expect(angleAt([0, 0, 0], [0, 0, 0], [1, 0, 0])).toBe(0); // degenerate, no NaN
  });
});

describe('measure tool', () => {
  beforeEach(() => {
    setMeasureTool('off');
    clearMeasurements();
    useViewerStore.setState({ explodeTarget: 0 });
  });

  it('ignores clicks while off', () => {
    expect(addMeasurePoint(point([0, 0, 0]))).toBeNull();
    expect(measure().draft).toEqual([]);
  });

  it('distance: two clicks make a measurement with per-axis deltas', () => {
    setMeasureTool('distance');
    expect(addMeasurePoint(point([0, 0, 0]))).toBeNull();
    const m = addMeasurePoint(point([0.1, -0.2, 0.2]));
    expect(m.type).toBe('distance');
    expect(m.value).toBeCloseTo(0.3);
    expect(m.deltas.map((d) => +d.toFixed(3))).toEqual([0.1, 0.2, 0.2]);
    expect(m.exploded).toBe(false);
    expect(measure().draft).toEqual([]);
    expect(measure().tool).toBe('distance'); // stays on for the next measurement
  });

  it('angle: three clicks, vertex in the middle', () => {
    setMeasureTool('angle');
    addMeasurePoint(point([0, 1, 0]));
    addMeasurePoint(point([0, 0, 0]));
    const m = addMeasurePoint(point([1, 0, 0]));
    expect(m.value).toBeCloseTo(90);
  });

  it('flags measurements taken on an exploded model', () => {
    useViewerStore.setState({ explodeTarget: 1 });
    setMeasureTool('distance');
    addMeasurePoint(point([0, 0, 0]));
    expect(addMeasurePoint(point([1, 0, 0])).exploded).toBe(true);
  });

  it('a click that hits nothing places no point', () => {
    setMeasureTool('distance');
    expect(addMeasurePoint(null)).toBeNull();
    expect(measure().draft).toEqual([]);
  });

  it('Esc backs out one level at a time', () => {
    setMeasureTool('distance');
    addMeasurePoint(point([0, 0, 0]));
    expect(cancelMeasuring()).toBe(true); // drops the half-finished one
    expect(measure()).toMatchObject({ tool: 'distance', draft: [] });
    expect(cancelMeasuring()).toBe(true); // leaves the tool
    expect(measure().tool).toBe('off');
    expect(cancelMeasuring()).toBe(false); // nothing left: let Esc clear the selection
  });

  it('Q cycles off → distance → angle → off', () => {
    cycleMeasureTool();
    expect(measure().tool).toBe('distance');
    cycleMeasureTool();
    expect(measure().tool).toBe('angle');
    cycleMeasureTool();
    expect(measure().tool).toBe('off');
  });

  it('loading another model clears measurements', () => {
    setMeasureTool('distance');
    addMeasurePoint(point([0, 0, 0]));
    addMeasurePoint(point([1, 0, 0]));
    useViewerStore.setState({ modelLoadCount: useViewerStore.getState().modelLoadCount + 1 });
    expect(measure().measurements).toEqual([]);
  });
});

describe('rotateXYZ matches three.js', () => {
  it.each([
    [[1, 2, 3], [0.3, -0.6, 0]],
    [[0, 1, 0], [Math.PI / 2, 0, 0]],
    [[-0.5, 0.2, 0.9], [0.7, 1.9, -0.4]],
  ])('%j rotated by %j', (v, angles) => {
    const expected = new Vector3(...v).applyEuler(new Euler(...angles, 'XYZ')).toArray();
    rotateXYZ(v, angles).forEach((value, i) => expect(value).toBeCloseTo(expected[i]));
  });
});

describe('fitToParts', () => {
  let unregister;
  afterEach(() => unregister?.());

  it('scales the parts to fill the view and puts their centre on screen centre', () => {
    actions.resetModel();
    useViewerStore.setState({ rotation: [0, Math.PI / 2, 0] });
    unregister = registerSceneQueries({
      snapAt: () => null,
      worldPointOf: () => null,
      partsBounds: () => ({ center: [0.5, 0.2, 0], radius: 0.25 }),
    });

    expect(actions.fitToParts(['part-0'])).toBe(true);
    const { scale, position, rotation } = useViewerStore.getState();
    expect(scale).toBeCloseTo(4);
    // Where the parts' centre ends up: position + scale · R · centre → (0, 0).
    const centre = rotateXYZ([0.5, 0.2, 0], rotation).map((v, i) => position[i] + scale * v);
    expect(centre[0]).toBeCloseTo(0);
    expect(centre[1]).toBeCloseTo(0);
  });

  it('reports false when the scene has nothing to frame', () => {
    unregister = registerSceneQueries({ snapAt: () => null, worldPointOf: () => null, partsBounds: () => null });
    expect(actions.fitToParts(['part-9'])).toBe(false);
  });
});
