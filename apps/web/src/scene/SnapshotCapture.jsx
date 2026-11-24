import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { registerSnapshot } from './viewSnapshot';

// Lets the exports take a picture of the current view (see viewSnapshot.js).
export default function SnapshotCapture() {
  const { gl, scene, camera } = useThree();
  useEffect(
    () =>
      registerSnapshot((background) => {
        // Render now and read back in the same task: the drawing buffer isn't kept
        // between frames. Composited onto a solid background (the canvas is see-through).
        gl.render(scene, camera);
        const out = document.createElement('canvas');
        out.width = gl.domElement.width;
        out.height = gl.domElement.height;
        const context = out.getContext('2d');
        context.fillStyle = background;
        context.fillRect(0, 0, out.width, out.height);
        context.drawImage(gl.domElement, 0, 0);
        return { dataUrl: out.toDataURL('image/jpeg', 0.9), width: out.width, height: out.height };
      }),
    [gl, scene, camera],
  );
  return null;
}
