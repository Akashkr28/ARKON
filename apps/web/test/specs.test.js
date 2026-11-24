import { beforeEach, describe, expect, it } from 'vitest';
import { Group, Mesh } from 'three';
import {
  effectiveMaterial,
  massKg,
  productKey,
  selectionTotals,
  specIndexByNode,
  specIndexOf,
  tagSpecIndices,
} from '../src/models/partSpecs.js';
import { loadSpecs, pickMaterial } from '../src/actions/specActions.js';
import { useSpecStore } from '../src/store/specStore.js';
import { formatArea, formatMass, formatSpecLength, formatVolume } from '../src/units.js';

// Same shape as the converter's GLB: an assembly node with a part, a sub-assembly, and a
// part whose mesh has two primitives (three.js turns that into two meshes in a group).
const json = {
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { name: 'Car', children: [1, 2, 4] },
    { name: 'Hood', mesh: 0 },
    { name: 'Wheel', children: [3] },
    { name: 'Rim', mesh: 1 },
    { name: 'Seat', mesh: 2 },
  ],
};

describe('linking parts to specs', () => {
  it('numbers mesh nodes depth-first, like the converter', () => {
    expect([...specIndexByNode(json)]).toEqual([
      [1, 0],
      [3, 1],
      [4, 2],
    ]);
  });

  it('tags the loaded objects and finds the index from any primitive', () => {
    const hood = new Mesh();
    const seat = new Group();
    const seatPrimitives = [new Mesh(), new Mesh()];
    seat.add(...seatPrimitives);
    const scene = new Group();
    scene.add(hood, seat);
    const associations = new Map([
      [hood, { nodes: 1 }],
      [seat, { nodes: 4 }],
    ]);

    tagSpecIndices({ scene, parser: { json, associations } });

    expect(specIndexOf(hood)).toBe(0);
    expect(seatPrimitives.map(specIndexOf)).toEqual([2, 2]);
    expect(specIndexOf(new Mesh())).toBe(null);
  });
});

describe('materials and mass', () => {
  const spec = { productName: 'Brake disc', volumeMm3: 1_000_000, material: { name: 'Cast iron', densityKgM3: 7200 } };

  it('uses the CAD material unless the user picked one', () => {
    expect(effectiveMaterial(spec, null)).toEqual({ name: 'Cast iron', density: 7200, source: 'file' });
    expect(effectiveMaterial(spec, { id: 'steel', name: 'Steel', density: 7850 })).toMatchObject({
      density: 7850,
      source: 'picked',
    });
    expect(effectiveMaterial({ volumeMm3: 5 }, null)).toBe(null);
  });

  it('computes mass from volume and density', () => {
    expect(massKg(1_000_000, 7200)).toBeCloseTo(7.2); // 1 litre of cast iron
    expect(massKg(1_000_000, null)).toBe(null);
  });

  it('keys copies of a part together', () => {
    expect(productKey(spec, 'Brake disc 2')).toBe('Brake disc');
    expect(productKey(null, 'Bolt')).toBe('Bolt');
  });

  it('totals a selection without guessing missing masses', () => {
    const totals = selectionTotals([
      { spec, material: effectiveMaterial(spec) },
      { spec: { volumeMm3: 2_000_000 }, material: null },
      { spec: null, material: null },
    ]);
    expect(totals).toMatchObject({ count: 3, missingMass: 2, volumeMm3: 3_000_000 });
    expect(totals.massKg).toBeCloseTo(7.2);
  });
});

describe('spec units', () => {
  it('formats lengths, areas, volumes and masses in the chosen unit', () => {
    expect(formatSpecLength(80, 'mm')).toBe('80.0 mm');
    expect(formatSpecLength(80, 'in')).toBe('3.150 in');
    expect(formatArea(645.16, 'in')).toBe('1.000 in²');
    expect(formatVolume(16387.064, 'in')).toBe('1.000 in³');
    expect(formatVolume(58_621_451.8, 'mm')).toBe('58,621,452 mm³');
    expect(formatMass(0.25)).toBe('250.0 g');
    expect(formatMass(157.105)).toBe('157.105 kg');
    expect(formatMass(1, 'in')).toBe('2.205 lb (1.000 kg)');
    expect(formatMass(null)).toBe('—');
  });
});

describe('loading specs', () => {
  beforeEach(() => useSpecStore.setState({ status: 'none', specs: [], materialPicks: {} }));

  const respond =
    (body, ok = true) =>
    async () => ({ ok, status: ok ? 200 : 500, json: async () => body });

  it('loads a bundled sample’s specs by part index', async () => {
    await loadSpecs('aster', {
      fetchImpl: respond({
        units: { length: 'mm' },
        parts: [
          { index: 1, name: 'B', spec: { volumeMm3: 2 } },
          { index: 0, name: 'A', spec: { volumeMm3: 1 } },
        ],
      }),
    });
    const state = useSpecStore.getState();
    expect(state.status).toBe('ready');
    expect(state.specs.map((s) => s.volumeMm3)).toEqual([1, 2]);
  });

  it('reports models without CAD data as unavailable, and failures as errors', async () => {
    await loadSpecs('aster', { fetchImpl: respond({ parts: [{ index: 0, name: 'A', spec: null }] }) });
    expect(useSpecStore.getState().status).toBe('unavailable');
    await loadSpecs('aster', { fetchImpl: respond({}, false) });
    expect(useSpecStore.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('500') });
    await loadSpecs('no-such-model');
    expect(useSpecStore.getState().status).toBe('unavailable');
  });

  it('picks and clears a material for a part', () => {
    pickMaterial('Brake disc', 'aluminium');
    expect(useSpecStore.getState().materialPicks['Brake disc']).toMatchObject({ density: 2700 });
    pickMaterial('Brake disc', null);
    expect(useSpecStore.getState().materialPicks).toEqual({});
  });
});
