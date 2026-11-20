import { useViewerStore } from '../store/viewerStore';
import { clearSelection } from '../actions/viewerActions';
import { formatSize } from '../units';

export default function PartInfoCard() {
  const part = useViewerStore((s) => (s.infoPartId ? s.parts[s.infoPartId] : null));
  const unit = useViewerStore((s) => s.lengthUnit);
  if (!part) return null;

  return (
    <div className="hud-panel part-info">
      <div className="part-info-header">
        <span>PART · {part.id.replace('part-', '#')}</span>
        <button type="button" onClick={clearSelection} aria-label="Close part info">
          ✕
        </button>
      </div>
      <div className="part-info-name">{part.name}</div>
      <dl>
        <dt>VERTICES</dt>
        <dd>{part.vertexCount.toLocaleString()}</dd>
        <dt>SIZE</dt>
        <dd>{formatSize(part.size, unit)}</dd>
      </dl>
      <div className="part-info-hint">bounding box, real units · ESC to deselect</div>
    </div>
  );
}
