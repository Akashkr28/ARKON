import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  IDENTITY,
  createMate,
  directionToWorld,
  dragFrame,
  dragPosition,
  fitFace,
  flippedRelative,
  pointToWorld,
  solveAssembly,
  solveMate,
  symmetricEigen,
  toCadMm,
  fromCadMm,
  turned,
  wouldLoop,
} from '../src/cad/assembly.js';

// A flat square (side s, at height y, facing up) as triangles with normals.
function square(s = 0.02, y = 0) {
  const h = s / 2;
  const corners = [
    [-h, y, -h],
    [h, y, h],
    [h, y, -h],
    [-h, y, -h],
    [-h, y, h],
    [h, y, h],
  ];
  return { points: corners.flat(), normals: corners.flatMap(() => [0, 1, 0]) };
}

// The side wall of a cylinder (radius r, along Y from y0 to y1, centred at cx, cz).
function wall(r = 0.005, y0 = 0, y1 = 0.02, cx = 0, cz = 0, segments = 24) {
  const points = [];
  const normals = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * 2 * Math.PI;
    const b = ((i + 1) / segments) * 2 * Math.PI;
    const p = (t, y) => [cx + r * Math.cos(t), y, cz + r * Math.sin(t)];
    const n = (t) => [Math.cos(t), 0, Math.sin(t)];
    points.push(...p(a, y0), ...p(b, y0), ...p(b, y1), ...p(a, y0), ...p(b, y1), ...p(a, y1));
    normals.push(...n(a), ...n(b), ...n(b), ...n(a), ...n(b), ...n(a));
  }
  return { points, normals };
}

const close = (a, b, digits = 5) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('what a picked face is', () => {
  it('a flat face: its centre and normal', () => {
    const { points, normals } = square(0.02, 0.01);
    const face = fitFace(points, normals);
    expect(face.type).toBe('plane');
    close(face.point, [0, 0.01, 0]);
    close(face.normal, [0, 1, 0]);
  });

  it('a round face: axis, centre and radius', () => {
    const { points, normals } = wall(0.004, 0, 0.03, 0.01, -0.02);
    const face = fitFace(points, normals);
    expect(face.type).toBe('cylinder');
    expect(Math.abs(face.axis[1])).toBeCloseTo(1, 5);
    close(face.point, [0.01, 0.015, -0.02]);
    expect(face.radius).toBeCloseTo(0.004, 5);
    expect(face.length).toBeCloseTo(0.03, 5);
  });

  it('eigenvectors come out smallest first', () => {
    const [first] = symmetricEigen([
      [4, 0, 0],
      [0, 1, 0],
      [0, 0, 9],
    ]);
    expect(first.value).toBeCloseTo(1);
    expect(Math.abs(first.vector[1])).toBeCloseTo(1);
  });
});

describe('mates', () => {
  const top = { type: 'plane', point: [0, 0.01, 0], normal: [0, 1, 0] }; // plate's top face
  const bottom = { type: 'plane', point: [0, 0, 0], normal: [0, -1, 0] }; // block's bottom face

  it('face to face: the moving face lands on the target face, facing it', () => {
    const placements = { plate: IDENTITY, block: { position: [0.3, 0.2, 0.1], quaternion: [0, 0, 0, 1] } };
    const mate = createMate('contact', { componentId: 'block', geometry: bottom }, { componentId: 'plate', geometry: top }, placements, 'm1');
    const placed = solveMate(mate, placements.plate);
    close(pointToWorld(placed, bottom.point).toArray(), [0, 0.01, 0]);
    close(directionToWorld(placed, bottom.normal).toArray(), [0, -1, 0]);

    // The free directions: gap lifts it off, slide moves it across.
    const lifted = solveMate({ ...mate, gap: 5, slide: [10, 0] }, placements.plate);
    expect(pointToWorld(lifted, bottom.point).y).toBeCloseTo(0.015);
    expect(pointToWorld(lifted, bottom.point).distanceTo(new Vector3(0, 0.015, 0))).toBeCloseTo(0.01);
  });

  it('turns the moving part over when the faces point the same way', () => {
    // Both faces up: the block has to flip to put its "top" against the plate.
    const placements = { plate: IDENTITY, block: IDENTITY };
    const mate = createMate('contact', { componentId: 'block', geometry: top }, { componentId: 'plate', geometry: top }, placements, 'm1');
    const placed = solveMate(mate, IDENTITY);
    close(directionToWorld(placed, top.normal).toArray(), [0, -1, 0]);
    // Flipping makes them face the same way (flush).
    const flush = solveMate({ ...mate, relative: flippedRelative(mate) }, IDENTITY);
    close(directionToWorld(flush, top.normal).toArray(), [0, 1, 0]);
  });

  it('on axis: a pin goes into a hole, and slides and turns along it', () => {
    const hole = { type: 'cylinder', point: [0.02, 0.005, 0], axis: [0, 1, 0], radius: 0.004 };
    const pin = { type: 'cylinder', point: [0, 0, 0], axis: [1, 0, 0], radius: 0.004 }; // lying down
    const placements = { plate: IDENTITY, pin: { position: [0.5, 0, 0], quaternion: [0, 0, 0, 1] } };
    const mate = createMate('axis', { componentId: 'pin', geometry: pin }, { componentId: 'plate', geometry: hole }, placements, 'm1');
    const placed = solveMate(mate, IDENTITY);
    close(pointToWorld(placed, pin.point).toArray(), hole.point);
    expect(Math.abs(directionToWorld(placed, pin.axis).y)).toBeCloseTo(1);
    const slid = solveMate({ ...mate, slide: 7 }, IDENTITY);
    expect(pointToWorld(slid, pin.point).y).toBeCloseTo(0.012);
  });

  it('refuses the wrong kind of face, or two faces of one part', () => {
    const round = { type: 'cylinder', point: [0, 0, 0], axis: [0, 1, 0], radius: 1 };
    const make = (type, a, b, ida = 'a', idb = 'b') =>
      createMate(type, { componentId: ida, geometry: a }, { componentId: idb, geometry: b }, {}, 'm');
    expect(() => make('contact', top, round)).toThrow('Pick two flat faces');
    expect(() => make('axis', top, round)).toThrow('round faces');
    expect(() => make('contact', top, top, 'a', 'a')).toThrow('two different parts');
  });

  it('attached parts follow their target, in chains', () => {
    const components = [
      { id: 'plate', position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      { id: 'block', position: [1, 1, 1], quaternion: [0, 0, 0, 1] },
      { id: 'cap', position: [2, 2, 2], quaternion: [0, 0, 0, 1] },
    ];
    const blockTop = { type: 'plane', point: [0, 0.03, 0], normal: [0, 1, 0] };
    const initial = solveAssembly(components, []);
    const m1 = createMate('contact', { componentId: 'block', geometry: bottom }, { componentId: 'plate', geometry: top }, initial, 'm1');
    const m2 = createMate('contact', { componentId: 'cap', geometry: bottom }, { componentId: 'block', geometry: blockTop }, solveAssembly(components, [m1]), 'm2');
    // Move and turn the plate: the block and the cap come with it.
    const moved = [{ ...components[0], position: [0, 1, 0], quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).toArray() }, components[1], components[2]];
    const placements = solveAssembly(moved, [m1, m2]);
    const capBottom = pointToWorld(placements.cap, bottom.point);
    // Plate top at x = −0.01 (turned 90° about Z, raised 1 m); block 30 mm tall on it.
    close(capBottom.toArray(), [-0.04, 1, 0]);
    expect(wouldLoop([m1, m2], 'plate', 'cap')).toBe(true);
    expect(wouldLoop([m1, m2], 'cap', 'plate')).toBe(false);
  });
});

describe('dragging and turning', () => {
  it('a free part follows the pointer in the plane facing the viewer', () => {
    const frame = dragFrame(null, null, [0, 0, 0], [0, 0, 1]);
    const at = dragPosition(frame, { origin: [0.1, 0.2, 5], direction: [0, 0, -1] });
    close(at, [0.1, 0.2, 0]);
  });

  it('a mated part slides across its face, or along its axis', () => {
    const top = { type: 'plane', point: [0, 0.01, 0], normal: [0, 1, 0] };
    const contact = { type: 'contact', target: { geometry: top } };
    const frame = dragFrame(contact, IDENTITY, null, null);
    const [u, w] = dragPosition(frame, { origin: [0.02, 1, 0], direction: [0, -1, 0] });
    expect(Math.hypot(u, w)).toBeCloseTo(20);
    const axis = { type: 'axis', target: { geometry: { type: 'cylinder', point: [0, 0, 0], axis: [0, 1, 0] } } };
    const along = dragPosition(dragFrame(axis, IDENTITY), { origin: [1, 0.05, 0], direction: [-1, 0, 0] });
    expect(along).toBeCloseTo(50);
  });

  it('turns a free part about a CAD axis; converts to and from CAD millimetres', () => {
    const quarter = turned(IDENTITY, [0, 1, 0], 90);
    close(directionToWorld(quarter, [1, 0, 0]).toArray(), [0, 0, -1]);
    expect(toCadMm([0.01, 0.02, -0.03])).toEqual([10, 30, 20]);
    close(fromCadMm([10, 30, 20]), [0.01, 0.02, -0.03]);
  });
});
