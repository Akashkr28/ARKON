// Bill of materials: the open model's parts, identical ones grouped with a quantity,
// with each part's measured specs and effective material (the CAD file's, or the one
// picked in the spec sheet). Pure data; the CSV and PDF exports format it.

import { LENGTH_UNITS } from '../units';
import { effectiveMaterial, massKg, productKey } from './partSpecs';

function featureSummary(features, perMm, unitLabel) {
  if (!features) return '';
  const n = (mm) => `${Number((mm * perMm).toPrecision(4))}`;
  const out = [];
  for (const h of features.holes ?? []) out.push(`${h.count}× Ø${n(h.diameter)} hole`);
  for (const d of features.outerDiameters ?? []) out.push(`${d.count}× Ø${n(d.diameter)} outer`);
  for (const f of features.fillets ?? []) out.push(`${f.count}× R${n(f.radius)} fillet`);
  return out.length ? `${out.join(', ')} (${unitLabel})` : '';
}

// parts: the viewer's parts in tree order ({ id, name, path, specIndex });
// specs: by spec index; picks: material picks by product key.
export function buildBom({ parts, specs, picks = {}, unit = 'mm' }) {
  const { perMetre, label } = LENGTH_UNITS[unit] ?? LENGTH_UNITS.mm;
  const perMm = perMetre / 1000;
  const rows = [];
  const byKey = new Map();

  for (const part of parts) {
    const spec = specs[part.specIndex] ?? null;
    const name = spec?.productName ?? part.name;
    // Same product and same geometry: the same part, however many times it's placed.
    const key = `${productKey(spec, part.name)}|${spec?.volumeMm3 ?? part.vertexCount}`;
    const parent = part.path?.at(-1)?.name ?? '';
    let row = byKey.get(key);
    if (!row) {
      const material = effectiveMaterial(spec, picks[productKey(spec, part.name)]);
      const unitMass = massKg(spec?.volumeMm3, material?.density);
      row = {
        item: rows.length + 1,
        partNumber: spec?.partNumber ?? '',
        name,
        description: spec?.description ?? '',
        quantity: 0,
        material: material?.name ?? '',
        materialSource: material?.source ?? '',
        densityKgM3: material?.density ?? null,
        unitMassKg: unitMass,
        totalMassKg: null,
        volume: spec?.volumeMm3 != null ? spec.volumeMm3 * perMm ** 3 : null,
        area: spec?.surfaceAreaMm2 != null ? spec.surfaceAreaMm2 * perMm ** 2 : null,
        size: spec?.overallSizeMm ? spec.overallSizeMm.map((mm) => mm * perMm) : null,
        features: featureSummary(spec?.features, perMm, label),
        usedIn: [],
        hasSpec: Boolean(spec),
      };
      rows.push(row);
      byKey.set(key, row);
    }
    row.quantity += 1;
    if (parent && !row.usedIn.includes(parent)) row.usedIn.push(parent);
  }
  for (const row of rows) row.totalMassKg = row.unitMassKg == null ? null : row.unitMassKg * row.quantity;

  const withMass = rows.filter((r) => r.totalMassKg != null);
  return {
    unit,
    unitLabel: label,
    rows,
    totals: {
      instances: parts.length,
      uniqueParts: rows.length,
      massKg: withMass.length ? withMass.reduce((sum, r) => sum + r.totalMassKg, 0) : null,
      partsWithoutMass: rows.filter((r) => r.totalMassKg == null).reduce((sum, r) => sum + r.quantity, 0),
      withSpecs: rows.some((r) => r.hasSpec),
    },
  };
}

// ---- CSV ---------------------------------------------------------------------------

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? String(Number(value.toPrecision(10))) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function bomCsv(bom) {
  const u = bom.unitLabel;
  const header = [
    'Item',
    'Part number',
    'Part name',
    'Description',
    'Qty',
    'Material',
    'Density (kg/m3)',
    'Unit mass (kg)',
    'Total mass (kg)',
    `Volume (${u}3)`,
    `Surface area (${u}2)`,
    `Length (${u})`,
    `Width (${u})`,
    `Height (${u})`,
    'Features',
    'Used in',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const r of bom.rows) {
    lines.push(
      [
        r.item,
        r.partNumber,
        r.name,
        r.description,
        r.quantity,
        r.material,
        r.densityKgM3,
        r.unitMassKg,
        r.totalMassKg,
        r.volume,
        r.area,
        ...(r.size ?? [null, null, null]),
        r.features,
        r.usedIn.join('; '),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // CRLF and a byte-order mark: what Excel expects to open UTF-8 (Ø, ², ³) correctly.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function exportFileName(modelLabel, suffix) {
  const base = (modelLabel || 'model').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${base || 'model'}-${suffix}`;
}
