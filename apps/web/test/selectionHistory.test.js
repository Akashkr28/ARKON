import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewerStore } from '../src/store/viewerStore.js';
import * as actions from '../src/actions/viewerActions.js';
import { setInteractionActive, startHistory, useHistoryStore } from '../src/actions/history.js';

const state = () => useViewerStore.getState();
const part = (id, name) => ({ id, name, vertexCount: 10, size: [0.1, 0.1, 0.1] });

beforeEach(() => {
  actions.resetModel();
  actions.modelLoaded([part('part-0', 'Helmet'), part('part-1', 'Visor'), part('part-2', 'Boot')]);
});

describe('selection', () => {
  it('click selects one part; the latest pick is the primary', () => {
    actions.selectPart('part-1');
    expect(state().selectedPartIds).toEqual(['part-1']);
    expect(state().selectedPartId).toBe('part-1');
  });

  it('shift-click adds and removes, keeping primary = most recent', () => {
    actions.selectPart('part-0');
    actions.toggleInSelection('part-2');
    expect(state().selectedPartIds).toEqual(['part-0', 'part-2']);
    expect(state().selectedPartId).toBe('part-2');

    actions.toggleInSelection('part-2');
    expect(state().selectedPartIds).toEqual(['part-0']);
    expect(state().selectedPartId).toBe('part-0');

    actions.toggleInSelection('part-0');
    expect(state().selectedPartIds).toEqual([]);
    expect(state().selectedPartId).toBeNull();
  });

  it('select all, and ignores ids that are not parts of this model', () => {
    actions.selectAll();
    expect(state().selectedPartIds).toEqual(['part-0', 'part-1', 'part-2']);
    actions.selectParts(['part-1', 'nope', 'part-1']);
    expect(state().selectedPartIds).toEqual(['part-1']);
    actions.toggleInSelection('nope');
    expect(state().selectedPartIds).toEqual(['part-1']);
  });

  it('clearing resets the selection, the info card and any pull', () => {
    actions.selectPart('part-0');
    actions.showPartInfo();
    actions.pullPart(0.1, 0, 0);
    actions.clearSelection();
    expect(state()).toMatchObject({ selectedPartIds: [], selectedPartId: null, infoPartId: null, partPull: [0, 0, 0] });
  });
});

describe('undo / redo', () => {
  let stop;

  beforeEach(() => {
    vi.useFakeTimers();
    stop = startHistory();
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  const settle = () => vi.advanceTimersByTime(500);

  it('groups a burst of changes (a drag) into one step', () => {
    for (let i = 0; i < 20; i++) actions.rotateBy(0, 0.05);
    settle();
    expect(useHistoryStore.getState().undoLabel).toBe('Rotate');

    expect(actions.undo()).toBe('Rotate');
    expect(state().rotation[1]).toBeCloseTo(-0.6); // back to the initial iso view
    expect(useHistoryStore.getState()).toEqual({ undoLabel: null, redoLabel: 'Rotate' });

    expect(actions.redo()).toBe('Rotate');
    expect(state().rotation[1]).toBeCloseTo(-0.6 + 1);
  });

  it('separate interactions are separate steps, undone newest first', () => {
    actions.moveBy(0.5, 0);
    settle();
    actions.zoomAbout(0, 0, 2);
    settle();
    actions.toggleExplode();
    settle();

    expect(actions.undo()).toBe('Explode');
    expect(state().explodeTarget).toBe(0);
    expect(actions.undo()).toBe('Zoom');
    expect(state().scale).toBe(1);
    expect(actions.undo()).toBe('Move');
    expect(state().position).toEqual([0, 0, 0]);
    expect(actions.undo()).toBeNull();
  });

  it('a drag with long pauses is still one step, closed when the drag ends', () => {
    setInteractionActive('pointer', true);
    actions.rotateBy(0, 0.3);
    vi.advanceTimersByTime(2000); // user pauses mid-drag
    actions.rotateBy(0, 0.3);
    vi.advanceTimersByTime(2000);
    expect(useHistoryStore.getState().undoLabel).toBeNull(); // still open

    setInteractionActive('pointer', false);
    settle();
    expect(actions.undo()).toBe('Rotate');
    expect(state().rotation[1]).toBeCloseTo(-0.6);
    expect(actions.undo()).toBeNull(); // only one step
  });

  it('undo in the middle of a change finishes it as its own step first', () => {
    actions.scaleTo(3);
    expect(actions.undo()).toBe('Zoom'); // no settle needed
    expect(state().scale).toBe(1);
  });

  it('a new change after undo drops the redo branch', () => {
    actions.moveBy(1, 0);
    settle();
    actions.undo();
    actions.rotateBy(0.2, 0);
    settle();
    expect(useHistoryStore.getState().redoLabel).toBeNull();
    expect(actions.redo()).toBeNull();
  });

  it('undo also stops an ongoing spin, and selection changes are not steps', () => {
    actions.selectPart('part-1');
    settle();
    expect(useHistoryStore.getState().undoLabel).toBeNull();

    actions.spin(0, 4);
    actions.tick(0.1);
    actions.undo();
    expect(state().spinVelocity).toEqual([0, 0]);
  });

  it('loading another model starts a fresh history', () => {
    actions.moveBy(1, 0);
    settle();
    useViewerStore.setState({ modelLoadCount: state().modelLoadCount + 1 });
    expect(useHistoryStore.getState().undoLabel).toBeNull();
  });
});
