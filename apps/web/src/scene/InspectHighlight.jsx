import { useEffect, useMemo } from 'react';
import { createPortal } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { BufferGeometry, DoubleSide, MeshBasicMaterial } from 'three';
import { useShallow } from 'zustand/react/shallow';
import { productForSpec } from '../models/partFaces';
import { useSpecStore } from '../store/specStore';
import { useUiStore } from '../store/uiStore';

const COLOR = '#ff4fd8'; // apart from the cyan hologram and the yellow selection

// The node frame of a part's mesh (face/edge points are in it), and the mesh holding
// a given primitive of that node.
function nodeOf(mesh) {
  return mesh.userData.specIndex !== undefined ? mesh : mesh.parent;
}
function primitiveMesh(mesh, primitive) {
  if (mesh.userData.specIndex !== undefined) return mesh;
  return mesh.parent.children.filter((child) => child.isMesh)[primitive] ?? null;
}

function FaceOverlay({ mesh, range, clipPlanes }) {
  const [, first, count] = range;
  // Shares the part's own vertex and index buffers; only draws this face's triangles.
  const geometry = useMemo(() => {
    const overlay = new BufferGeometry();
    overlay.setAttribute('position', mesh.geometry.attributes.position);
    if (mesh.geometry.index) overlay.setIndex(mesh.geometry.index);
    overlay.setDrawRange(first * 3, count * 3);
    return overlay;
  }, [mesh, first, count]);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: COLOR,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        clippingPlanes: clipPlanes,
      }),
    [clipPlanes],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return createPortal(<mesh geometry={geometry} material={material} renderOrder={10} raycast={() => null} />, mesh);
}

function EdgeOverlay({ node, points }) {
  const vertices = useMemo(() => {
    const out = [];
    for (let i = 0; i + 2 < points.length; i += 3) out.push([points[i], points[i + 1], points[i + 2]]);
    return out;
  }, [points]);
  return createPortal(
    <Line points={vertices} color={COLOR} lineWidth={3} depthTest={false} renderOrder={11} raycast={() => null} />,
    node,
  );
}

// Highlights the face or edge under the cursor (or, when not hovering, the one picked).
export default function InspectHighlight({ partsById, clipPlanes }) {
  const { hover, pinned, faces } = useSpecStore(
    useShallow((s) => ({ hover: s.hover, pinned: s.pinned, faces: s.faces })),
  );
  const open = useUiStore((s) => s.hudTab === 'specs');
  const item = open ? (hover ?? pinned) : null;
  const mesh = item ? partsById.get(item.partId)?.mesh : null;
  const product = item ? productForSpec(faces, item.specIndex) : null;
  if (!mesh || !product) return null;

  if (item.kind === 'edge') {
    const edge = product.edges[item.index];
    return edge ? <EdgeOverlay key={`e${item.partId}-${item.index}`} node={nodeOf(mesh)} points={edge.points} /> : null;
  }
  const face = product.faces[item.index];
  const target = face && primitiveMesh(mesh, face.tri[0]);
  return target ? (
    <FaceOverlay key={`f${item.partId}-${item.index}`} mesh={target} range={face.tri} clipPlanes={clipPlanes} />
  ) : null;
}
