// The design engine against the real OpenCASCADE kernel (WebAssembly, run in Node).
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { assemblyStep, buildPart, describePart } from '../src/cad/buildPart.js';
import { cadTransform, turned } from '../src/cad/assembly.js';
import { resolveFeatures, resolveParameters } from '../src/cad/parameters.js';
import {
  clampParam,
  describeFeature,
  makeFeature,
  patternPoints,
  starterDesign,
  visibleParams,
} from '../src/cad/features.js';

const require = createRequire(import.meta.url);
let r;

beforeAll(async () => {
  const opencascade = (await import('replicad-opencascadejs')).default;
  const OC = await opencascade({
    locateFile: () => require.resolve('replicad-opencascadejs/wasm'),
    print: () => {},
    printErr: () => {},
  });
  r = await import('replicad');
  r.setOC(OC);
}, 60_000);

const volumeOf = (features) => {
  const { shape, errors } = buildPart(r, features);
  const volume = shape ? r.measureVolume(shape) : null;
  shape?.delete();
  return { volume, errors };
};

describe('features', () => {
  it('lays out hole patterns', () => {
    expect(patternPoints({ x: 0, y: 0, pattern: 'line', count: 3, pitch: 10 })).toEqual([
      [-10, 0],
      [0, 0],
      [10, 0],
    ]);
    expect(patternPoints({ pattern: 'grid', count: 2, rows: 2, pitch: 90, rowPitch: 50 })).toEqual([
      [-45, -25],
      [45, -25],
      [-45, 25],
      [45, 25],
    ]);
    const circle = patternPoints({ pattern: 'circle', count: 4, patternRadius: 10, startAngle: 0 });
    expect(circle[1][0]).toBeCloseTo(0);
    expect(circle[1][1]).toBeCloseTo(10);
  });

  it('keeps values within limits and shows only relevant parameters', () => {
    expect(clampParam('box', 'length', -5)).toBe(0.01);
    expect(clampParam('prism', 'sides', 2.6)).toBe(3);
    expect(clampParam('fillet', 'edges', 'nonsense')).toBe('vertical');
    const hole = makeFeature('hole');
    expect(visibleParams(hole).map((p) => p.key)).not.toContain('rows');
    hole.params.pattern = 'grid';
    expect(visibleParams(hole).map((p) => p.key)).toContain('rows');
  });

  it('describes features in one line', () => {
    expect(describeFeature(makeFeature('box', { length: 120, width: 80, height: 10 }))).toBe('120 × 80 × 10 mm');
    expect(describeFeature(makeFeature('hole', { diameter: 8, pattern: 'grid', count: 2, rows: 2, pitch: 60 }))).toBe(
      '4 × Ø8 through',
    );
  });
});

describe('building parts', () => {
  it('builds every base shape with exact volumes', () => {
    expect(volumeOf([makeFeature('box', { length: 100, width: 60, height: 20 })]).volume).toBeCloseTo(120_000, 3);
    expect(volumeOf([makeFeature('cylinder', { diameter: 20, height: 10 })]).volume).toBeCloseTo(Math.PI * 1000, 3);
    expect(volumeOf([makeFeature('tube', { outer: 20, inner: 10, height: 10 })]).volume).toBeCloseTo(Math.PI * 750, 3);
    // Hexagon, 20 across flats: area = 2√3 · (AF/2)²
    expect(volumeOf([makeFeature('prism', { sides: 6, acrossFlats: 20, height: 10 })]).volume).toBeCloseTo(
      2 * Math.sqrt(3) * 100 * 10,
      2,
    );
  });

  it('drills through and blind holes, in patterns, with counterbores', () => {
    const plate = makeFeature('box', { length: 100, width: 100, height: 10 });
    const through = volumeOf([plate, makeFeature('hole', { diameter: 10, pattern: 'line', count: 3, pitch: 20 })]);
    expect(through.volume).toBeCloseTo(100_000 - 3 * Math.PI * 25 * 10, 2);
    const blind = volumeOf([plate, makeFeature('hole', { diameter: 10, depth: 4 })]);
    expect(blind.volume).toBeCloseTo(100_000 - Math.PI * 25 * 4, 2);
    const cbore = volumeOf([plate, makeFeature('hole', { diameter: 6, counterbore: 12, counterboreDepth: 3 })]);
    expect(cbore.volume).toBeCloseTo(100_000 - Math.PI * 9 * 10 - Math.PI * (36 - 9) * 3, 2);
  });

  it('cuts pockets, adds bosses, shells', () => {
    const block = makeFeature('box', { length: 100, width: 100, height: 20 });
    expect(volumeOf([block, makeFeature('pocket', { length: 40, width: 20, depth: 5 })]).volume).toBeCloseTo(
      200_000 - 4000,
      2,
    );
    expect(volumeOf([block, makeFeature('boss', { diameter: 20, height: 10 })]).volume).toBeCloseTo(
      200_000 + Math.PI * 100 * 10,
      2,
    );
    const cup = volumeOf([
      makeFeature('box', { length: 50, width: 50, height: 30 }),
      makeFeature('shell', { thickness: 2 }),
    ]);
    expect(cup.volume).toBeCloseTo(50 * 50 * 30 - 46 * 46 * 28, 1); // walls and floor 2 mm, open top
  });

  it('rounds and chamfers edges', () => {
    const block = makeFeature('box', { length: 100, width: 60, height: 20 });
    const rounded = volumeOf([block, makeFeature('fillet', { radius: 5, edges: 'vertical' })]);
    expect(rounded.volume).toBeCloseTo(120_000 - 4 * (25 - (Math.PI * 25) / 4) * 20, 2);
    const chamfered = volumeOf([block, makeFeature('chamfer', { distance: 2, edges: 'top' })]);
    expect(chamfered.volume).toBeLessThan(120_000);
  });

  it('skips a feature that can’t be built, with a reason, and keeps the rest', () => {
    const block = makeFeature('box', { length: 100, width: 60, height: 20 });
    const tooBig = makeFeature('fillet', { radius: 80 });
    const hole = makeFeature('hole', { diameter: 10 });
    const { volume, errors } = volumeOf([block, tooBig, hole]);
    expect(errors[tooBig.id]).toMatch(/radius too large/);
    expect(volume).toBeCloseTo(120_000 - Math.PI * 25 * 20, 2);
    expect(volumeOf([hole]).errors[hole.id]).toMatch(/Start with a base shape/);
    expect(volumeOf([block, makeFeature('box')]).errors).not.toEqual({});
    const badTube = makeFeature('tube', { outer: 10, inner: 20 });
    expect(volumeOf([badTube]).errors[badTube.id]).toMatch(/smaller than the outer/);
  });

  it('ignores suppressed features', () => {
    const block = makeFeature('box', { length: 10, width: 10, height: 10 });
    const hole = { ...makeFeature('hole', { diameter: 4 }), enabled: false };
    expect(volumeOf([block, hole]).volume).toBeCloseTo(1000, 3);
  });
});

describe('describing a part for the viewer', () => {
  it('meshes in metres with Y up, with properties in mm', () => {
    const starter = starterDesign();
    const { values } = resolveParameters(starter.parameters);
    const { features, errors } = resolveFeatures(starter.features, values);
    expect(errors).toEqual({});
    const { shape } = buildPart(r, features);
    const part = describePart(r, shape);
    shape.delete();
    const { properties: p } = part;
    expect(p.sizeMm).toEqual([120, 80, 10].map((v) => expect.closeTo(v, 6)));
    const plate = 120 * 80 * 10 - 4 * (36 - Math.PI * 9) * 10 - 4 * Math.PI * 16 * 10;
    expect(p.volumeMm3).toBeCloseTo(plate, 1);
    expect(p.faceTypes).toEqual({ plane: 6, cylinder: 8 }); // 4 holes + 4 rounded corners
    // Y up: the plate is 10 mm tall in Y, 80 mm deep in Z.
    let [ymin, ymax, zmin, zmax] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < part.positions.length; i += 3) {
      ymin = Math.min(ymin, part.positions[i + 1]);
      ymax = Math.max(ymax, part.positions[i + 1]);
      zmin = Math.min(zmin, part.positions[i + 2]);
      zmax = Math.max(zmax, part.positions[i + 2]);
    }
    expect(ymax - ymin).toBeCloseTo(0.01, 6);
    expect(zmax - zmin).toBeCloseTo(0.08, 6);
    const triangles = part.indices.length / 3;
    expect(part.faceGroups.reduce((n, [, count]) => n + count, 0)).toBe(triangles);
    expect(part.edgeLines.length % 3).toBe(0);
  });
});

describe('STEP assemblies', () => {
  it('writes each designed part placed, named and coloured', async () => {
    const plate = [makeFeature('box', { length: 120, width: 80, height: 10 })];
    const pin = [makeFeature('cylinder', { diameter: 8, height: 30 })];
    // The pin lying on its side (a quarter turn about the viewer's X), 200 mm along X.
    const placement = turned({ position: [0.2, 0, 0], quaternion: [0, 0, 0, 1] }, [1, 0, 0], 90);
    const { blob, skipped } = assemblyStep(r, [
      {
        name: 'Plate',
        color: '#b9c0c7',
        features: plate,
        ...cadTransform({ position: [0, 0, 0], quaternion: [0, 0, 0, 1] }),
      },
      { name: 'Pin', color: '#c9a441', features: pin, ...cadTransform(placement) },
      { name: 'Nothing', color: '#ffffff', features: [] },
    ]);
    expect(skipped).toEqual(['Nothing']);
    const text = await blob.text();
    expect(text.startsWith('ISO-10303-21;')).toBe(true);
    expect(text).toContain("'Plate'");
    expect(text).toContain("'Pin'");
    expect(text).toMatch(/COLOUR_RGB/);

    // Read back: the pin lies along CAD Y now, 200 mm out along X.
    const shape = await r.importSTEP(blob);
    const { bounds } = shape.boundingBox;
    shape.delete();
    expect(bounds[1][0]).toBeCloseTo(204, 0); // pin's far side: 200 + radius 4
    expect(bounds[0][2]).toBeCloseTo(-4, 0); // it dips 4 mm below the plate's bottom
  });
});
