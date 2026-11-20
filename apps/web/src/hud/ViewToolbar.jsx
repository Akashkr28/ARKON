import { useViewerStore } from '../store/viewerStore';
import { fitToView, setLengthUnit, setView } from '../actions/viewerActions';
import { VIEW_PRESETS } from '../scene/viewPresets';
import { LENGTH_UNITS } from '../units';

// Keyboard shortcuts shown on the buttons (handled in input/keyboard.js).
const VIEWS = [
  ['front', '1'],
  ['right', '3'],
  ['top', '7'],
  ['iso', '5'],
  ['back', null],
  ['left', null],
  ['bottom', null],
];

export default function ViewToolbar() {
  const unit = useViewerStore((s) => s.lengthUnit);

  return (
    <div className="hud-panel view-toolbar" aria-label="View">
      <button type="button" className="view-button view-fit" onClick={fitToView} title="Fit the model to the screen (0)">
        FIT <kbd>0</kbd>
      </button>
      {VIEWS.map(([name, key]) => (
        <button
          key={name}
          type="button"
          className="view-button"
          onClick={() => setView(name)}
          title={`${VIEW_PRESETS[name].label.toLowerCase()} view${key ? ` (${key})` : ''}`}
        >
          {VIEW_PRESETS[name].label}
          {key && <kbd>{key}</kbd>}
        </button>
      ))}
      <select value={unit} onChange={(e) => setLengthUnit(e.target.value)} aria-label="Length unit" title="Length unit">
        {Object.keys(LENGTH_UNITS).map((key) => (
          <option key={key} value={key}>
            {LENGTH_UNITS[key].label.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  );
}
