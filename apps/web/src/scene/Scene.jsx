import { Component, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useViewerStore } from '../store/viewerStore';
import { modelFailed, suggestQuality, tick } from '../actions/viewerActions';
import { SlowFrameDetector, nextLowerLevel, preset, quality } from '../quality';
import { VIEW } from '../config';
import { useLibraryStore } from '../store/libraryStore';
import { findModelEntry } from '../models/catalog';
import ModelViewer from './ModelViewer';
import HandRings from './HandRings';
import Effects from './Effects';

class ModelErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    modelFailed(error?.message ?? String(error));
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function ViewerClock() {
  useFrame((_, dt) => tick(Math.min(dt, 0.1)));
  return null;
}

// Watches the render frame rate and, once, suggests the next quality level down.
function PerformanceWatch() {
  const detector = useMemo(() => new SlowFrameDetector(), []);
  useFrame((_, dt) => {
    if (!detector.update(dt)) return;
    const lower = nextLowerLevel(quality.level);
    if (lower) suggestQuality(lower);
  });
  return null;
}

export default function Scene() {
  const modelId = useViewerStore((s) => s.modelId);
  const modelLoadCount = useViewerStore((s) => s.modelLoadCount);
  const hologram = useViewerStore((s) => s.materialMode === 'hologram');
  // Re-resolve when the library changes (e.g. a model was re-converted: new URL).
  const libraryModels = useLibraryStore((s) => s.models);
  const model = findModelEntry(modelId, libraryModels);

  // Hologram mode renders on black and the canvas is screen-blended over the video:
  // black disappears, glow adds light, and bloom halos aren't clipped by alpha.
  return (
    <Canvas
      className="scene"
      style={{ mixBlendMode: hologram ? 'screen' : 'normal' }}
      gl={{ alpha: true, antialias: preset.antialias, powerPreference: 'high-performance' }}
      dpr={[1, preset.maxPixelRatio]}
      camera={{ fov: VIEW.cameraFov, position: [0, 0, VIEW.cameraZ], near: 0.1, far: 100 }}
    >
      {hologram && <color attach="background" args={['#000000']} />}
      <hemisphereLight args={['#ffffff', '#334455', 1.2]} />
      <directionalLight position={[3, 4, 5]} intensity={2} />
      <directionalLight position={[-4, -2, -3]} intensity={0.6} />

      <ViewerClock />
      <PerformanceWatch />
      {/* TODO(depth): hand occlusion — depth-only hand/forearm capsules so hands pass in front of the model (see integrations/README.md). */}
      {model && (
        <ModelErrorBoundary key={`${modelId}:${modelLoadCount}`}>
          <ModelViewer url={model.url} />
        </ModelErrorBoundary>
      )}
      <HandRings />
      <Effects />
    </Canvas>
  );
}
