import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial } from 'three';

// A built design part (cad/buildPart.js describePart) as a three.js object: the faces as
// one mesh, the CAD edges drawn over them so the shape reads clearly at any zoom.
// The mesh carries the part's face triangle ranges (userData.faceGroups) for picking faces.
export function designObject(part, name, color = '#9aa4ad') {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(part.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(part.normals, 3));
  geometry.setIndex(new BufferAttribute(part.indices, 1));
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.5 }));
  mesh.name = name;
  mesh.userData.faceGroups = part.faceGroups;
  const edgeGeometry = new BufferGeometry();
  edgeGeometry.setAttribute('position', new BufferAttribute(part.edgeLines, 3));
  const edges = new LineSegments(edgeGeometry, new LineBasicMaterial({ color: '#d8fbff', transparent: true, opacity: 0.8 }));
  edges.raycast = () => {}; // never picked; the faces are
  mesh.add(edges);
  const group = new Group();
  group.name = name;
  group.add(mesh);
  return group;
}

export function disposeObject(object) {
  object?.traverse((child) => {
    child.geometry?.dispose();
    child.material?.dispose?.();
  });
}
