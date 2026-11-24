import { Fragment, useEffect, useMemo, useRef } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { DoubleSide, Matrix4, Plane, Vector3 } from 'three';
import { useViewerStore } from '../store/viewerStore';
import { modelLoaded } from '../actions/viewerActions';
import { HOLOGRAM, VIEW } from '../config';
import { prepareModel } from './prepareModel';
import { tagSpecIndices } from '../models/partSpecs';
import { createHologramMaterial } from './hologramMaterial';
import { createPicker, registerPicker } from './picking';
import { registerSceneQueries } from './sceneQueries';
import { createSceneQueries } from './snapping';
import { sectionPlane } from './sectionPlane';
import SectionPlaneGizmo from './SectionPlaneGizmo';
import InspectHighlight from './InspectHighlight';
import RulerGrid from './RulerGrid';
import { useModelFile } from './useModelFile';

// Scratch objects reused every frame.
const targetPosition = new Vector3();
const localPlane = new Plane();
const worldPlane = new Plane();
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
  const hiddenPartIds = useViewerStore((s) => s.hiddenPartIds);
  if (!labels || !exploded) return null;

  const hidden = new Set(hiddenPartIds);
  const visible = parts.filter((part) => !hidden.has(part.id));
  // Portal each label into its mesh so it rides along with the explode offset.
  return visible.slice(0, VIEW.maxLabels).map((part) => (
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
  if (gltf) tagSpecIndices(gltf); // idempotent; links parts to the converter's specs
  return gltf ? <LoadedModel scene={gltf.scene} /> : null;
}

// overlay(content): extra scene content drawn in the model's own frame (design handles).
export function LoadedModel({ scene, frame = null, overlay = null }) {
  const { root, parts, metresPerSceneUnit, modelSize, modelBounds } = useMemo(
    () => prepareModel(scene, { frame }),
    [scene, frame],
  );
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const hologramMaterial = useMemo(() => createHologramMaterial(), []);
  const selectedMaterial = useMemo(() => createHologramMaterial(HOLOGRAM.selectedColor), []);
  // Additive blending: a darker colour simply glows less, which reads as "see-through".
  const xrayHologramMaterial = useMemo(() => createHologramMaterial(HOLOGRAM.xrayColor), []);
  const xrayOriginals = useRef(new Map()); // part id -> translucent clone of its own material
  const materialMode = useViewerStore((s) => s.materialMode);
  const selectedPartIds = useViewerStore((s) => s.selectedPartIds);
  const hiddenPartIds = useViewerStore((s) => s.hiddenPartIds);
  const xrayPartIds = useViewerStore((s) => s.xrayPartIds);
  const sectionActive = useViewerStore((s) => s.section.axis !== null);
  const camera = useThree((s) => s.camera);
  // One clipping-plane list shared by every model material; holds the section plane
  // (updated each frame) or nothing. Overlays (rings, labels, measurements) aren't cut.
  const clipPlanes = useMemo(() => [], []);
  const size = useThree((s) => s.size);

  const groupRef = useRef();
  const explodeRef = useRef(0);
  const pulledParts = useRef(new Set()); // parts with a non-zero pull to animate

  useEffect(() => {
    modelLoaded(
      parts.map((p) => p.info),
      { metresPerSceneUnit, modelSize, modelBounds },
    );
  }, [parts, metresPerSceneUnit, modelSize, modelBounds]);

  useEffect(() => registerPicker(createPicker(root, camera)), [root, camera]);

  useEffect(() => {
    const meshById = new Map(parts.map((p) => [p.id, p.mesh]));
    const content = root.children[0];
    return registerSceneQueries(createSceneQueries({ root, content, group: groupRef.current, camera, size, meshById }));
  }, [root, parts, camera, size]);

  useEffect(() => {
    const selected = new Set(selectedPartIds);
    const hidden = new Set(hiddenPartIds);
    const xray = new Set(xrayPartIds);
    for (const part of parts) {
      // Hidden meshes are skipped by the renderer and by picking.
      part.mesh.visible = !hidden.has(part.id);
      const material = selected.has(part.id)
        ? selectedMaterial
        : xray.has(part.id)
          ? xrayMaterialFor(part)
          : materialMode === 'hologram'
            ? hologramMaterial
            : part.originalMaterial;
      material.clippingPlanes = clipPlanes;
      showInsideWhenCut(material);
      part.mesh.material = material;
    }

    // A cut-open solid shows its inside walls; solid materials normally skip back faces.
    function showInsideWhenCut(material) {
      if (material.isShaderMaterial) return; // hologram materials are already two-sided
      material.userData.sideBeforeSection ??= material.side;
      const side = sectionActive ? DoubleSide : material.userData.sideBeforeSection;
      if (material.side !== side) {
        material.side = side;
        material.needsUpdate = true;
      }
    }

    function xrayMaterialFor(part) {
      if (materialMode === 'hologram') return xrayHologramMaterial;
      let clone = xrayOriginals.current.get(part.id);
      if (!clone) {
        clone = part.originalMaterial.clone();
        Object.assign(clone, { transparent: true, opacity: HOLOGRAM.xrayOpacity, depthWrite: false });
        xrayOriginals.current.set(part.id, clone);
      }
      return clone;
    }
  }, [
    parts,
    materialMode,
    selectedPartIds,
    hiddenPartIds,
    xrayPartIds,
    sectionActive,
    clipPlanes,
    hologramMaterial,
    selectedMaterial,
    xrayHologramMaterial,
  ]);

  useEffect(
    () => () => {
      hologramMaterial.dispose();
      selectedMaterial.dispose();
      xrayHologramMaterial.dispose();
      for (const clone of xrayOriginals.current.values()) clone.dispose();
      xrayOriginals.current.clear();
    },
    [hologramMaterial, selectedMaterial, xrayHologramMaterial],
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

    // Section: the plane is defined in the model's own space; carry it into world space
    // so the cut turns, moves and zooms with the model.
    const plane = sectionPlane(viewer.section, viewer.modelBounds);
    if (plane) {
      localPlane.normal.fromArray(plane.normal);
      localPlane.constant = plane.constant;
      worldPlane.copy(localPlane).applyMatrix4(root.children[0].matrixWorld);
      if (clipPlanes[0] !== worldPlane) clipPlanes.splice(0, clipPlanes.length, worldPlane);
    } else if (clipPlanes.length) {
      clipPlanes.length = 0;
    }

    const time = state.clock.elapsedTime;
    hologramMaterial.uniforms.uTime.value = time;
    selectedMaterial.uniforms.uTime.value = time;
    xrayHologramMaterial.uniforms.uTime.value = time;
  });

  return (
    <group ref={groupRef}>
      <primitive object={root} />
      <PartLabels parts={parts} />
      <SectionPlaneGizmo content={root.children[0]} bounds={modelBounds} />
      <InspectHighlight partsById={partsById} clipPlanes={clipPlanes} />
      <RulerGrid content={root.children[0]} bounds={modelBounds} />
      {overlay?.(root.children[0])}
    </group>
  );
}
