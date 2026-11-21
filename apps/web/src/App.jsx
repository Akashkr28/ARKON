import { useEffect, useRef } from 'react';
import { useViewerStore } from './store/viewerStore';
import { useWebcam } from './video/useWebcam';
import { bindKeyboard } from './input/keyboard';
import { bindPointer } from './input/pointer';
import { refreshLibrary } from './actions/libraryActions';
import { startHistory } from './actions/history';
import Scene from './scene/Scene';
import Hud from './hud/Hud';
import ErrorScreen from './hud/ErrorScreen';
import DebugOverlay from './hud/DebugOverlay';
import { useHandTracking } from './vision/useHandTracking';
import { useHandStore } from './store/handStore';
import './App.css';

const TRACKING_OFF = new URLSearchParams(window.location.search).get('tracking') === 'off';

export default function App() {
  const videoRef = useRef(null);
  const requestedCameraId = useViewerStore((s) => s.requestedCameraId);
  const mirror = useViewerStore((s) => s.mirror);
  const grayscale = useViewerStore((s) => s.grayscale);
  const dim = useViewerStore((s) => s.dim);
  const modelStatus = useViewerStore((s) => s.modelStatus);
  const modelError = useViewerStore((s) => s.modelError);

  const camera = useWebcam(videoRef, requestedCameraId);
  // Keep tracking alive while switching cameras; the loop idles until frames arrive.
  // ?tracking=off skips hand tracking (no model download), e.g. for mouse-only use or tests.
  useHandTracking(videoRef, camera.status !== 'error' && !TRACKING_OFF);
  const trackerError = useHandStore((s) => s.error);

  useEffect(() => bindKeyboard(), []);
  useEffect(() => bindPointer(), []);
  useEffect(() => startHistory(), []);
  useEffect(() => {
    refreshLibrary();
  }, []);

  return (
    <div className="app">
      <video
        ref={videoRef}
        className="webcam"
        playsInline
        muted
        style={{
          transform: mirror ? 'scaleX(-1)' : 'none',
          filter: grayscale ? 'grayscale(1)' : 'none',
        }}
      />
      <div className="dim-overlay" style={{ opacity: dim }} />
      <Scene />
      <DebugOverlay />
      <Hud />

      <div className="hud-errors">
        {camera.status === 'error' && (
          <ErrorScreen title={camera.error.title} detail={camera.error.detail} />
        )}
        {modelStatus === 'error' && (
          <ErrorScreen
            title="Model failed to load"
            detail={`${modelError} — check that the file exists in public/models/ and is a valid .glb.`}
          />
        )}
        {trackerError && <ErrorScreen title="Hand tracking unavailable" detail={trackerError} />}
      </div>
    </div>
  );
}
