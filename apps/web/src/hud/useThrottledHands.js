import { useEffect, useState } from 'react';
import { useHandStore } from '../store/handStore';

function summarize(hand, { poses, activeHandIds }) {
  return {
    pose: poses[hand.id] ?? 'NONE',
    active: activeHandIds.includes(hand.id),
    id: hand.id,
    handedness: hand.handedness,
    gesture: hand.gesture,
    openness: hand.openness,
    distanceM: hand.distanceM,
    pinching: hand.pinching,
    x: hand.palmScreen.x,
    y: hand.palmScreen.y,
    palmSize: hand.palmSizeScreen,
  };
}

// Hand data changes every tracked frame; text readouts only need ~10 Hz.
export function useThrottledHands(intervalMs = 100) {
  const [hands, setHands] = useState([]);

  useEffect(() => {
    const timer = setInterval(() => {
      const state = useHandStore.getState();
      setHands(state.hands.map((hand) => summarize(hand, state)));
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return hands;
}
