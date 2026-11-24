// Bill of materials for an assembly: its parts, identical ones grouped with a quantity,
// with material and mass. Designed parts weigh what their material says; models weigh what
// their CAD file's materials say (when it has them).

import { materialOf } from '../cad/appearance';
import { massKg } from './partSpecs';
import { csvCell } from './bom';

// component → the look it's drawn with: its own, else (a designed part) its design's;
// a model with no paint keeps its CAD file's look (null).
export function appearanceOf(component) {
  if (component.appearance) return component.appearance;
  return component.source.kind === 'design' ? (component.source.design.appearance ?? null) : null;
}

// components: the assembly's parts; info: componentId → loadContent info (or missing while
// loading).
export function buildAssemblyBom(components, info) {
  const rows = [];
  const byKey = new Map();
  for (const component of components) {
    const appearance = appearanceOf(component);
    const material = component.source.kind === 'design' ? materialOf(appearance) : null;
    const details = info[component.id] ?? null;
    const sourceKey = component.source.kind === 'design' ? JSON.stringify(component.source.design.features) : component.source.modelId;
    const key = `${component.name.replace(/ \d+$/, '')}|${sourceKey}|${material?.id ?? ''}`;
    let row = byKey.get(key);
    if (!row) {
      const unitMass =
        component.source.kind === 'design' ? massKg(details?.volumeMm3, material?.density) : (details?.massKg ?? null);
      row = {
        item: rows.length + 1,
        name: component.name.replace(/ \d+$/, ''),
        kind: component.source.kind === 'design' ? 'Designed part' : 'Model',
        quantity: 0,
        material: material?.name ?? (component.source.kind === 'model' ? 'From CAD file' : ''),
        unitMassKg: unitMass,
        totalMassKg: null,
        // A model's mass is only partly known when some of its parts have no material.
        massNote: component.source.kind === 'model' && details?.partsWithoutMass ? `${details.partsWithoutMass} parts without mass` : '',
        sizeMm: details?.sizeMm ?? null,
      };
      rows.push(row);
      byKey.set(key, row);
    }
    row.quantity += 1;
  }
  for (const row of rows) row.totalMassKg = row.unitMassKg == null ? null : row.unitMassKg * row.quantity;
  const withMass = rows.filter((r) => r.totalMassKg != null);
  return {
    rows,
    totals: {
      parts: components.length,
      uniqueParts: rows.length,
      massKg: withMass.length ? withMass.reduce((sum, r) => sum + r.totalMassKg, 0) : null,
      partsWithoutMass: rows.filter((r) => r.totalMassKg == null).reduce((sum, r) => sum + r.quantity, 0),
    },
  };
}

export function assemblyBomCsv(bom) {
  const header = ['Item', 'Part', 'Kind', 'Qty', 'Material', 'Unit mass (kg)', 'Total mass (kg)', 'Length (mm)', 'Width (mm)', 'Height (mm)', 'Note'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of bom.rows) {
    lines.push(
      [r.item, r.name, r.kind, r.quantity, r.material, r.unitMassKg, r.totalMassKg, ...(r.sizeMm ?? [null, null, null]), r.massNote]
        .map(csvCell)
        .join(','),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
