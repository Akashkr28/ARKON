import { useMeasureStore, clearMeasurements, deleteMeasurement, setMeasureTool } from '../actions/measureActions';
import { useViewerStore } from '../store/viewerStore';
import { formatLength } from '../units';
import SectionControls from './SectionControls';

const HINTS = {
  distance: ['Click the first point', 'Click the second point'],
  angle: ['Click a point on the first side', 'Click the corner (vertex)', 'Click a point on the second side'],
};

function MeasurementRow({ measurement, index, unit }) {
  const { type, value, deltas, exploded } = measurement;
  return (
    <li className="measure-row">
      <span className="measure-index">{type === 'distance' ? 'D' : 'A'}{index + 1}</span>
      <span className="measure-value">
        {type === 'distance' ? formatLength(value, unit, { precise: true }) : `${value.toFixed(1)}°`}
        {deltas && (
          <span className="measure-deltas">
            Δ {deltas.map((d) => formatLength(d, unit, { precise: true }).split(' ')[0]).join(' / ')}
          </span>
        )}
        {exploded && <span className="measure-warn" title="Taken on the exploded model">EXPLODED</span>}
      </span>
      <button type="button" onClick={() => deleteMeasurement(measurement.id)} aria-label="Delete measurement">
        ✕
      </button>
    </li>
  );
}

export default function MeasurePanel() {
  const { tool, draft, hover, measurements } = useMeasureStore();
  const unit = useViewerStore((s) => s.lengthUnit);

  return (
    <div className="hud-panel measure-panel">
      <SectionControls />
      <div className="measure-tools">
        <button
          type="button"
          className={`view-button${tool === 'distance' ? ' is-active' : ''}`}
          onClick={() => setMeasureTool(tool === 'distance' ? 'off' : 'distance')}
          title="Measure a distance between two points (Q)"
        >
          ↔ DIST <kbd>Q</kbd>
        </button>
        <button
          type="button"
          className={`view-button${tool === 'angle' ? ' is-active' : ''}`}
          onClick={() => setMeasureTool(tool === 'angle' ? 'off' : 'angle')}
          title="Measure an angle through three points (Q twice)"
        >
          ∠ ANGLE
        </button>
      </div>
      {tool !== 'off' && (
        <div className="measure-hint">
          {HINTS[tool][draft.length]}
          {hover && <span className={`measure-snap snap-text-${hover.kind}`}> · snaps to {hover.kind}</span>}
          <div className="measure-sub">Esc to cancel</div>
        </div>
      )}
      {measurements.length > 0 && (
        <>
          <ul className="measure-list">
            {measurements.map((m, i) => (
              <MeasurementRow key={m.id} measurement={m} index={i} unit={unit} />
            ))}
          </ul>
          <button type="button" className="measure-clear" onClick={clearMeasurements}>
            CLEAR ALL
          </button>
        </>
      )}
    </div>
  );
}
