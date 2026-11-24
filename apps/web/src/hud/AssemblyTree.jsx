import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useViewerStore } from '../store/viewerStore';
import * as actions from '../actions/viewerActions';
import { buildAssemblyTree, filterAssemblyTree } from '../models/assemblyTree';

function EyeButton({ node, hidden }) {
  const allHidden = node.partIds.every((id) => hidden.has(id));
  const someHidden = !allHidden && node.partIds.some((id) => hidden.has(id));
  return (
    <button
      type="button"
      className={`tree-eye${allHidden ? ' is-off' : someHidden ? ' is-mixed' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        actions.toggleHidden(node.partIds);
      }}
      aria-label={`${allHidden ? 'Show' : 'Hide'} ${node.name}`}
      title={allHidden ? 'Show (H toggles the selection)' : 'Hide'}
    >
      {allHidden ? '◌' : someHidden ? '◐' : '●'}
    </button>
  );
}

function TreeRow({ node, depth, expanded, onToggle, state }) {
  const { selected, hidden, xray, primaryId } = state;
  const rowRef = useRef(null);
  const isGroup = node.type === 'group';
  const isSelected = node.partIds.length > 0 && node.partIds.every((id) => selected.has(id));
  const isHidden = node.partIds.every((id) => hidden.has(id));
  const isXray = !isGroup && xray.has(node.id);

  // Keep the part picked in 3D visible in the list.
  useEffect(() => {
    if (!isGroup && node.id === primaryId) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isGroup, node.id, primaryId]);

  const select = (event) => {
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive) {
      for (const id of node.partIds) actions.toggleInSelection(id);
    } else {
      actions.selectParts(node.partIds);
      actions.showPartInfo();
    }
  };

  return (
    <div
      ref={rowRef}
      className={`tree-row${isSelected ? ' is-selected' : ''}${isHidden ? ' is-hidden' : ''}`}
      style={{ paddingLeft: 6 + depth * 14 }}
      onClick={select}
      onDoubleClick={() => actions.isolateParts(node.partIds)}
      title={`${node.name} — click to select, double-click to isolate`}
      role="treeitem"
      aria-label={node.name}
      aria-selected={isSelected}
      aria-expanded={isGroup ? expanded : undefined}
    >
      {isGroup ? (
        <button
          type="button"
          className="tree-caret"
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node.id);
          }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
      ) : (
        <span className="tree-caret" />
      )}
      <EyeButton node={node} hidden={hidden} />
      <span className={`tree-name${isGroup ? ' is-group' : ''}`}>{node.name}</span>
      {isXray && (
        <span className="tree-tag" title="X-ray (see-through)">
          XR
        </span>
      )}
      {isGroup && <span className="tree-count">{node.partIds.length}</span>}
    </div>
  );
}

function TreeNodes({ nodes, depth, expandedIds, forceExpanded, onToggle, state }) {
  return nodes.map((node) => {
    const expanded = forceExpanded || expandedIds.has(node.id);
    return (
      <div key={node.id} role="group">
        <TreeRow node={node} depth={depth} expanded={expanded} onToggle={onToggle} state={state} />
        {node.type === 'group' && expanded && (
          <TreeNodes
            nodes={node.children}
            depth={depth + 1}
            expandedIds={expandedIds}
            forceExpanded={forceExpanded}
            onToggle={onToggle}
            state={state}
          />
        )}
      </div>
    );
  });
}

export default function AssemblyTree() {
  const { parts, selectedPartIds, primaryId, hiddenPartIds, xrayPartIds } = useViewerStore(
    useShallow((s) => ({
      parts: s.parts,
      selectedPartIds: s.selectedPartIds,
      primaryId: s.selectedPartId,
      hiddenPartIds: s.hiddenPartIds,
      xrayPartIds: s.xrayPartIds,
    })),
  );
  const [query, setQuery] = useState('');
  const tree = useMemo(() => buildAssemblyTree(Object.values(parts)), [parts]);
  const shown = useMemo(() => filterAssemblyTree(tree, query), [tree, query]);
  // Top-level groups start open; deeper ones on demand.
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  useEffect(() => setExpandedIds(new Set(tree.filter((n) => n.type === 'group').map((n) => n.id))), [tree]);

  const toggle = (id) =>
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const state = {
    selected: new Set(selectedPartIds),
    hidden: new Set(hiddenPartIds),
    xray: new Set(xrayPartIds),
    primaryId,
  };
  const partCount = Object.keys(parts).length;

  return (
    <div className="hud-panel hud-tree">
      <div className="tree-toolbar">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${partCount} parts…`}
          aria-label="Search parts"
        />
      </div>
      <div className="tree-status">
        <span>
          {selectedPartIds.length > 0 && `${selectedPartIds.length} selected · `}
          {hiddenPartIds.length > 0 ? `${hiddenPartIds.length} hidden` : `${partCount} parts`}
        </span>
        <button type="button" onClick={actions.showAllParts} disabled={!hiddenPartIds.length}>
          SHOW ALL <kbd>U</kbd>
        </button>
      </div>
      <div className="tree-list" role="tree" aria-label="Assembly">
        {shown.length ? (
          <TreeNodes
            nodes={shown}
            depth={0}
            expandedIds={expandedIds}
            forceExpanded={Boolean(query.trim())}
            onToggle={toggle}
            state={state}
          />
        ) : (
          <div className="tree-empty">{partCount ? `No part matches “${query}”` : 'No model loaded'}</div>
        )}
      </div>
    </div>
  );
}
