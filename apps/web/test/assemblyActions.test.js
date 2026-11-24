import { beforeEach, describe, expect, it, vi } from 'vitest';

// No WebAssembly or model files here: every part is a 20 mm cube, ready at once.
vi.mock('../src/cad/cadClient.js', () => ({
  buildInWorker: vi.fn(async () => ({ part: null, errors: {} })),
  stepOfCurrentPart: vi.fn(),
  whenKernelReady: vi.fn(),
}));
const BOX = { min: [-0.01, 0, -0.01], max: [0.01, 0.02, 0.01] };
vi.mock('../src/scene/assemblyContent.js', () => ({
  loadContent: vi.fn(async () => ({ box: BOX })),
  contentOf: vi.fn(() => ({ box: BOX })),
  forgetContent: vi.fn(),
  facesFor: vi.fn(() => null),
}));

const actions = await import('../src/actions/assemblyActions.js');
const { useAssemblyStore } = await import('../src/store/assemblyStore.js');
const { pointToWorld } = await import('../src/cad/assembly.js');

const state = () => useAssemblyStore.getState();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const pin = { name: 'Pin', parameters: [], features: [{ type: 'cylinder', params: { diameter: 8, height: 30 } }] };
const plate = {
  name: 'Plate',
  parameters: [],
  features: [{ type: 'box', params: { length: 120, width: 80, height: 10 } }],
};

const top = { type: 'plane', point: [0, 0.02, 0], normal: [0, 1, 0] };
const bottom = { type: 'plane', point: [0, 0, 0], normal: [0, -1, 0] };
const face = (componentId, geometry) => ({
  componentId,
  geometry,
  label: `x · ${geometry.type}`,
  key: `${componentId}${geometry.type}`,
});

beforeEach(async () => {
  while (actions.undoAssembly());
  actions.newAssembly();
  actions.setTool(null);
  await settle();
});

describe('putting parts together', () => {
  it('adds parts side by side, with unique names', async () => {
    const a = actions.addDesignPart(plate);
    const b = actions.addDesignPart(plate);
    await settle();
    const [first, second] = state().components;
    expect(second.name).toBe('Plate 2');
    expect(state().content[a].status).toBe('ready');
    // The second sits to the right of the first, on the same floor.
    expect(second.position[0]).toBeGreaterThan(first.position[0] + 0.02);
    expect(second.position[1]).toBeCloseTo(first.position[1]);
    expect(state().placements[b].position).toEqual(second.position);
  });

  it('mates face to face in two clicks; the moving part lands on the target', async () => {
    const base = actions.addDesignPart(plate);
    const block = actions.addDesignPart(pin);
    await settle();
    actions.setTool('contact');
    actions.pickFace(face(block, bottom));
    expect(state().message).toMatch(/Now click a face on the part to attach Pin to/);
    actions.pickFace(face(base, top));
    expect(state().mates).toHaveLength(1);
    expect(state().tool).toBe(null);
    expect(state().undoLabel).toBe('Mate Pin to Plate');
    const baseTop = pointToWorld(state().placements[base], top.point);
    const blockBottom = pointToWorld(state().placements[block], bottom.point);
    expect(blockBottom.distanceTo(baseTop)).toBeCloseTo(0, 6);

    // Gap lifts it; moving the base carries it along.
    actions.setMateValue(state().mates[0].id, 'gap', 5);
    actions.moveComponentTo(base, [1, 0, 0]);
    const lifted = pointToWorld(state().placements[block], bottom.point);
    const movedTop = pointToWorld(state().placements[base], top.point);
    expect(movedTop.x).toBeCloseTo(1);
    expect(lifted.x).toBeCloseTo(movedTop.x);
    expect(lifted.y - movedTop.y).toBeCloseTo(0.005);

    // Undo the move and the gap, then the mate.
    actions.undoAssembly();
    actions.undoAssembly();
    expect(state().mates[0].gap).toBe(0);
    actions.undoAssembly();
    expect(state().mates).toHaveLength(0);
  });

  it('refuses the wrong face, explains, and keeps waiting', async () => {
    const a = actions.addDesignPart(plate);
    actions.addDesignPart(pin);
    await settle();
    actions.setTool('axis');
    actions.pickFace(face(a, top));
    expect(state().message).toMatch(/flat face\. Pick two round faces/);
    expect(state().pick).toBe(null);
  });

  it("won't attach a part to something hanging off it", async () => {
    const a = actions.addDesignPart(plate);
    const b = actions.addDesignPart(pin);
    await settle();
    actions.setTool('contact');
    actions.pickFace(face(b, bottom));
    actions.pickFace(face(a, top));
    actions.setTool('contact');
    actions.pickFace(face(a, bottom));
    actions.pickFace(face(b, top));
    expect(state().message).toMatch(/already attached/);
    expect(state().mates).toHaveLength(1);
  });

  it('a mated part turns about its mate; unmating leaves it where it is', async () => {
    const a = actions.addDesignPart(plate);
    const b = actions.addDesignPart(pin);
    await settle();
    actions.setTool('contact');
    actions.pickFace(face(b, bottom));
    actions.pickFace(face(a, top));
    actions.turnComponent(b, null, 90);
    expect(state().mates[0].angle).toBe(90);
    const before = state().placements[b];
    actions.removeMate(state().mates[0].id);
    expect(state().mates).toHaveLength(0);
    expect(state().placements[b].position).toEqual(before.position);
    expect(state().undoLabel).toBe('Unmate Pin');
  });

  it('deleting a part removes its mates; parts attached to it stay put', async () => {
    const a = actions.addDesignPart(plate);
    const b = actions.addDesignPart(pin);
    await settle();
    actions.setTool('contact');
    actions.pickFace(face(b, bottom));
    actions.pickFace(face(a, top));
    const where = state().placements[b].position;
    actions.removeComponent(a);
    expect(state().components.map((c) => c.id)).toEqual([b]);
    expect(state().mates).toEqual([]);
    expect(state().placements[b].position).toEqual(where);
  });
});

describe('assembly files', () => {
  it('normalises what it opens: bad parts and dangling mates dropped', () => {
    const assembly = actions.normaliseAssembly({
      name: 'Rig',
      components: [
        { id: 'a', name: 'Base', source: { kind: 'design', design: plate }, position: [0, 0, 0] },
        { id: 'b', source: { kind: 'model', modelId: 'aster' }, quaternion: [0, 0, 0] },
        { id: 'c', source: { kind: 'laser' } },
      ],
      mates: [
        {
          type: 'contact',
          moving: { componentId: 'b', geometry: bottom },
          target: { componentId: 'a', geometry: top },
          relative: [0, 0, 0, 1],
        },
        {
          type: 'contact',
          moving: { componentId: 'b', geometry: bottom },
          target: { componentId: 'zz', geometry: top },
          relative: [0, 0, 0, 1],
        },
      ],
    });
    expect(assembly.name).toBe('Rig');
    expect(assembly.components.map((c) => c.id)).toEqual(['a', 'b']);
    expect(assembly.components[1]).toMatchObject({ name: 'Part', quaternion: [0, 0, 0, 1] });
    expect(assembly.mates).toHaveLength(1);
    expect(assembly.mates[0]).toMatchObject({ slide: [0, 0], gap: 0, angle: 0 });
  });

  it('refuses what is not an assembly', () => {
    expect(() => actions.normaliseAssembly(null)).toThrow('Not a HoloCAD assembly');
  });
});
