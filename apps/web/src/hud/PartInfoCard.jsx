import { useShallow } from 'zustand/react/shallow';
import { useViewerStore } from '../store/viewerStore';
import { clearSelection, hideParts, hidePartInfo, isolateParts, toggleXray } from '../actions/viewerActions';
import { formatSize } from '../units';

function SelectionSummary({ parts, unit }) {
  const vertices = parts.reduce((sum, part) => sum + part.vertexCount, 0);
  const names = [...new Set(parts.map((p) => p.name))];
  return (
    <>
      <div className="part-info-name">{parts.length} parts selected</div>
      <dl>
        <dt>VERTICES</dt>
        <dd>{vertices.toLocaleString()}</dd>
        <dt>LAST</dt>
        <dd>
          {parts.at(-1).name} · {formatSize(parts.at(-1).size, unit)}
        </dd>
      </dl>
      <div className="part-info-list">{names.slice(0, 8).join(', ')}{names.length > 8 ? ', …' : ''}</div>
    </>
  );
}

export default function PartInfoCard() {
  const { infoPartId, selectedPartIds, parts, unit } = useViewerStore(
    useShallow((s) => ({
      infoPartId: s.infoPartId,
      selectedPartIds: s.selectedPartIds,
      parts: s.parts,
      unit: s.lengthUnit,
    })),
  );
  const selected = selectedPartIds.map((id) => parts[id]).filter(Boolean);
  if (!infoPartId || selected.length === 0) return null;
  const part = selected.at(-1);

  return (
    <div className="hud-panel part-info">
      <div className="part-info-header">
        <span>{selected.length > 1 ? 'SELECTION' : `PART · ${part.id.replace('part-', '#')}`}</span>
        <button type="button" onClick={hidePartInfo} aria-label="Close part info">
          ✕
        </button>
      </div>
      {selected.length > 1 ? (
        <SelectionSummary parts={selected} unit={unit} />
      ) : (
        <>
          <div className="part-info-name">{part.name}</div>
          {part.path?.length > 0 && (
            <div className="part-info-path">{part.path.map((step) => step.name).join(' › ')}</div>
          )}
          <dl>
            <dt>VERTICES</dt>
            <dd>{part.vertexCount.toLocaleString()}</dd>
            <dt>SIZE</dt>
            <dd>{formatSize(part.size, unit)}</dd>
          </dl>
        </>
      )}
      <div className="part-info-actions">
        <button type="button" onClick={() => hideParts()} title="Hide the selection (H)">
          HIDE <kbd>H</kbd>
        </button>
        <button type="button" onClick={() => isolateParts()} title="Show only the selection (I)">
          ISOLATE <kbd>I</kbd>
        </button>
        <button type="button" onClick={() => toggleXray()} title="See-through (X)">
          X-RAY <kbd>X</kbd>
        </button>
      </div>
      <div className="part-info-hint">
        Shift+click to add or remove · Ctrl+A all · ESC clears
        <button type="button" className="part-info-clear" onClick={clearSelection}>
          CLEAR
        </button>
      </div>
    </div>
  );
}
