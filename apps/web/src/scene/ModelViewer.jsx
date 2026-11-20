import { Fragment, useEffect, useMemo, useRef } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Matrix4, Vector3 } from 'three';
import { useViewerStore } from '../store/viewerStore';
import { modelLoaded } from '../actions/viewerActions';
import { HOLOGRAM, VIEW } from '../config';
import { prepareModel } from './prepareModel';
import { createHologramMaterial } from './hologramMaterial';
import { createPicker, registerPicker } from './picking';
import { useModelFile } from './useModelFile';

// Scratch objects reused every frame.
const targetPosition = new Vector3();
const targetPull = new Vector3();
const localDelta = new Vector3();
const localOrigin = new Vector3();
const parentInverse = new Matrix4();

function damp(current, target, damping, dt) {
  return current + (target - current) * (1 - Math.exp(-damping * dt));
}

// A world-space offset, expressed in the mesh parent's local space (rotation and
// scale of the model group included).
function worldOffsetToLocal(parent, offset, out) {
  parentInverse.copy(parent.matrixWorld).invert();
  localOrigin.set(0, 0, 0).applyMatrix4(parentInverse);
  return out.copy(offset).applyMatrix4(parentInverse).sub(localOrigin);
}

function positionPart(part, explodeFactor) {
  part.mesh.position.copy(part.basePosition).addScaledVector(part.explodeOffset, explodeFactor);
  if (part.pull.lengthSq() > 0) {
    part.mesh.position.add(worldOffsetToLocal(part.mesh.parent, part.pull, localDelta));
  }
}

function PartLabels({ parts }) {
  const labels = useViewerStore((s) => s.labels);
  const exploded = useViewerStore((s) => s.explodeTarget > 0.05);
  if (!labels || !exploded) return null;

  // Portal each label into its mesh so it rides along with the explode offset.
  return parts.slice(0, VIEW.maxLabels).map((part) => (
    <Fragment key={part.id}>
      {createPortal(
        <Html center className="part-label" zIndexRange={[10, 0]}>
          {part.info.name}
        </Html>,
        part.mesh,
      )}
    </Fragment>
  ));
}

export default function ModelViewer({ url }) {
  const gltf = useModelFile(url);
  return gltf ? <LoadedModel scene={gltf.scene} /> : null;
}

function LoadedModel({ scene }) {
  const { root, parts, metresPerSceneUnit, modelSize } = useMemo(() => prepareModel(scene), [scene]);
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const hologramMaterial = useMemo(() => createHologramMaterial(), []);
  const selectedMaterial = useMemo(() => createHologramMaterial(HOLOGRAM.selectedColor), []);
  const materialMode = useViewerStore((s) => s.materialMode);
  const selectedPartId = useViewerStore((s) => s.selectedPartId);
  const camera = useThree((s) => s.camera);

  const groupRef = useRef();
  const explodeRef = useRef(0);
  const pulledParts = useRef(new Set()); // parts with a non-zero pull to animate

  useEffect(() => {
    modelLoaded(parts.map((p) => p.info), { metresPerSceneUnit, modelSize });
  }, [parts, metresPerSceneUnit, modelSize]);

  useEffect(() => registerPicker(createPicker(root, camera)), [root, camera]);

  useEffect(() => {
    for (const part of parts) {
      const base = materialMode === 'hologram' ? hologramMaterial : part.originalMaterial;
      part.mesh.material = part.id === selectedPartId ? selectedMaterial : base;
    }
  }, [parts, materialMode, selectedPartId, hologramMaterial, selectedMaterial]);

  useEffect(
    () => () => {
      hologramMaterial.dispose();
      selectedMaterial.dispose();
    },
    [hologramMaterial, selectedMaterial],
  );

  useFrame((state, dt) => {
    const group = groupRef.current;
    const viewer = useViewerStore.getState();
    const k = 1 - Math.exp(-VIEW.transformDamping * dt);

    group.visible = viewer.modelVisible;
    group.position.lerp(targetPosition.fromArray(viewer.position), k);
    group.rotation.x += (viewer.rotation[0] - group.rotation.x) * k;
    group.rotation.y += (viewer.rotation[1] - group.rotation.y) * k;
    group.rotation.z += (viewer.rotation[2] - group.rotation.z) * k;
    group.scale.setScalar(damp(group.scale.x, viewer.scale, VIEW.transformDamping, dt));

    const previousExplode = explodeRef.current;
    const explode = damp(previousExplode, viewer.explodeTarget, VIEW.explodeDamping, dt);
    const explodeChanged = Math.abs(explode - previousExplode) > 1e-4;
    if (explodeChanged) explodeRef.current = explode;

    const selected = partsById.get(viewer.selectedPartId);
    if (selected) pulledParts.current.add(selected);

    const pullK = 1 - Math.exp(-VIEW.pullDamping * dt);
    for (const part of pulledParts.current) {
      if (part === selected) targetPull.fromArray(viewer.partPull);
      else targetPull.set(0, 0, 0);
      part.pull.lerp(targetPull, pullK);
      if (part !== selected && part.pull.lengthSq() < 1e-6) {
        part.pull.set(0, 0, 0);
        pulledParts.current.delete(part);
      }
      if (!explodeChanged) positionPart(part, explodeRef.current);
    }

    if (explodeChanged) for (const part of parts) positionPart(part, explode);

    const time = state.clock.elapsedTime;
    hologramMaterial.uniforms.uTime.value = time;
    selectedMaterial.uniforms.uTime.value = time;
  });

  return (
    <group ref={groupRef}>
      <primitive object={root} />
      <PartLabels parts={parts} />
    </group>
  );
}
