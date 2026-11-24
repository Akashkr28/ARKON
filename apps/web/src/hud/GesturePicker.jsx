import { useHandStore } from '../store/handStore';
import { chooseGesturePicker, closeGesturePicker } from '../input/handCursor';

const WIDTH = 240;
const ROW = 38;

// A dropdown's options as big buttons, for choosing with an air tap (a native
// dropdown can't be opened from script). Works with the mouse too.
export default function GesturePicker() {
  const picker = useHandStore((s) => s.picker);
  if (!picker) return null;
  const height = Math.min(window.innerHeight - 32, 44 + picker.options.length * ROW);
  const left = Math.min(window.innerWidth - WIDTH - 16, Math.max(16, picker.x - WIDTH / 2));
  const top = Math.min(window.innerHeight - height - 16, Math.max(16, picker.y - 22));
  return (
    <div className="hud-panel gesture-picker" style={{ left, top, width: WIDTH, maxHeight: height }} role="listbox" aria-label={picker.label}>
      <div className="gesture-picker-header">
        <span>{picker.label || 'CHOOSE'}</span>
        <button type="button" onClick={closeGesturePicker} aria-label="Close">
          ✕
        </button>
      </div>
      {picker.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.selected}
          className={`gesture-picker-option${option.selected ? ' is-active' : ''}`}
          disabled={option.disabled}
          onClick={() => chooseGesturePicker(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
