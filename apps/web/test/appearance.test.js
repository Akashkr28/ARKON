import { describe, expect, it } from 'vitest';
import { describeAppearance, normaliseAppearance, surfaceOf } from '../src/cad/appearance.js';
import { appearanceOf, assemblyBomCsv, buildAssemblyBom } from '../src/models/assemblyBom.js';
import { cadTransform, turned } from '../src/cad/assembly.js';

describe('appearance', () => {
  it('normalises: known material, hex colour, known finish', () => {
    expect(normaliseAppearance({ materialId: 'brass', color: '#FF0000', finish: 'polished' })).toEqual({
      materialId: 'brass',
      color: '#ff0000',
      finish: 'polished',
    });
    expect(normaliseAppearance({ materialId: 'unobtainium', color: 'red', finish: 'shiny' })).toEqual({
      materialId: 'aluminium',
      color: null,
      finish: 'satin',
    });
    // A model's paint has no material.
    expect(normaliseAppearance({ color: '#00ff00' }, { allowNoMaterial: true })).toMatchObject({
      materialId: null,
      color: '#00ff00',
    });
    expect(normaliseAppearance(null, { allowNoMaterial: true })).toBe(null);
  });

  it('looks like its material unless coloured; metals shine, glass is see-through', () => {
    expect(surfaceOf({ materialId: 'brass', color: null, finish: 'polished' })).toMatchObject({
      color: '#c9a441',
      metalness: 0.5,
      roughness: 0.18,
    });
    expect(surfaceOf({ materialId: 'abs', color: '#123456', finish: 'matte' })).toMatchObject({
      color: '#123456',
      metalness: 0.05,
    });
    expect(surfaceOf({ materialId: 'glass', finish: 'matte' }).opacity).toBeLessThan(1);
    expect(describeAppearance({ materialId: 'brass', color: null, finish: 'polished' })).toBe('Brass · polished');
    expect(describeAppearance(null)).toBe('as in the CAD file');
  });
});

describe('assembly BOM', () => {
  const design = (materialId) => ({
    kind: 'design',
    design: {
      name: 'Pin',
      parameters: [],
      features: [{ type: 'cylinder', params: { diameter: 8, height: 30 } }],
      appearance: { materialId, color: null, finish: 'satin' },
    },
  });
  const components = [
    { id: 'a', name: 'Pin', source: design('steel') },
    { id: 'b', name: 'Pin 2', source: design('steel') },
    {
      id: 'c',
      name: 'Pin 3',
      source: design('steel'),
      appearance: { materialId: 'brass', color: null, finish: 'satin' },
    },
    { id: 'd', name: 'Aster C1', source: { kind: 'model', modelId: 'aster' } },
  ];
  const info = {
    a: { volumeMm3: 1000, sizeMm: [8, 8, 30] },
    b: { volumeMm3: 1000, sizeMm: [8, 8, 30] },
    c: { volumeMm3: 1000, sizeMm: [8, 8, 30] },
    d: { massKg: 1200, partsWithoutMass: 3, sizeMm: [4220, 1990, 1430] },
  };

  it('groups copies, weighs designed parts by material and models by their CAD data', () => {
    expect(appearanceOf(components[2]).materialId).toBe('brass');
    expect(appearanceOf(components[3])).toBe(null);
    const bom = buildAssemblyBom(components, info);
    expect(bom.rows.map((r) => [r.name, r.quantity, r.material])).toEqual([
      ['Pin', 2, 'Steel (structural)'],
      ['Pin', 1, 'Brass'],
      ['Aster C1', 1, 'From CAD file'],
    ]);
    expect(bom.rows[0].totalMassKg).toBeCloseTo(2 * 1000e-9 * 7850);
    expect(bom.rows[2].massNote).toBe('3 parts without mass');
    expect(bom.totals.massKg).toBeCloseTo(1200 + 3000e-9 * 7850 + 0 + (8500 - 7850) * 1000e-9);
    const csv = assemblyBomCsv(bom);
    expect(csv.split('\r\n')[1]).toMatch(/^1,Pin,Designed part,2,Steel \(structural\),/);
  });

  it('a part still loading has no mass yet, and says so', () => {
    const bom = buildAssemblyBom([components[0]], {});
    expect(bom.totals).toMatchObject({ massKg: null, partsWithoutMass: 1 });
  });
});

describe('placements for CAD', () => {
  it('turns viewer placements into CAD rotation + translation (mm, Z up)', () => {
    expect(cadTransform({ position: [0.01, 0.02, -0.03], quaternion: [0, 0, 0, 1] })).toEqual({
      rotation: { angle: 0, axis: [0, 0, 1] },
      translation: [10, 30, 20],
    });
    // A quarter turn about the viewer's up (Y) is a quarter turn about CAD Z.
    const { rotation } = cadTransform(turned({ position: [0, 0, 0], quaternion: [0, 0, 0, 1] }, [0, 1, 0], 90));
    expect(rotation.angle).toBeCloseTo(90);
    expect(rotation.axis).toEqual([0, 0, 1]);
  });
});
