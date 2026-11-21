import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewerStore } from '../src/store/viewerStore.js';
import * as actions from '../src/actions/viewerActions.js';
import { startHistory, useHistoryStore } from '../src/actions/history.js';
import { buildAssemblyTree, filterAssemblyTree } from '../src/models/assemblyTree.js';

const suit = { id: 'g1', name: 'Sentinel Mk I' };
const leftArm = { id: 'g2', name: 'Left arm' };
const rightArm = { id: 'g3', name: 'Right arm' };
const head = { id: 'g4', name: 'Head' };
const PARTS = [
  { id: 'part-0', name: 'Helmet', path: [suit, head] },
  { id: 'part-1', name: 'Visor', path: [suit, head] },
  { id: 'part-2', name: 'Gauntlet', path: [suit, leftArm] },
  { id: 'part-3', name: 'Gauntlet', path: [suit, rightArm] },
].map((p) => ({ ...p, vertexCount: 10, size: [0.1, 0.1, 0.1] }));

const state = () => useViewerStore.getState();
const names = (nodes) => nodes.map((n) => (n.type === 'group' ? [n.name, names(n.children)] : n.name));

describe('buildAssemblyTree', () => {
  it('nests parts under their assemblies, skipping the single top-level wrapper', () => {
    const tree = buildAssemblyTree(PARTS);
    expect(names(tree)).toEqual([
      ['Head', ['Helmet', 'Visor']],
      ['Left arm', ['Gauntlet']],
      ['Right arm', ['Gauntlet']],
    ]);
    expect(tree[0].partIds).toEqual(['part-0', 'part-1']);
  });

  it('handles flat models (no assembly structure)', () => {
    const flat = [{ id: 'a', name: 'Body' }, { id: 'b', name: 'Glass' }];
    expect(names(buildAssemblyTree(flat))).toEqual(['Body', 'Glass']);
  });
});

describe('filterAssemblyTree', () => {
  const tree = buildAssemblyTree(PARTS);

  it('keeps matching parts and the groups leading to them', () => {
    const shown = filterAssemblyTree(tree, 'gaunt');
    expect(names(shown)).toEqual([
      ['Left arm', ['Gauntlet']],
      ['Right arm', ['Gauntlet']],
    ]);
    expect(shown[0].partIds).toEqual(['part-2']);
  });

  it('a matching group keeps everything inside it; no match gives nothing', () => {
    expect(names(filterAssemblyTree(tree, 'HEAD'))).toEqual([['Head', ['Helmet', 'Visor']]]);
    expect(filterAssemblyTree(tree, 'propeller')).toEqual([]);
    expect(filterAssemblyTree(tree, '  ')).toBe(tree);
  });
});

describe('visibility', () => {
  beforeEach(() => {
    actions.resetModel();
    useViewerStore.setState({ hiddenPartIds: [], xrayPartIds: [] });
    actions.modelLoaded(PARTS);
  });

  it('hides the selection and drops hidden parts from it', () => {
    actions.selectParts(['part-0', 'part-2']);
    actions.showPartInfo();
    actions.hideParts();
    expect(state().hiddenPartIds).toEqual(['part-0', 'part-2']);
    expect(state().selectedPartIds).toEqual([]);
    expect(state().infoPartId).toBeNull();
  });

  it('isolate hides everything else; show all brings it back', () => {
    actions.isolateParts(['part-1']);
    expect(state().hiddenPartIds).toEqual(['part-0', 'part-2', 'part-3']);
    actions.showAllParts();
    expect(state().hiddenPartIds).toEqual([]);
  });

  it('toggling a group shows it all if any of it is visible... and hides it all otherwise', () => {
    actions.hideParts(['part-0']);
    actions.toggleHidden(['part-0', 'part-1']); // mixed → hide all
    expect(state().hiddenPartIds).toEqual(['part-0', 'part-1']);
    actions.toggleHidden(['part-0', 'part-1']); // all hidden → show
    expect(state().hiddenPartIds).toEqual([]);
  });

  it('x-ray toggles as a set', () => {
    actions.toggleXray(['part-2', 'part-3']);
    expect(state().xrayPartIds).toEqual(['part-2', 'part-3']);
    actions.toggleXray(['part-2']);
    expect(state().xrayPartIds).toEqual(['part-3']);
  });

  describe('undo', () => {
    let stop;
    beforeEach(() => {
      vi.useFakeTimers();
      stop = startHistory();
    });
    afterEach(() => {
      stop();
      vi.useRealTimers();
    });

    it('hide, isolate and show all are undoable steps with clear names', () => {
      actions.hideParts(['part-3']);
      vi.advanceTimersByTime(500);
      expect(useHistoryStore.getState().undoLabel).toBe('Hide 1 part');
      actions.isolateParts(['part-0']);
      vi.advanceTimersByTime(500);
      actions.showAllParts();
      vi.advanceTimersByTime(500);

      expect(actions.undo()).toBe('Show all');
      expect(state().hiddenPartIds).toEqual(['part-1', 'part-2', 'part-3']);
      expect(actions.undo()).toBe('Isolate'); // named by the action, not "Hide 2 parts"
      expect(state().hiddenPartIds).toEqual(['part-3']);
      expect(actions.undo()).toBe('Hide 1 part');
      expect(state().hiddenPartIds).toEqual([]);
    });

    it('a named action that changes nothing does not rename the next step', async () => {
      actions.setView('iso'); // already the iso view: no change
      await Promise.resolve(); // let the hint expire
      actions.rotateBy(0, 0.5);
      vi.advanceTimersByTime(500);
      expect(useHistoryStore.getState().undoLabel).toBe('Rotate');
      actions.setView('front');
      vi.advanceTimersByTime(500);
      expect(useHistoryStore.getState().undoLabel).toBe('Front view');
    });
  });
});
