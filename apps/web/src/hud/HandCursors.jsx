import { useHandStore } from '../store/handStore';

// A ring at each hand's pinch point: where an air tap will land. It fills while you
// pinch, and a held pinch sweeps round toward opening the menu.
export default function HandCursors() {
  const cursors = useHandStore((s) => s.cursors);
  const menuOpen = useHandStore((s) => s.menu !== null);
  if (menuOpen) return null;
  return cursors.map((cursor) => (
    <div
      key={cursor.id}
      className={`hand-cursor hand-${cursor.handedness.toLowerCase()}${cursor.pinching ? ' is-pinching' : ''}${
        cursor.active ? ' is-active' : ''
      } pose-${cursor.pose.toLowerCase()}`}
      style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)`, '--hold': cursor.hold }}
    />
  ));
}
