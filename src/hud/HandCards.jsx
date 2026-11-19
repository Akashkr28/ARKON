import { useThrottledHands } from './useThrottledHands';
import { useHandStore } from '../store/handStore';

const MAX_CARD_WIDTH = 290;
const MARGIN = 8;

function cardPosition(hand, width) {
  // Prefer the outer side of the hand so the card doesn't cover the model.
  const onLeftHalf = hand.x < window.innerWidth / 2;
  const gap = hand.palmSize * 0.8;
  const x = onLeftHalf ? hand.x - gap - width : hand.x + gap;
  if (x >= MARGIN && x + width <= window.innerWidth - MARGIN) return { x, y: hand.y - 30 };

  // No room beside the hand (narrow window or hand near the edge): go below the palm.
  const centred = hand.x - width / 2;
  return {
    x: Math.min(window.innerWidth - width - MARGIN, Math.max(MARGIN, centred)),
    y: hand.y + hand.palmSize * 0.8,
  };
}

export default function HandCards() {
  const hands = useThrottledHands();
  const menuOpen = useHandStore((s) => s.menu !== null);
  if (menuOpen) return null; // the menu sits right where the card would be

  const width = Math.min(MAX_CARD_WIDTH, window.innerWidth - MARGIN * 2);
  return hands.map((hand) => {
    const { x, y } = cardPosition(hand, width);
    return (
      <div
        key={hand.id}
        className={`hand-card hand-${hand.handedness.toLowerCase()}${hand.active ? ' is-active' : ''}`}
        style={{ width, transform: `translate(${x}px, ${y}px)` }}
      >
        <div>
          <span className="hand-card-title">{hand.handedness.toUpperCase()} HAND</span>
          {` · OPEN ${Math.round(hand.openness * 100)}% · DIST ${hand.distanceM.toFixed(2)} m`}
        </div>
        <div className="hand-card-gesture">
          {hand.pose === 'NONE' ? '—' : hand.pose}
          {hand.active && <span className="hand-card-pinch"> · IN CONTROL</span>}
        </div>
      </div>
    );
  });
}
