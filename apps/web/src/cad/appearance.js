// How a part looks: the material it's made of (which also gives its mass), a colour, and
// a surface finish. A part's appearance is data, saved with the design or assembly.

import { MATERIAL_LIBRARY } from '../config';

export const FINISHES = {
  matte: { label: 'Matte', roughness: 0.85 },
  satin: { label: 'Satin', roughness: 0.5 },
  polished: { label: 'Polished', roughness: 0.18 },
};

export const DEFAULT_APPEARANCE = Object.freeze({ materialId: 'aluminium', color: null, finish: 'satin' });

const HEX = /^#[0-9a-f]{6}$/i;

export const materialOf = (appearance) => MATERIAL_LIBRARY.find((m) => m.id === appearance?.materialId) ?? null;

// Anything from a file or storage → a valid appearance. `allowNoMaterial`: a model's paint
// has a colour and finish but keeps the materials (and masses) of its CAD file.
export function normaliseAppearance(raw, { allowNoMaterial = false } = {}) {
  if (!raw || typeof raw !== 'object') return allowNoMaterial ? null : { ...DEFAULT_APPEARANCE };
  const material = MATERIAL_LIBRARY.find((m) => m.id === raw.materialId);
  return {
    materialId: material ? material.id : allowNoMaterial ? null : DEFAULT_APPEARANCE.materialId,
    color: typeof raw.color === 'string' && HEX.test(raw.color) ? raw.color.toLowerCase() : null,
    finish: FINISHES[raw.finish] ? raw.finish : DEFAULT_APPEARANCE.finish,
  };
}

// → { color, metalness, roughness, opacity } for a three.js standard material.
export function surfaceOf(appearance) {
  const material = materialOf(appearance);
  const finish = FINISHES[appearance?.finish] ?? FINISHES.satin;
  const glass = material?.id === 'glass';
  return {
    color: appearance?.color ?? material?.color ?? '#9aa4ad',
    // Moderate: the scene has lights but no reflections, and full metal would look black.
    metalness: material?.metal ? 0.5 : 0.05,
    roughness: glass ? 0.05 : finish.roughness,
    opacity: glass ? 0.45 : 1,
  };
}

// "Aluminium 6061 · satin" / "Painted #ff0000 · polished"
export function describeAppearance(appearance) {
  if (!appearance) return 'as in the CAD file';
  const material = materialOf(appearance);
  const finish = (FINISHES[appearance.finish] ?? FINISHES.satin).label.toLowerCase();
  const base = material ? material.name : 'Painted';
  return `${base}${appearance.color ? ` ${appearance.color}` : ''} · ${finish}`;
}
