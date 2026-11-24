import { beforeEach, describe, expect, it, vi } from 'vitest';

// No WebAssembly here: the worker answers every build with "no part".
vi.mock('../src/cad/cadClient.js', () => ({
  buildInWorker: vi.fn(async () => ({ part: null, errors: {} })),
  stepOfCurrentPart: vi.fn(),
  whenKernelReady: vi.fn(),
}));

const actions = await import('../src/actions/designActions.js');
const { useDesignStore } = await import('../src/store/designStore.js');
const { makeFeature } = await import('../src/cad/features.js');

const state = () => useDesignStore.getState();

beforeEach(() => {
  while (actions.undoDesign()); // empty the history
  useDesignStore.setState({ name: 'Part', features: [makeFeature('box', { length: 100 })], parameters: [] });
  actions.selectFeature(null); // any edit now starts a fresh history (clears redo)
});

describe('design history', () => {
  it('undoes and redoes each edit, with a label', () => {
    const id = state().features[0].id;
    actions.addFeature('hole');
    expect(state().undoLabel).toBe('Add Hole');
    actions.setFeatureParam(id, 'height', 30);
    expect(state().undoLabel).toBe('Change Height (Z)');

    actions.undoDesign();
    expect(state().features[0].params.height).toBe(20);
    expect(state().redoLabel).toBe('Change Height (Z)');
    actions.undoDesign();
    expect(state().features).toHaveLength(1);
    actions.redoDesign();
    expect(state().features).toHaveLength(2);
  });

  it('merges quick edits of one field into one step', () => {
    const id = state().features[0].id;
    actions.setFeatureParam(id, 'length', 1);
    actions.setFeatureParam(id, 'length', 12);
    actions.setFeatureParam(id, 'length', 120);
    actions.undoDesign();
    expect(state().features[0].params.length).toBe(100);
    expect(state().undoLabel).toBe(null);
  });

  it('a new edit clears what could be redone', () => {
    actions.addFeature('fillet');
    actions.undoDesign();
    expect(state().redoLabel).toBe('Add Fillet');
    actions.addFeature('chamfer');
    expect(state().redoLabel).toBe(null);
  });
});

describe('parameters', () => {
  it('renaming a parameter renames it in every formula, whole words only', () => {
    const id = actions.addParameter();
    actions.renameParameter(id, 'len');
    const box = state().features[0];
    actions.setFeatureParam(box.id, 'length', { expr: 'len * 2 + lens' });
    const other = actions.addParameter();
    actions.setParameterExpression(other, 'len / 2');
    actions.renameParameter(id, 'size');
    expect(state().features[0].params.length).toEqual({ expr: 'size * 2 + lens' });
    expect(state().parameters.find((p) => p.id === other).expression).toBe('size / 2');
  });

  it('keeps choices from becoming formulas', () => {
    const id = actions.addFeature('fillet');
    actions.setFeatureParam(id, 'edges', { expr: 'top' });
    expect(state().features.at(-1).params.edges).toBe('vertical');
  });
});

describe('design files', () => {
  it('normalises what it opens: unknown types dropped, values checked, ids made', () => {
    const design = actions.normaliseDesign({
      name: 'Bracket',
      parameters: [{ name: 'w', expression: 40 }, { nonsense: true }],
      features: [
        { type: 'box', params: { length: { expr: 'w' }, width: -5, height: 'x' } },
        { type: 'laser-beam', params: {} },
        { type: 'hole', enabled: false, params: { diameter: 6 } },
      ],
    });
    expect(design.name).toBe('Bracket');
    expect(design.parameters).toEqual([expect.objectContaining({ name: 'w', expression: '40' })]);
    expect(design.features.map((f) => f.type)).toEqual(['box', 'hole']);
    expect(design.features[0].params).toMatchObject({ length: { expr: 'w' }, width: 0.01, height: 20 });
    expect(design.features[1]).toMatchObject({ enabled: false, params: { diameter: 6, depth: 0 } });
    expect(design.features.every((f) => typeof f.id === 'string')).toBe(true);
  });

  it('refuses files with nothing to build', () => {
    expect(() => actions.normaliseDesign({ features: [] })).toThrow('no features');
    expect(() => actions.normaliseDesign(null)).toThrow('Not a HoloCAD design');
  });
});
