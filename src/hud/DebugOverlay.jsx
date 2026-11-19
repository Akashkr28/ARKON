import { useEffect, useRef } from 'react';
import { GestureRecognizer } from '@mediapipe/tasks-vision';
import { useViewerStore } from '../store/viewerStore';
import { useHandStore } from '../store/handStore';
import { GESTURE } from '../config';

const CONNECTIONS = GestureRecognizer.HAND_CONNECTIONS;
const HAND_COLORS = { Left: '#ff4fd8', Right: '#2ee6ff' };

function fitCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
  canvas.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawHand(ctx, hand) {
  const color = HAND_COLORS[hand.handedness];
  const points = hand.screen;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const { start, end } of CONNECTIONS) {
    ctx.moveTo(points[start].x, points[start].y);
    ctx.lineTo(points[end].x, points[end].y);
  }
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = '10px monospace';
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(String(i), p.x + 5, p.y - 5);
  });

  ctx.strokeStyle = hand.pinching ? '#ffe14f' : 'rgba(255,255,255,0.35)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(points[4].x, points[4].y);
  ctx.lineTo(points[8].x, points[8].y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(hand.palmScreen.x, hand.palmScreen.y, hand.palmSizeScreen * 0.35, 0, Math.PI * 2);
  ctx.stroke();
}

function drawStats(ctx, tracker, renderFps) {
  const lines = [
    `TRACKER   ${tracker.status.toUpperCase()}${tracker.delegate ? ` (${tracker.delegate})` : ''}`,
    `VIDEO     ${tracker.videoSize[0]}×${tracker.videoSize[1]}`,
    `TRACK FPS ${tracker.trackFps.toFixed(1)}`,
    `RENDER    ${renderFps.toFixed(0)} fps`,
    `INFERENCE ${tracker.inferenceMs.toFixed(1)} ms`,
    `HANDS     ${tracker.hands.length}`,
    `STATE     ${tracker.gestureState}`,
    ...(tracker.flickSpeed !== null
      ? [`FLICK     ${tracker.flickSpeed.toFixed(1)} / ${GESTURE.flickMinSpeed} palm/s`]
      : []),
    ...tracker.hands.map(
      (h) =>
        `#${h.id} ${h.handedness.padEnd(5)} ${(tracker.poses[h.id] ?? 'NONE').padEnd(5)}` +
        ` (${h.gesture} ${(h.gestureScore * 100).toFixed(0)}%)` +
        ` pinch ${h.pinchRatio.toFixed(2)}${h.pinching ? ' ●' : ''}`,
    ),
  ];

  const x = 16;
  const y = 60;
  const lineHeight = 16;
  ctx.fillStyle = 'rgba(2, 16, 24, 0.75)';
  ctx.fillRect(x, y, 420, lines.length * lineHeight + 12);
  ctx.fillStyle = '#9ff3ff';
  ctx.font = '12px monospace';
  lines.forEach((line, i) => ctx.fillText(line, x + 8, y + 18 + i * lineHeight));
}

function DebugCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    fitCanvas(canvas);
    const onResize = () => fitCanvas(canvas);
    window.addEventListener('resize', onResize);

    let frameHandle = 0;
    let lastTime = performance.now();
    let renderFps = 0;

    const draw = (now) => {
      frameHandle = requestAnimationFrame(draw);
      const instant = 1000 / Math.max(now - lastTime, 1);
      renderFps = renderFps ? renderFps * 0.9 + instant * 0.1 : instant;
      lastTime = now;

      const tracker = useHandStore.getState();
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const hand of tracker.hands) drawHand(ctx, hand);
      drawStats(ctx, tracker, renderFps);
    };
    frameHandle = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frameHandle);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="debug-overlay" />;
}

export default function DebugOverlay() {
  const debug = useViewerStore((s) => s.debug);
  return debug ? <DebugCanvas /> : null;
}
