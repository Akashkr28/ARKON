import { useViewerStore } from '../store/viewerStore';
import { fitToSelection, fitToView, redo, setLengthUnit, setView, undo } from '../actions/viewerActions';
import { useHistoryStore } from '../actions/history';
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

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

function UndoRedo() {
  const { undoLabel, redoLabel } = useHistoryStore();
  return (
    <div className="view-undo">
      <button
        type="button"
        className="view-button"
        onClick={undo}
        disabled={!undoLabel}
        title={undoLabel ? `Undo ${undoLabel.toLowerCase()} (${MOD}Z)` : 'Nothing to undo'}
      >
        ↶ UNDO
      </button>
      <button
        type="button"
        className="view-button"
        onClick={redo}
        disabled={!redoLabel}
        title={redoLabel ? `Redo ${redoLabel.toLowerCase()} (${MOD}Shift+Z)` : 'Nothing to redo'}
      >
        ↷ REDO
      </button>
    </div>
  );
}

export default function ViewToolbar() {
  const unit = useViewerStore((s) => s.lengthUnit);

  return (
    <div className="hud-panel view-toolbar" aria-label="View">
      <UndoRedo />
      <button type="button" className="view-button view-fit" onClick={fitToView} title="Fit the model to the screen (0)">
        FIT <kbd>0</kbd>
      </button>
      <button
        type="button"
        className="view-button"
        onClick={fitToSelection}
        title="Frame the selected parts (.), or everything visible if nothing is selected"
      >
        FIT SEL <kbd>.</kbd>
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
