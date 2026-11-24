import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// A three.js object as a binary glTF (.glb) blob: metres, Y up, materials included. The
// CAD edge lines drawn over parts are left out (they're for the screen, not the model).
export async function glbOf(object) {
  const copy = object.clone(true);
  const lines = [];
  copy.traverse((child) => child.isLineSegments && lines.push(child));
  for (const line of lines) line.removeFromParent();
  copy.traverse((child) => {
    // Our bookkeeping (face ranges, links) isn't part of the model.
    if (child.userData) child.userData = child.userData.name ? { name: child.userData.name } : {};
  });
  const buffer = await new GLTFExporter().parseAsync(copy, { binary: true, onlyVisible: false });
  return new Blob([buffer], { type: 'model/gltf-binary' });
}
