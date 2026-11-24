import { describe, expect, it } from 'vitest';
import { bomCsv, buildBom, exportFileName } from '../src/models/bom.js';

const disc = {
  productName: 'Brake disc',
  partNumber: 'BD-320',
  volumeMm3: 1_000_000,
  surfaceAreaMm2: 200_000,
  overallSizeMm: [320, 320, 26],
  material: { name: 'Grey cast iron', densityKgM3: 7200 },
  features: { holes: [{ diameter: 120, depth: 26, count: 1 }], outerDiameters: [], fillets: [] },
};
const block = {
  productName: 'Engine block',
  description: 'Cast, 4 bores, "short" deck',
  volumeMm3: 58_621_452,
  overallSizeMm: [520, 360, 340],
  material: null,
  features: { holes: [{ diameter: 80, depth: 250, count: 4 }] },
};
const specs = [disc, block];
const at = (name) => [{ id: 'g', name: 'Car' }, { id: `g-${name}`, name }];
const parts = [
  { id: 'part-0', name: 'Brake disc', specIndex: 0, path: at('Front left corner') },
  { id: 'part-1', name: 'Engine block', specIndex: 1, path: at('Powertrain') },
  { id: 'part-2', name: 'Brake disc', specIndex: 0, path: at('Front right corner') },
  { id: 'part-3', name: 'Logo', specIndex: undefined, vertexCount: 12, path: at('Body') },
];

describe('bill of materials', () => {
  it('groups identical parts with a quantity, in assembly order', () => {
    const bom = buildBom({ parts, specs });
    expect(bom.rows.map((r) => [r.item, r.name, r.quantity])).toEqual([
      [1, 'Brake disc', 2],
      [2, 'Engine block', 1],
      [3, 'Logo', 1],
    ]);
    expect(bom.rows[0].usedIn).toEqual(['Front left corner', 'Front right corner']);
    expect(bom.rows[0].unitMassKg).toBeCloseTo(7.2);
    expect(bom.rows[0].totalMassKg).toBeCloseTo(14.4);
    expect(bom.rows[0].features).toBe('1× Ø120 hole (mm)');
  });

  it('totals mass, counting parts it can’t weigh instead of guessing', () => {
    const { totals } = buildBom({ parts, specs });
    expect(totals).toMatchObject({ instances: 4, uniqueParts: 3, partsWithoutMass: 2, withSpecs: true });
    expect(totals.massKg).toBeCloseTo(14.4);
  });

  it('uses materials picked in the spec sheet', () => {
    const picks = { 'Engine block': { id: 'aluminium', name: 'Aluminium 6061', density: 2700 } };
    const bom = buildBom({ parts, specs, picks });
    expect(bom.rows[1].material).toBe('Aluminium 6061');
    expect(bom.rows[1].totalMassKg).toBeCloseTo(158.278, 2);
    expect(bom.totals.massKg).toBeCloseTo(14.4 + 158.278, 2);
  });

  it('converts sizes, volumes and areas to inches', () => {
    const bom = buildBom({ parts, specs, unit: 'in' });
    expect(bom.unitLabel).toBe('in');
    expect(bom.rows[0].size[0]).toBeCloseTo(320 / 25.4);
    expect(bom.rows[0].volume).toBeCloseTo(1_000_000 / 25.4 ** 3);
    expect(bom.rows[0].area).toBeCloseTo(200_000 / 25.4 ** 2);
    expect(bom.rows[0].features).toBe('1× Ø4.724 hole (in)');
  });
});

describe('CSV', () => {
  const csv = bomCsv(buildBom({ parts, specs }));
  const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');

  it('starts with a byte-order mark and a header, one line per row', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toMatch(/^Item,Part number,Part name,Description,Qty,Material,/);
    expect(lines[0]).toContain('Length (mm)');
    expect(lines).toHaveLength(4);
  });

  it('quotes text with commas and quotes', () => {
    expect(lines[2]).toContain('"Cast, 4 bores, ""short"" deck"');
    expect(lines[1]).toMatch(/^1,BD-320,Brake disc,,2,Grey cast iron,7200,7\.2,14\.4,1000000,200000,320,320,26,/);
    expect(lines[1]).toContain('Front left corner; Front right corner');
  });
});

it('makes safe file names', () => {
  expect(exportFileName('Aster C1 (compact car)', 'BOM.csv')).toBe('Aster_C1_compact_car-BOM.csv');
  expect(exportFileName('', 'report.pdf')).toBe('model-report.pdf');
});
