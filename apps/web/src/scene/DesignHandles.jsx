import { useEffect, useMemo, useRef } from 'react';
import { createPortal, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Quaternion, Ray, Vector2, Vector3 } from 'three';
import { useShallow } from 'zustand/react/shallow';
import { handlesFor, lockedReason } from '../cad/handles';
import { useDesignStore } from '../store/designStore';
import { registerHandleQueries } from './handleQueries';

const GRAB_PX = 14;
const COLOR = { idle: '#ffd23f', hot: '#ffffff', locked: '#7d858c' };
const UP = new Vector3(0, 1, 0);

// The handles to show: the selected feature's, or the base shape's.
function useHandles() {
  const d = useDesignStore(
    useShallow((s) => ({
      features: s.features,
      resolved: s.resolvedFeatures,
      parameters: s.parameters,
      selectedFeatureId: s.selectedFeatureId,
      top: s.part?.properties.boundsMm?.max[2] ?? 0,
    })),
  );
  return useMemo(() => {
    const id = d.selectedFeatureId ?? d.features[0]?.id;
    const raw = d.features.find((f) => f.id === id);
    const feature = d.resolved.find((f) => f.id === id);
    return raw && feature ? handlesFor(feature, raw, d.parameters, d.top) : [];
  }, [d]);
}

function Arrow({ handle, length, color }) {
  const quaternion = useMemo(() => new Quaternion().setFromUnitVectors(UP, new Vector3(...handle.dir)), [handle.dir]);
  const props = { depthTest: false, transparent: true, toneMapped: false };
  return (
    <group position={handle.origin} quaternion={quaternion} renderOrder={20}>
      <mesh position={[0, length * 0.4, 0]} renderOrder={20}>
        <cylinderGeometry args={[length * 0.035, length * 0.035, length * 0.8, 8]} />
        <meshBasicMaterial color={color} {...props} />
      </mesh>
      <mesh position={[0, length * 0.9, 0]} renderOrder={20}>
        <coneGeometry args={[length * 0.12, length * 0.25, 16]} />
        <meshBasicMaterial color={color} {...props} />
      </mesh>
    </group>
  );
}

function Pad({ handle, length, color }) {
  return (
    <mesh position={handle.origin} rotation={[Math.PI / 2, 0, 0]} renderOrder={20}>
      <torusGeometry args={[length * 0.16, length * 0.035, 8, 32]} />
      <meshBasicMaterial color={color} depthTest={false} transparent toneMapped={false} />
    </mesh>
  );
}

// Grab handles on the part being designed (see cad/handles.js), drawn on top of it in its
// own frame, and the screen-space maths to grab and drag them.
export default function DesignHandles({ content }) {
  const handles = useHandles();
  const { camera, size } = useThree();
  const frame = useDesignStore((s) => s.frame);
  const hoverId = useDesignStore((s) => s.hoverHandleId);
  const drag = useDesignStore((s) => s.drag);
  const length = (frame?.radius ?? 0.1) * 0.22; // metres, in the part's frame
  const current = useRef(handles);
  current.current = handles;

  useEffect(() => {
    const a = new Vector3();
    const b = new Vector3();
    const screenA = new Vector2();
    const screenB = new Vector2();
    const cursor = new Vector2();
    const toScreen = (v, out) => {
      const p = v.clone().project(camera);
      return out.set(((p.x + 1) / 2) * size.width, ((1 - p.y) / 2) * size.height);
    };
    const rayAt = (x, y) => {
      const ndc = new Vector2((x / size.width) * 2 - 1, 1 - (y / size.height) * 2);
      const ray = new Ray();
      ray.origin.setFromMatrixPosition(camera.matrixWorld);
      ray.direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(ray.origin).normalize();
      return ray;
    };
    const world = (local) => content.localToWorld(new Vector3(...local));

    function handleAt(x, y) {
      cursor.set(x, y);
      let best = null;
      let bestPx = GRAB_PX;
      for (const handle of current.current) {
        let px;
        if (handle.kind === 'axis') {
          a.copy(world(handle.origin));
          b.copy(world(handle.origin.map((v, i) => v + handle.dir[i] * length)));
          toScreen(a, screenA);
          toScreen(b, screenB);
          const d = screenB.clone().sub(screenA);
          const t = Math.max(0, Math.min(1, cursor.clone().sub(screenA).dot(d) / Math.max(d.lengthSq(), 1e-9)));
          px = screenA.clone().addScaledVector(d, t).distanceTo(cursor);
        } else {
          px = toScreen(world(handle.origin), screenA).distanceTo(cursor);
        }
        if (px < bestPx) {
          bestPx = px;
          best = handle;
        }
      }
      return best;
    }

    // Axis: mm along the axis where the pointer's ray passes closest. Plane: CAD (x, y) mm
    // where the ray meets the horizontal plane through the handle.
    function handlePosition(handle, x, y) {
      const ray = rayAt(x, y);
      const origin = world(handle.origin);
      if (handle.kind === 'axis') {
        const dir = world(handle.origin.map((v, i) => v + handle.dir[i])).sub(origin).normalize();
        const w0 = origin.clone().sub(ray.origin);
        const bDot = dir.dot(ray.direction);
        const denom = 1 - bDot * bDot;
        if (denom < 1e-6) return null; // looking straight down the axis
        const s = (bDot * ray.direction.dot(w0) - dir.dot(w0)) / denom;
        const local = content.worldToLocal(origin.clone().addScaledVector(dir, s));
        return local.toArray().reduce((sum, v, i) => sum + (v - handle.origin[i]) * handle.dir[i], 0) * 1000;
      }
      const normal = world(handle.origin.map((v, i) => v + (i === 1 ? 1 : 0))).sub(origin).normalize();
      const along = normal.dot(ray.direction);
      if (Math.abs(along) < 1e-6) return null; // looking edge-on at the plane
      const t = normal.dot(origin.clone().sub(ray.origin)) / along;
      if (t < 0) return null;
      const local = content.worldToLocal(ray.at(t, new Vector3()));
      return [local.x * 1000, -local.z * 1000]; // viewer → CAD (x, y)
    }

    return registerHandleQueries({ handleAt, handlePosition });
  }, [camera, size, content, length]);

  const hot = drag?.handleId ?? hoverId;
  const shown = handles.find((h) => h.id === hot);
  const labelText =
    drag?.text ?? (shown ? `${shown.label}${lockedReason(shown) ? ` · ${lockedReason(shown)}` : ' · drag'}` : null);
  const labelAt = shown
    ? shown.kind === 'axis'
      ? shown.origin.map((v, i) => v + shown.dir[i] * length * 1.15)
      : shown.origin
    : null;

  return createPortal(
    <group>
      {handles.map((handle) => {
        const color = lockedReason(handle) ? COLOR.locked : handle.id === hot ? COLOR.hot : COLOR.idle;
        return handle.kind === 'axis' ? (
          <Arrow key={handle.id} handle={handle} length={length} color={color} />
        ) : (
          <Pad key={handle.id} handle={handle} length={length} color={color} />
        );
      })}
      {labelText && labelAt && (
        <Html position={labelAt} zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
          <div className="handle-label">{labelText}</div>
        </Html>
      )}
    </group>,
    content,
  );
}
