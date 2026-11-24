// The drag controller that mouse and pinch gestures share: grab a handle, move, release.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/cad/cadClient.js', () => ({
  buildInWorker: vi.fn(async () => ({ part: null, errors: {} })),
  stepOfCurrentPart: vi.fn(),
  whenKernelReady: vi.fn(),
}));

const design = await import('../src/actions/designActions.js');
const drag = await import('../src/actions/handleDrag.js');
const { registerHandleQueries } = await import('../src/scene/handleQueries.js');
const { useDesignStore } = await import('../src/store/designStore.js');
const { handlesFor } = await import('../src/cad/handles.js');
const { makeFeature } = await import('../src/cad/features.js');

const state = () => useDesignStore.getState();

// A fake scene: one handle, under pixel (100, 100); 1 px of pointer = 1 mm along its axis.
function withHandle(handle) {
  return registerHandleQueries({
    handleAt: (x, y) => (Math.hypot(x - 100, y - 100) < 14 ? handle : null),
    handlePosition: (h, x, y) => (h.kind === 'axis' ? x : [x, -y]),
  });
}

beforeEach(() => {
  while (design.undoDesign());
});

describe('dragging a handle', () => {
  it('changes the dimension live and is one undo step', () => {
    const box = makeFeature('box', { length: 120, width: 80, height: 10 });
    useDesignStore.setState({ features: [box], parameters: [], resolvedFeatures: [box] });
    const [length] = handlesFor(box, box, [], 10);
    const unregister = withHandle(length);

    expect(drag.beginHandleDrag(300, 300)).toBe(false); // nothing there
    expect(drag.beginHandleDrag(100, 100)).toBe(true);
    drag.moveHandleDrag(105, 100); // face +5 mm → length +10
    drag.moveHandleDrag(110, 100);
    expect(state().features[0].params.length).toBe(140);
    expect(state().drag.text).toBe('Length (X) 140.0 mm');
    drag.endHandleDrag();
    expect(state().drag).toBe(null);

    expect(state().undoLabel).toBe('Drag Length (X)');
    design.undoDesign();
    expect(state().features[0].params.length).toBe(120);
    expect(state().undoLabel).toBe(null);
    unregister();
  });

  it('drives the parameter behind a dimension', () => {
    const box = makeFeature('box', { length: { expr: 'length' } });
    const parameters = [{ id: 'p1', name: 'length', expression: '120' }];
    const resolved = { ...box, params: { ...box.params, length: 120 } };
    useDesignStore.setState({ features: [box], parameters, resolvedFeatures: [resolved] });
    const [length] = handlesFor(resolved, box, parameters, 20);
    const unregister = withHandle(length);

    drag.beginHandleDrag(100, 100);
    drag.moveHandleDrag(140, 100);
    drag.endHandleDrag();
    expect(state().parameters[0].expression).toBe('200');
    expect(state().features[0].params.length).toEqual({ expr: 'length' }); // still linked
    unregister();
  });

  it('a formula-driven handle explains itself and changes nothing', () => {
    const box = makeFeature('box', { length: { expr: 'width * 2' } });
    const resolved = { ...box, params: { ...box.params, length: 160 } };
    useDesignStore.setState({ features: [box], parameters: [], resolvedFeatures: [resolved] });
    const [length] = handlesFor(resolved, box, [], 20);
    const unregister = withHandle(length);

    expect(drag.beginHandleDrag(100, 100)).toBe(true); // grabbed (so the view doesn't turn)…
    expect(state().drag.text).toMatch(/Set by the formula “width \* 2”/);
    drag.moveHandleDrag(150, 100);
    drag.endHandleDrag();
    expect(state().features[0].params.length).toEqual({ expr: 'width * 2' }); // …but unchanged
    expect(state().undoLabel).toBe(null);
    unregister();
  });

  it('slides a position pad in both directions as one step', () => {
    const box = makeFeature('box');
    const hole = makeFeature('hole', { x: 0, y: 0 });
    useDesignStore.setState({ features: [box, hole], parameters: [], resolvedFeatures: [box, hole] });
    const [pad] = handlesFor(hole, hole, [], 20);
    const unregister = withHandle(pad);

    drag.beginHandleDrag(100, 100);
    drag.moveHandleDrag(112, 95); // x +12, y +5 (fake plane: y = −screen y)
    drag.moveHandleDrag(125, 90);
    drag.endHandleDrag();
    expect(state().features[1].params).toMatchObject({ x: 25, y: 10 });
    expect(state().drag).toBe(null);
    design.undoDesign();
    expect(state().features[1].params).toMatchObject({ x: 0, y: 0 });
    unregister();
  });
});
