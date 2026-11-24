import { useFrame, useThree } from '@react-three/fiber';
import { VIEW } from '../config';
import { useViewerStore } from '../store/viewerStore';

// Keeps the camera's near and far planes around the model as it's scaled. Zoomed far in,
// a 4 m car is thousands of scene units across: a fixed far plane would cut it off, and
// a fixed tiny near plane would waste depth precision (flickering surfaces).
const MAX_RANGE_RATIO = 20000; // far / near; plenty of precision for a 24-bit depth buffer

export default function CameraRange() {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const { position, scale, explodeTarget } = useViewerStore.getState();
    const radius = VIEW.modelRadius * scale * (1 + Math.max(0, explodeTarget)) * 1.1;
    const distance = camera.position.z - position[2];
    const far = Math.max(100, distance + radius);
    const near = Math.min(0.1, Math.max(far / MAX_RANGE_RATIO, (distance - radius) * 0.9));
    if (Math.abs(camera.far - far) / far > 0.01 || Math.abs(camera.near - near) / near > 0.01) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}
