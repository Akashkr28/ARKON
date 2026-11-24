import { useMemo } from 'react';
import { createPortal } from '@react-three/fiber';
import { DoubleSide, EdgesGeometry, PlaneGeometry } from 'three';
import { useViewerStore } from '../store/viewerStore';
import { sectionPosition } from './sectionPlane';

const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const MARGIN = 1.08; // a little larger than the model so the outline frames it

// A faint, unclipped rectangle showing where the section plane cuts. It lives in the
// model's own space (portalled into `content`), so it turns and moves with the model.
export default function SectionPlaneGizmo({ content, bounds }) {
  const section = useViewerStore((s) => s.section);
  const visible = useViewerStore((s) => s.showSectionPlane);

  const { geometry, edges } = useMemo(() => {
    const plane = new PlaneGeometry(1, 1);
    return { geometry: plane, edges: new EdgesGeometry(plane) };
  }, []);

  if (!section.axis || !visible || !bounds) return null;

  const i = AXIS_INDEX[section.axis];
  const size = bounds.max.map((max, k) => (max - bounds.min[k]) * MARGIN);
  const centre = bounds.max.map((max, k) => (max + bounds.min[k]) / 2);
  centre[i] = sectionPosition(section, bounds);

  // PlaneGeometry lies in XY facing +Z; turn it to face along the section axis.
  const rotation = section.axis === 'x' ? [0, Math.PI / 2, 0] : section.axis === 'y' ? [-Math.PI / 2, 0, 0] : [0, 0, 0];
  const scale =
    section.axis === 'x' ? [size[2], size[1], 1] : section.axis === 'y' ? [size[0], size[2], 1] : [size[0], size[1], 1];

  return createPortal(
    <group position={centre} rotation={rotation} scale={scale}>
      <mesh geometry={geometry} renderOrder={15}>
        <meshBasicMaterial
          color="#ffb347"
          transparent
          opacity={0.08}
          side={DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <lineSegments geometry={edges} renderOrder={15}>
        <lineBasicMaterial color="#ffb347" transparent opacity={0.8} depthTest={false} toneMapped={false} />
      </lineSegments>
    </group>,
    content,
  );
}
