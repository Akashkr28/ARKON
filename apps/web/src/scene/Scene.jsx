import { Component } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useViewerStore } from '../store/viewerStore';
import { modelFailed, tick } from '../actions/viewerActions';
import { MODELS, VIEW } from '../config';
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

export default function Scene() {
  const modelId = useViewerStore((s) => s.modelId);
  const hologram = useViewerStore((s) => s.materialMode === 'hologram');
  const model = MODELS.find((m) => m.id === modelId);

  // Hologram mode renders on black and the canvas is screen-blended over the video:
  // black disappears, glow adds light, and bloom halos aren't clipped by alpha.
  return (
    <Canvas
      className="scene"
      style={{ mixBlendMode: hologram ? 'screen' : 'normal' }}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      dpr={[1, 1.5]}
      camera={{ fov: VIEW.cameraFov, position: [0, 0, VIEW.cameraZ], near: 0.1, far: 100 }}
    >
      {hologram && <color attach="background" args={['#000000']} />}
      <hemisphereLight args={['#ffffff', '#334455', 1.2]} />
      <directionalLight position={[3, 4, 5]} intensity={2} />
      <directionalLight position={[-4, -2, -3]} intensity={0.6} />

      <ViewerClock />
      {/* TODO(depth): Depth Anything occlusion — render a depth mask here so hands can pass in front of the model. */}
      <ModelErrorBoundary key={modelId}>
        <ModelViewer url={model.url} />
      </ModelErrorBoundary>
      <HandRings />
      <Effects />
    </Canvas>
  );
}
