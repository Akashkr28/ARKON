import { useViewerStore } from '../store/viewerStore';
import { clearSelection } from '../actions/viewerActions';

function formatSize(size) {
  return size.map((v) => (v >= 100 ? v.toFixed(0) : v.toPrecision(3))).join(' × ');
}

export default function PartInfoCard() {
  const part = useViewerStore((s) => (s.infoPartId ? s.parts[s.infoPartId] : null));
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
        <dt>BOUNDS</dt>
        <dd>{formatSize(part.size)}</dd>
      </dl>
      <div className="part-info-hint">model units · ESC to deselect</div>
    </div>
  );
}
