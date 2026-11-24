import { Color } from 'three';
import { surfaceOf } from '../cad/appearance';

// Restyles the meshes of an object in place: their materials are the object's own (never a
// loaded model's shared ones), so every copy drawn from it follows. null: back to how each
// material first looked.
export function applyAppearance(object, appearance) {
  const surface = appearance ? surfaceOf(appearance) : null;
  object?.traverse((child) => {
    if (!child.isMesh) return;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (!material?.isMeshStandardMaterial) continue;
      material.userData.original ??= {
        color: material.color.getHex(),
        metalness: material.metalness,
        roughness: material.roughness,
        opacity: material.opacity,
        transparent: material.transparent,
      };
      const o = material.userData.original;
      material.color.copy(surface ? new Color(surface.color) : new Color(o.color));
      material.metalness = surface ? surface.metalness : o.metalness;
      material.roughness = surface ? surface.roughness : o.roughness;
      material.opacity = surface ? surface.opacity : o.opacity;
      const transparent = surface ? surface.opacity < 1 : o.transparent;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
    }
  });
}
