import { useEffect, useMemo } from 'react';
import { createPortal, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Raycaster, Vector2, Vector3 } from 'three';
import { useAssemblyStore } from '../store/assemblyStore';
import { useViewerStore } from '../store/viewerStore';
import { describeGeometry, faceTriangles, fitFace } from '../cad/assembly';
import { faceAtTriangle, productForSpec } from '../models/partFaces';
import { clearSelection, selectParts } from '../actions/viewerActions';
import { LoadedModel } from './ModelViewer';
import { assemblyScene, contentOf, facesFor } from './assemblyContent';
import { applyAppearance } from './applyAppearance';
import { appearanceOf } from '../models/assemblyBom';
import { registerAssemblyQueries } from './assemblyQueries';
import { isPickable } from './picking';

// The ASSEMBLE workspace's parts, put together into one model and shown through the same
// viewer as any other: hologram, selection, measuring and sections all work on it. Each
// part is a group (userData.componentId) placed where cad/assembly.js solved it to be.
export default function AssemblyModel() {
  const components = useAssemblyStore((s) => s.components);
  const contentVersion = useAssemblyStore((s) => s.contentVersion);
  const frame = useAssemblyStore((s) => s.frame);
  const name = useAssemblyStore((s) => s.name);
  // A new scene only when parts come or go (or their geometry arrives); moving a part
  // just moves its group.
  const structure = components.map((c) => `${c.id}\u0000${c.name}`).join('\u0001');

  const scene = useMemo(() => {
    const root = assemblyScene(components, useAssemblyStore.getState().placements, name);
    return root.children.length ? root : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, contentVersion]);

  // Each part's look, applied to its loaded materials (shared by every copy drawn).
  useEffect(() => {
    for (const component of components) applyAppearance(contentOf(component.id)?.object, appearanceOf(component));
  }, [components, contentVersion]);

  return scene ? <LoadedModel scene={scene} frame={frame} overlay={(content) => <AssemblyOverlay content={content} />} /> : null;
}

const HIGHLIGHT = { hover: '#ffd23f', pick: '#3fe0ff' };
const noRaycast = () => {};

function FaceHighlight({ face, color }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(face.highlight, 3));
    return g;
  }, [face]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} raycast={noRaycast} renderOrder={15}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.55}
        side={DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-4}
        polygonOffsetUnits={-4}
        toneMapped={false}
      />
    </mesh>
  );
}

function componentIdOf(object) {
  for (let node = object; node; node = node.parent) if (node.userData.componentId) return node;
  return null;
}

// Placements, picking queries, face highlights and selection, in the assembly's own frame.
function AssemblyOverlay({ content }) {
  const { camera, size } = useThree();
  const hoverFace = useAssemblyStore((s) => s.hoverFace);
  const pick = useAssemblyStore((s) => s.pick);
  const drag = useAssemblyStore((s) => s.drag);
  const selectedComponentId = useAssemblyStore((s) => s.selectedComponentId);
  const viewerParts = useViewerStore((s) => s.parts); // registered after this overlay mounts
  const nodes = useMemo(() => {
    const map = new Map();
    for (const child of content.children) if (child.userData.componentId) map.set(child.userData.componentId, child);
    return map;
  }, [content]);

  // Parts go where the solver puts them.
  useEffect(() => {
    const apply = ({ placements, components }) => {
      for (const component of components) {
        const node = nodes.get(component.id);
        const placement = placements[component.id];
        if (!node || !placement) continue;
        node.position.fromArray(placement.position);
        node.quaternion.fromArray(placement.quaternion);
        node.updateMatrixWorld(true);
      }
    };
    apply(useAssemblyStore.getState());
    return useAssemblyStore.subscribe((state, previous) => {
      if (state.placements !== previous.placements) apply(state);
    });
  }, [nodes]);

  // The selected part glows like any selection in the viewer.
  useEffect(() => {
    const node = nodes.get(selectedComponentId);
    if (!node) {
      clearSelection();
      return;
    }
    const ids = [];
    node.traverse((child) => child.isMesh && child.userData.partId && ids.push(child.userData.partId));
    selectParts(ids);
  }, [nodes, selectedComponentId, viewerParts]);

  useEffect(() => {
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const hits = [];
    const faceCache = new Map();

    function hitAt(x, y) {
      ndc.set((x / size.width) * 2 - 1, 1 - (y / size.height) * 2);
      raycaster.setFromCamera(ndc, camera);
      hits.length = 0;
      raycaster.intersectObject(content, true, hits);
      return hits.find(isPickable) ?? null;
    }

    function rayAt(x, y) {
      ndc.set((x / size.width) * 2 - 1, 1 - (y / size.height) * 2);
      raycaster.setFromCamera(ndc, camera);
      const origin = content.worldToLocal(raycaster.ray.origin.clone());
      const along = content.worldToLocal(raycaster.ray.origin.clone().add(raycaster.ray.direction));
      return { origin: origin.toArray(), direction: along.sub(origin).normalize().toArray() };
    }

    function viewDirection() {
      const origin = content.worldToLocal(camera.position.clone());
      const ahead = content.worldToLocal(camera.getWorldDirection(new Vector3()).add(camera.position));
      return ahead.sub(origin).normalize().toArray();
    }

    function componentAt(x, y) {
      const hit = hitAt(x, y);
      const node = hit && componentIdOf(hit.object);
      if (!node) return null;
      return { componentId: node.userData.componentId, point: content.worldToLocal(hit.point.clone()).toArray() };
    }

    // The CAD face under the pixel: its triangles come from the design's face groups or
    // the converter's face data; without either, the triangle itself (a flat spot).
    function faceAt(x, y) {
      const hit = hitAt(x, y);
      const node = hit && componentIdOf(hit.object);
      if (!node || hit.faceIndex === undefined || hit.faceIndex === null) return null;
      const mesh = hit.object;
      let range = [hit.faceIndex, 1];
      const groups = mesh.userData.faceGroups;
      const link = mesh.userData.assemblyFace;
      if (groups) {
        range = groups.find(([first, count]) => hit.faceIndex >= first && hit.faceIndex < first + count) ?? range;
      } else if (link) {
        const product = productForSpec(facesFor(link.modelId), link.specIndex);
        const index = product ? faceAtTriangle(product, link.primitive, hit.faceIndex) : -1;
        if (index >= 0) range = product.faces[index].tri.slice(1);
      }
      const componentId = node.userData.componentId;
      const key = `${componentId}:${mesh.uuid}:${range[0]}:${range[1]}`;
      if (!faceCache.has(key)) {
        node.updateMatrixWorld(true);
        const toPart = new Matrix4().copy(node.matrixWorld).invert().multiply(mesh.matrixWorld);
        const { points, normals } = faceTriangles(mesh.geometry, range[0], range[1], toPart);
        const geometry = fitFace(points, normals);
        if (!geometry) return null;
        const flatSpot = range[1] === 1 && !groups && !link;
        const label = `${node.name} · ${flatSpot ? 'flat spot' : describeGeometry(geometry)}`;
        faceCache.set(key, { componentId, geometry, label, key, highlight: points });
      }
      return faceCache.get(key);
    }

    return registerAssemblyQueries({ componentAt, faceAt, rayAt, viewDirection });
  }, [camera, size, content]);

  const dragNode = drag && nodes.get(drag.componentId);
  const dragBox = drag && contentOf(drag.componentId)?.box;

  return (
    <>
      {[
        [hoverFace, HIGHLIGHT.hover],
        [pick, HIGHLIGHT.pick],
      ].map(([face, color]) => {
        const node = face && nodes.get(face.componentId);
        return node ? <Portal key={color} node={node}><FaceHighlight face={face} color={color} /></Portal> : null;
      })}
      {dragNode && dragBox && (
        <Portal node={dragNode}>
          <Html position={dragBox.max.map((v, i) => (i === 1 ? v : (v + dragBox.min[i]) / 2))} zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
            <div className="handle-label">{drag.text}</div>
          </Html>
        </Portal>
      )}
    </>
  );
}

const Portal = ({ node, children }) => createPortal(children, node);
