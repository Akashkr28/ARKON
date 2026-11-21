import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, LineBasicMaterial, Vector3 } from 'three';
import { useMeasureStore } from '../actions/measureActions';
import { useViewerStore } from '../store/viewerStore';
import { worldPointOf } from './sceneQueries';
import { formatLength } from '../units';

// Draws measurements over the model: lines between the picked points (attached to
// their parts, so they follow rotation and explode), value labels, the snap marker
// under the cursor, and a rubber band from the last placed point.

const MAX_POINTS = 4;
const LINE_COLOR = '#ffe14f';
const SNAP_COLORS = { vertex: '#ffe14f', edge: '#2ee6ff', face: '#ffffff' };
const scratch = new Vector3();

function MeasureLine({ points, extra = null, dashed = false }) {
  const { geometry, material } = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
    const m = new LineBasicMaterial({
      color: LINE_COLOR,
      transparent: true,
      opacity: dashed ? 0.55 : 1,
      depthTest: false, // always visible, even when the line passes behind geometry
      toneMapped: false,
    });
    return { geometry: g, material: m };
  }, [dashed]);

  useFrame(() => {
    const attribute = geometry.attributes.position;
    const all = extra ? [...points, extra] : points;
    let count = 0;
    for (const point of all) {
      const world = point.world ?? worldPointOf(point, scratch);
      if (!world) continue;
      attribute.setXYZ(count++, world.x, world.y, world.z);
    }
    geometry.setDrawRange(0, count);
    attribute.needsUpdate = true;
  });

  return <line geometry={geometry} material={material} renderOrder={20} />;
}

const labelA = new Vector3();
const labelB = new Vector3();

// Label at a distance's midpoint, or at an angle's vertex; updated each frame.
function MeasureLabel({ points, text, warn }) {
  const anchor = useRef();
  useFrame(() => {
    if (!anchor.current) return;
    if (points.length === 2) {
      const a = worldPointOf(points[0], labelA);
      const b = worldPointOf(points[1], labelB);
      if (a && b) anchor.current.position.copy(a).add(b).multiplyScalar(0.5);
    } else {
      const vertex = worldPointOf(points[1], labelA);
      if (vertex) anchor.current.position.copy(vertex);
    }
  });
  return (
    <group ref={anchor}>
      <Html center className={`measure-label${warn ? ' is-warn' : ''}`} zIndexRange={[20, 0]}>
        {text}
      </Html>
    </group>
  );
}

function SnapMarker({ snap }) {
  const ref = useRef();
  useFrame(() => {
    if (ref.current && snap) {
      const world = worldPointOf(snap, scratch);
      if (world) ref.current.position.copy(world);
    }
  });
  if (!snap) return null;
  return (
    <group ref={ref}>
      <Html center className={`snap-marker snap-${snap.kind}`} zIndexRange={[30, 0]}>
        <span style={{ borderColor: SNAP_COLORS[snap.kind] }} />
      </Html>
    </group>
  );
}

export default function Measurements() {
  const { tool, draft, hover, measurements } = useMeasureStore();
  const unit = useViewerStore((s) => s.lengthUnit);

  return (
    <>
      {measurements.map((m) => (
        <group key={m.id}>
          <MeasureLine points={m.points} />
          <MeasureLabel
            points={m.points}
            text={m.type === 'distance' ? formatLength(m.value, unit, { precise: true }) : `${m.value.toFixed(1)}°`}
            warn={m.exploded}
          />
        </group>
      ))}
      {draft.length > 0 && <MeasureLine points={draft} extra={hover} dashed />}
      {tool !== 'off' && <SnapMarker snap={hover} />}
    </>
  );
}
