import { useHandStore } from '../store/handStore';

// The entry matching the current gesture state lights up.
const ENTRIES = [
  { state: 'PINCHING', icon: '👌', label: 'TAP · SELECT / PRESS' },
  { state: 'HUD_PRESS', icon: '👌↕', label: 'PINCH-DRAG PANEL · SCROLL' },
  { state: 'MOVING', icon: '✊', label: 'FIST · MOVE' },
  { state: 'SPINNING', icon: '☝', label: 'POINT · DRAG / FLICK TO SPIN' },
  { state: 'SCALING', icon: '🖐🖐', label: 'HOLD + SPREAD · SCALE' },
  { state: 'EXPLODING', icon: '✊✊', label: 'PULL APART / TWIST ↺ · EXPLODE' },
  { state: 'HOLDING_PART', icon: '👌', label: 'PINCH PART · PULL' },
  { state: 'MENU', icon: '👌⏱', label: 'PINCH HOLD · MENU' },
  { state: null, icon: '👏', label: 'CLAP · ASSEMBLE' },
];

export default function GestureLegend() {
  const gestureState = useHandStore((s) => s.gestureState);

  return (
    <div className="hud-panel hud-legend">
      {ENTRIES.map((entry) => (
        <span key={entry.label} className={`legend-entry${entry.state === gestureState ? ' is-active' : ''}`}>
          <span className="legend-icon">{entry.icon}</span>
          {entry.label}
        </span>
      ))}
      <span className="legend-keys">E · R · M · L · D · F · B · C · ESC</span>
    </div>
  );
}
