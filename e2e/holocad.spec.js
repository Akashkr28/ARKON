import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ?tracking=off: no hand-tracking model download; ?quality=safe: lightest rendering,
// since the test browser renders WebGL in software.
const APP = '/?tracking=off&quality=safe';
const SAMPLE_STEP = join(import.meta.dirname, '../services/converter/samples/mini-gearbox.step');

const status = (page) => page.locator('.hud-status');
const treeRow = (page, name) => page.getByRole('treeitem', { name, exact: true });

async function openApp(page) {
  await page.goto(APP);
  // Generous: the first page load of a run waits for the dev server to prepare packages.
  await expect(status(page)).toContainText('MODEL ONLINE · 118 PARTS', { timeout: 90_000 });
  // The dev build exposes the app's stores for tests and debugging.
  await page.waitForFunction(() => window.holocad?.snapAt);
}

test.describe('viewer', () => {
  test.beforeEach(async ({ page }) => openApp(page));

  test('shows the default model with real dimensions and its assembly tree', async ({ page }) => {
    await expect(status(page)).toContainText('1990 × 1430 × 4220 MM');
    for (const group of ['Body', 'Chassis', 'Powertrain', 'Interior', 'Front left corner', 'Rear right corner']) {
      await expect(treeRow(page, group)).toBeVisible();
    }
    await expect(page.getByText('Camera permission denied')).toHaveCount(0); // fake camera works
  });

  test('select a sub-assembly in the tree, isolate it, undo', async ({ page }) => {
    await treeRow(page, 'Powertrain').click();
    await expect(page.locator('.part-info')).toContainText('14 parts selected');

    await treeRow(page, 'Powertrain').dblclick();
    await expect(page.locator('.tree-status')).toContainText('104 hidden');
    await expect(page.getByRole('button', { name: /UNDO/ })).toHaveAttribute('title', /Undo isolate/);

    await page.keyboard.press('ControlOrMeta+KeyZ');
    await expect(page.locator('.tree-status')).toContainText('118 parts');
    await expect(page.getByRole('button', { name: /REDO/ })).toHaveAttribute('title', /Redo isolate/);
  });

  test('search filters the tree', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Search parts' }).fill('caliper');
    await expect(page.locator('.tree-row .tree-name', { hasText: 'Brake caliper' })).toHaveCount(4);
    await expect(treeRow(page, 'Body')).toHaveCount(0);
  });

  test('standard views and fit', async ({ page }) => {
    await page.keyboard.press('3');
    await expect
      .poll(() => page.evaluate(() => window.holocad.viewerStore.getState().rotation[1]))
      .toBeCloseTo(-Math.PI / 2);
    await page.getByRole('button', { name: /^FIT 0/ }).click();
    await expect.poll(() => page.evaluate(() => window.holocad.viewerStore.getState().scale)).toBe(1);
  });

  test('measure a distance between two snapped corners', async ({ page }) => {
    // Isolate the radiator (a plain 720 mm wide box, deep inside the car), frame it from
    // the front, then find its outermost corners on screen.
    const [a, b] = await page.evaluate(async () => {
      const { actions, viewerStore, snapAt } = window.holocad;
      const radiator = Object.values(viewerStore.getState().parts).find((p) => p.name === 'Radiator').id;
      actions.isolateParts([radiator]);
      actions.setView('front');
      actions.fitToParts([radiator]);
      await new Promise((r) => setTimeout(r, 1500)); // let the view settle
      const corners = [];
      // Framed parts sit in the middle of the screen; scan that band only.
      for (let y = innerHeight / 4; y < (innerHeight * 3) / 4; y += 6) {
        for (let x = 0; x < innerWidth; x += 6) {
          const snap = snapAt(x, y);
          if (snap?.partId === radiator && snap.kind === 'vertex') corners.push({ x, y, metres: snap.metres });
        }
      }
      const left = corners.reduce((p, q) => (q.metres[0] < p.metres[0] ? q : p));
      const right = corners.reduce((p, q) => (q.metres[0] > p.metres[0] ? q : p));
      return [left, right];
    });
    const expectedMm = Math.hypot(...b.metres.map((v, i) => v - a.metres[i])) * 1000;

    await page.keyboard.press('q');
    await expect(page.locator('.measure-hint')).toContainText('first point');
    await page.mouse.click(a.x, a.y);
    await expect(page.locator('.measure-hint')).toContainText('second point');
    await page.mouse.click(b.x, b.y);

    const value = page.locator('.measure-row .measure-value').first();
    await expect(value).toContainText(`${expectedMm.toFixed(1)} mm`);
    expect(expectedMm).toBeGreaterThan(700); // across the 720 mm radiator, not a stray point
    await expect(page.locator('.measure-label')).toHaveCount(1);
  });

  test('section plane: cycle, position, flip, undo', async ({ page }) => {
    await page.keyboard.press('s');
    await page.keyboard.press('s');
    await expect(page.locator('.section-axis.is-active')).toHaveText('Y');
    await expect(page.locator('.section-position')).toContainText('Y = 715.1 mm'); // halfway up the 1430 mm car

    await page.getByRole('button', { name: /FLIP/ }).click();
    await expect.poll(() => page.evaluate(() => window.holocad.viewerStore.getState().section.flip)).toBe(true);

    await page.keyboard.press('ControlOrMeta+KeyZ');
    await expect.poll(() => page.evaluate(() => window.holocad.viewerStore.getState().section.flip)).toBe(false);
  });
});

test.describe('close-up viewing', () => {
  test.beforeEach(async ({ page }) => openApp(page));

  test('zooms deep into the surface under the cursor; readout, scale bar, grid', async ({ page }) => {
    await page.keyboard.press('1'); // front view
    await page.waitForTimeout(1500);
    // A pixel over the car, near the middle of the screen.
    const target = await page.evaluate(() => {
      const { pointAt } = window.holocad;
      for (let dy = 0; dy < 200; dy += 4) {
        for (const y of [innerHeight / 2 + dy, innerHeight / 2 - dy]) {
          const hit = pointAt(innerWidth / 2, y);
          if (hit) return { x: innerWidth / 2, y, metres: hit.metres };
        }
      }
      return null;
    });
    expect(target).not.toBeNull();
    await page.mouse.move(target.x, target.y);
    const readout = page.getByLabel('Cursor position');
    await expect(readout).toContainText(/X -?[\d.]+ mm/);

    for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, -400);
    await page.waitForTimeout(2000); // let the zoom settle
    const scale = await page.evaluate(() => window.holocad.viewerStore.getState().scale);
    expect(scale).toBeGreaterThan(100); // far past the old 20× limit

    // The surface point under the cursor stayed put (within half a millimetre).
    const after = await page.evaluate(({ x, y }) => window.holocad.pointAt(x, y)?.metres, target);
    expect(after).not.toBeNull();
    after.forEach((v, i) => expect(Math.abs(v - target.metres[i])).toBeLessThan(0.0005));

    await page.mouse.move(target.x + 1, target.y); // refresh the readout at the new depth
    await expect(page.getByLabel('View scale')).toContainText(/\b\d+(\.\d+)? mm/);
    await page.keyboard.press('g');
    await expect(page.getByLabel('View scale')).toContainText(/GRID [\d.]+ mm/);
  });
});

test.describe('spec sheet', () => {
  test.beforeEach(async ({ page }) => openApp(page));

  test('shows a part’s measured specs; material changes the mass; inches', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Search parts' }).fill('engine block');
    await treeRow(page, 'Engine block').click();
    await page.keyboard.press('p');
    const sheet = page.getByLabel('Spec sheet');
    await expect(sheet).toContainText('Engine block');
    await expect(sheet).toContainText('From CAD: Aluminium A356 cast');
    await expect(sheet).toContainText('157.105 kg');
    await expect(sheet).toContainText('520.0 mm × 360.0 mm × 340.0 mm');
    await expect(sheet).toContainText('4 × Ø80.0 mm, 250.0 mm deep'); // the cylinder bores

    await sheet.locator('select.spec-material').selectOption('steel');
    await expect(sheet).toContainText('460.178 kg');
    await expect(page.locator('.part-info')).toContainText('460.178 kg · Steel (structural)');

    await sheet.getByRole('button', { name: 'IN', exact: true }).click();
    await expect(sheet).toContainText('4 × Ø3.150 in, 9.843 in deep');
    await expect(sheet).toContainText('1,014.5 lb');
  });

  test('totals a selection', async ({ page }) => {
    await treeRow(page, 'Powertrain').click();
    await page.keyboard.press('p');
    await expect(page.getByLabel('Spec sheet')).toContainText('14 parts selected');
    await expect(page.getByLabel('Spec sheet')).toContainText(/MASS\s*[\d,.]+ kg/);
  });
});

test.describe('bill of materials export', () => {
  test.beforeEach(async ({ page }) => openApp(page));

  test('CSV: one row per different part, with quantities and masses', async ({ page }) => {
    await page.getByRole('tab', { name: 'SPECS' }).click();
    const bar = page.getByRole('group', { name: 'Export bill of materials' });
    await expect(bar).toContainText('118 parts');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      bar.getByRole('button', { name: 'CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('Aster_C1_compact_car-BOM.csv');
    const csv = (await readFile(await download.path(), 'utf8')).replace(/^\uFEFF/, '');
    const rows = csv
      .trimEnd()
      .split('\r\n')
      .map((line) => line.split(','));
    const [header, ...body] = rows;
    const col = (name) => header.indexOf(name);
    const row = (name) => body.find((r) => r[col('Part name')] === name);
    expect(row('Lug nut')[col('Qty')]).toBe('20');
    expect(row('Brake disc')[col('Qty')]).toBe('4');
    expect(row('Engine block')[col('Material')]).toBe('Aluminium A356 cast');
    expect(Number(row('Engine block')[col('Total mass (kg)')])).toBeCloseTo(157.105, 2);
    expect(body.reduce((n, r) => n + Number(r[col('Qty')]), 0)).toBe(118);
  });

  test('PDF report downloads', async ({ page }) => {
    await page.getByRole('tab', { name: 'SPECS' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'PDF REPORT' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('Aster_C1_compact_car-report.pdf');
    const pdf = await readFile(await download.path());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(20_000); // the view picture plus a multi-page table
  });
});

test.describe('face and edge inspector', () => {
  test.beforeEach(async ({ page }) => openApp(page));

  // Isolate the engine block, open SPECS (loads the face data), and frame it from the
  // front; `cut` sections it through its middle, front to back, opening up the bores.
  async function inspectEngineBlock(page, { cut = false } = {}) {
    await page.getByRole('tab', { name: 'SPECS' }).click();
    await page.waitForFunction(() => window.holocad.specStore.getState().facesStatus === 'ready');
    await page.evaluate(async (cut) => {
      const { actions, viewerStore, specStore } = window.holocad;
      const block = Object.values(viewerStore.getState().parts).find((p) => p.name === 'Engine block');
      actions.selectParts([block.id]);
      actions.isolateParts([block.id]);
      if (cut) {
        const z = specStore.getState().specs[block.specIndex].centreOfMassM[2];
        const { min, max } = viewerStore.getState().modelBounds;
        actions.setSectionAxis('z');
        actions.setSectionOffset((z - min[2]) / (max[2] - min[2]));
      }
      actions.setView('front');
      actions.fitToParts([block.id]);
      await new Promise((r) => setTimeout(r, 1500));
    }, cut);
  }

  // First screen point (scanning the middle of the screen) where the inspector sees `want`.
  function findPoint(page, want) {
    return page.evaluate((want) => {
      const { inspectAt, specStore } = window.holocad;
      const { faces } = specStore.getState();
      for (let y = innerHeight * 0.2; y < innerHeight * 0.8; y += 5) {
        for (let x = innerWidth * 0.25; x < innerWidth * 0.7; x += 5) {
          const item = inspectAt(x, y);
          if (!item || item.kind !== want.kind) continue;
          const product = faces.products[faces.parts[item.specIndex]];
          const data = item.kind === 'edge' ? product.edges[item.index] : product.faces[item.index];
          if (Object.entries(want.match).every(([k, v]) => data[k] === v)) return { x, y };
        }
      }
      return null;
    }, want);
  }

  test('hovering names the face under the cursor', async ({ page }) => {
    await inspectEngineBlock(page);
    const box = page.viewportSize();
    await page.mouse.move(box.width / 2, box.height / 2);
    const tooltip = page.locator('.inspect-tooltip');
    await expect(tooltip).toContainText('Flat face');
    await expect(tooltip).toContainText('176,800 mm²'); // the 520 × 340 mm front face
    await expect(tooltip).toContainText('Facing +Z');
  });

  test('finds a bore and pins a circular edge in the spec sheet', async ({ page }) => {
    await inspectEngineBlock(page, { cut: true });
    const wall = await findPoint(page, { kind: 'face', match: { type: 'cylinder', concave: true } });
    expect(wall).not.toBeNull();
    await page.mouse.move(wall.x, wall.y);
    await expect(page.locator('.inspect-tooltip')).toContainText('Hole Ø80.0 mm');
    await expect(page.locator('.inspect-tooltip')).toContainText('Length 250.0 mm');

    const rim = await findPoint(page, { kind: 'edge', match: { type: 'circle', radius: 40 } });
    expect(rim).not.toBeNull();
    await page.mouse.move(rim.x, rim.y);
    await page.mouse.click(rim.x, rim.y);
    const picked = page.locator('.spec-inspected');
    await expect(picked).toContainText('Circular edge Ø80.0 mm');
    await expect(picked).toContainText('Circumference 251.3 mm');
  });
});

test.describe('design workspace', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.getByRole('tab', { name: 'DESIGN' }).click();
    // The CAD engine (WebAssembly) starts on first use; then the starter part builds.
    await expect(page.locator('.hud-status')).toContainText('DESIGN · MOUNTING PLATE · 120 × 80.0 × 10.0 MM', {
      timeout: 60_000,
    });
  });

  const properties = (page) => page.getByLabel('Part properties');

  test('edits a dimension and adds a feature; the part rebuilds', async ({ page }) => {
    await expect(properties(page)).toContainText('93,680.4 mm³'); // plate, 4 holes, R6 corners
    await page.getByRole('listitem', { name: 'Box' }).click();
    await page.getByLabel('Length (X)').fill('200');
    await expect(page.locator('.hud-status')).toContainText('200 × 80.0 × 10.0 MM');
    await page.getByLabel('Add feature').selectOption('pocket');
    await expect(page.getByRole('listitem', { name: 'Pocket' })).toContainText('40 × 20 × 5 deep');
    await expect(properties(page)).toContainText('153,680.4 mm³'); // minus the 4,000 mm³ pocket

    // A feature that can't be built says why; the rest of the part stays.
    await page.getByRole('listitem', { name: 'Fillet' }).click();
    await page.getByLabel('Radius').fill('90');
    await expect(page.getByRole('listitem', { name: 'Fillet' })).toContainText('radius too large');
    await expect(properties(page)).toContainText('200.0 mm × 80.0 mm × 10.0 mm');
  });

  test('exports STEP and saves the part to the library', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'EXPORT STEP' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('Mounting_plate.step');
    const step = await readFile(await download.path(), 'utf8');
    expect(step.startsWith('ISO-10303-21;')).toBe(true);

    await page.getByRole('button', { name: 'SAVE TO LIBRARY' }).click();
    await expect(page.locator('.design-message')).toContainText('Sent to the library');
    await page.getByRole('button', { name: '◂ VIEWER' }).click();
    await page.getByRole('tab', { name: 'LIBRARY' }).click();
    const row = page.locator('.library-row', { hasText: 'Mounting_plate' });
    await expect(row.locator('.library-badge')).toHaveText('READY', { timeout: 30_000 });
    // Converted like any STEP file: exact specs, including the four holes.
    await expect(page.locator('.hud-status')).toContainText('MODEL ONLINE · 1 PARTS');
    await page.getByRole('tab', { name: 'PARTS' }).click();
    await page.locator('.tree-row').first().click();
    await page.keyboard.press('p');
    await expect(page.getByLabel('Spec sheet')).toContainText('4 × Ø8.0 mm, 10.0 mm deep');
    // Clean up for the other tests.
    await page.getByRole('tab', { name: 'LIBRARY' }).click();
    await row.getByRole('button', { name: /^Delete/ }).click();
    await row.getByRole('button', { name: /^Confirm delete/ }).click();
  });
});

test.describe('design parameters and history', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.removeItem('holocad.design.v1'));
    await page.getByRole('tab', { name: 'DESIGN' }).click();
    await expect(page.locator('.hud-status')).toContainText('120 × 80.0 × 10.0 MM', { timeout: 60_000 });
  });

  const status = (page) => page.locator('.hud-status');
  const undoButton = (page) => page.getByRole('button', { name: /UNDO/ });

  test('a parameter drives the part; typing is one undo step', async ({ page }) => {
    await page.getByLabel('Value of length').fill('200');
    await expect(status(page)).toContainText('200 × 80.0 × 10.0 MM');
    // The holes follow: their spacing is the formula "length - 2 * margin".
    await page.getByRole('listitem', { name: 'Hole' }).click();
    await expect(page.locator('.design-field', { hasText: 'Pitch / spacing (X)' })).toContainText('= 170');

    await expect(undoButton(page)).toHaveAttribute('title', /Undo change parameter/);
    await undoButton(page).click();
    await expect(status(page)).toContainText('120 × 80.0 × 10.0 MM');
    await expect(undoButton(page)).toHaveAttribute('title', 'Nothing to undo');
    await page.keyboard.press('ControlOrMeta+Shift+KeyZ');
    await expect(status(page)).toContainText('200 × 80.0 × 10.0 MM');
  });

  test('formulas in dimension fields, and their errors', async ({ page }) => {
    await page.getByRole('listitem', { name: 'Hole' }).click();
    await page.getByLabel('Diameter').fill('thickness');
    await expect(page.locator('.design-field', { hasText: 'Diameter' })).toContainText('= 10');
    await expect(page.getByRole('listitem', { name: 'Hole' })).toContainText('4 × Ø10 through');
    await page.getByLabel('Diameter').fill('nope * 2');
    await expect(page.getByRole('listitem', { name: 'Hole' })).toContainText('Diameter: Unknown parameter “nope”');

    // Renaming a parameter renames it in every formula.
    await page.getByLabel('Parameter name').nth(2).fill('plate');
    await page.getByRole('listitem', { name: 'Box' }).click();
    await expect(page.getByLabel('Height (Z)')).toHaveValue('plate');
    await expect(status(page)).toContainText('120 × 80.0 × 10.0 MM');
  });

  test('saves and reopens a design file; autosaves between visits', async ({ page }) => {
    await page.getByLabel('Value of margin').fill('20');
    await page.getByLabel('Part name').fill('Bracket A');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'SAVE DESIGN' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('Bracket_A.holocad.json');
    const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
    expect(saved).toMatchObject({ format: 'holocad-design', name: 'Bracket A' });

    await page.getByRole('button', { name: 'NEW' }).click();
    await expect(status(page)).toContainText('DESIGN · UNTITLED PART');
    await page.getByLabel('Open design file').setInputFiles(await download.path());
    await expect(status(page)).toContainText('DESIGN · BRACKET A · 120 × 80.0 × 10.0 MM');
    await expect(page.getByLabel('Value of margin')).toHaveValue('20');

    await page.waitForTimeout(700); // autosave settles
    await page.reload();
    await page.getByRole('tab', { name: 'DESIGN' }).click();
    await expect(status(page)).toContainText('DESIGN · BRACKET A', { timeout: 60_000 });
    await expect(page.getByLabel('Value of margin')).toHaveValue('20');
  });
});

test.describe('shaping by hand', () => {
  test('drag the length arrow: the part and its parameter follow; one undo', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.removeItem('holocad.design.v1'));
    await page.getByRole('tab', { name: 'DESIGN' }).click();
    await expect(page.locator('.hud-status')).toContainText('120 × 80.0 × 10.0 MM', { timeout: 60_000 });
    await page.keyboard.press('1'); // front view: the length arrow points right
    await page.waitForTimeout(1500);

    const grip = await page.evaluate(() => {
      for (let y = innerHeight * 0.2; y < innerHeight * 0.8; y += 3) {
        for (let x = innerWidth * 0.3; x < innerWidth * 0.75; x += 3) {
          if (window.holocad.handleAt(x, y)?.id.endsWith(':length')) return { x, y };
        }
      }
      return null;
    });
    expect(grip).not.toBeNull();
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(grip.x + i * 8, grip.y);
    await expect(page.locator('.handle-label')).toContainText(/Length \(X\) \d+\.0 mm/);
    await page.mouse.up();

    await expect(page.locator('.hud-status')).not.toContainText('120 × 80.0');
    const length = Number(await page.getByLabel('Value of length').inputValue());
    expect(length).toBeGreaterThan(130); // dragged out; the holes follow via the parameter
    await expect(page.getByRole('button', { name: /UNDO/ })).toHaveAttribute('title', /Undo drag length \(x\)/i);
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await expect(page.locator('.hud-status')).toContainText('120 × 80.0 × 10.0 MM');
  });
});

test.describe('assembling', () => {
  // Finds a pixel over a face of the wanted kind on a part, by asking the scene.
  const findFace = (page, componentId, type, radiusMm = null) =>
    page.evaluate(
      ({ componentId, type, radiusMm }) => {
        for (let y = 60; y < innerHeight - 60; y += 4) {
          for (let x = 40; x < innerWidth - 420; x += 4) {
            const face = window.holocad.faceAt(x, y);
            if (face?.componentId !== componentId || face.geometry.type !== type) continue;
            if (radiusMm && Math.abs(face.geometry.radius * 1000 - radiusMm) > 0.2) continue;
            return { x, y };
          }
        }
        return null;
      },
      { componentId, type, radiusMm },
    );

  test('put a pin in a plate hole, slide it, undo; save the assembly', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      localStorage.removeItem('holocad.assembly.v1');
      localStorage.removeItem('holocad.design.v1');
    });
    await page.getByRole('tab', { name: 'ASSEMBLE' }).click();
    await expect(status(page)).toContainText('ASSEMBLY · UNTITLED ASSEMBLY · 0 PARTS');

    // The starter plate from DESIGN, and a Ø8 pin (as if from a design file).
    await page.getByRole('button', { name: '+ THIS DESIGN' }).click();
    const pinId = await page.evaluate(() =>
      window.holocad.assembly.addDesignPart({
        name: 'Pin',
        parameters: [],
        features: [{ type: 'cylinder', params: { diameter: 8, height: 30 } }],
      }),
    );
    const parts = page.getByRole('list', { name: 'Parts' });
    await expect(parts.getByText('free: drag to move')).toHaveCount(2, { timeout: 60_000 });
    const plateId = await page.evaluate(() => window.holocad.assemblyStore.getState().components[0].id);
    await page.keyboard.press('5'); // iso: the pin's side and the plate's holes in view
    await page.waitForTimeout(1500);

    // ON AXIS: the pin's round side, then a hole.
    await page.getByRole('button', { name: 'ON AXIS' }).click();
    const pinSide = await findFace(page, pinId, 'cylinder', 4);
    expect(pinSide).not.toBeNull();
    await page.mouse.click(pinSide.x, pinSide.y);
    await expect(page.getByLabel('Assembly message')).toContainText('Now click a face on the part to attach Pin to');
    const hole = await findFace(page, plateId, 'cylinder', 4);
    expect(hole).not.toBeNull();
    await page.mouse.click(hole.x, hole.y);
    await expect(status(page)).toContainText('2 PARTS · 1 MATES');
    await expect(parts).toContainText('on axis on Mounting plate');

    // The pin's axis is the hole's axis.
    const aligned = await page.evaluate(() => {
      const { mates, placements } = window.holocad.assemblyStore.getState();
      const [mate] = mates;
      const q = placements[mate.moving.componentId].quaternion;
      const t = placements[mate.target.componentId].quaternion;
      const rotate = (v, [x, y, z, w]) => {
        // v + 2w(q×v) + 2q×(q×v)
        const c = [y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0]];
        const d = [y * c[2] - z * c[1], z * c[0] - x * c[2], x * c[1] - y * c[0]];
        return v.map((vi, i) => vi + 2 * w * c[i] + 2 * d[i]);
      };
      const a = rotate(mate.moving.geometry.axis, q);
      const b = rotate(mate.target.geometry.axis, t);
      return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
    });
    expect(aligned).toBeCloseTo(1, 4);

    // Drag the pin: it slides along the hole's axis only. One undo puts it back.
    const grip = await page.evaluate((id) => {
      for (let y = 60; y < innerHeight - 60; y += 4) {
        for (let x = 40; x < innerWidth - 420; x += 4)
          if (window.holocad.componentAt(x, y)?.componentId === id) return { x, y };
      }
      return null;
    }, pinId);
    expect(grip).not.toBeNull();
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(grip.x, grip.y - i * 6);
    await expect(page.locator('.handle-label')).toContainText(/Pin · Slide -?\d+\.\d mm along the axis/);
    await page.mouse.up();
    const slide = await page.evaluate(() => window.holocad.assemblyStore.getState().mates[0].slide);
    expect(Math.abs(slide)).toBeGreaterThan(2);
    await expect(page.getByRole('button', { name: /UNDO/ })).toHaveAttribute('title', /Undo move pin/i);
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await expect.poll(() => page.evaluate(() => window.holocad.assemblyStore.getState().mates[0].slide)).toBe(0);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'SAVE ASSEMBLY' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('Untitled_assembly.holocad-assembly.json');
    const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
    expect(saved).toMatchObject({ format: 'holocad-assembly', version: 1 });
    expect(saved.components.map((c) => c.name)).toEqual(['Mounting plate', 'Pin']);
    expect(saved.mates[0]).toMatchObject({ type: 'axis', moving: { componentId: pinId } });

    // Make the pin brass: its look, its mass, and what the exports carry.
    await parts.getByText('Pin', { exact: true }).click();
    await page.getByLabel('Material').selectOption('brass');
    await expect(parts).toContainText('Brass · satin');
    await expect(page.getByLabel('Assembly properties')).toContainText('1× PIN');
    await expect(page.getByLabel('Assembly properties')).toContainText('Brass');
    expect(await page.evaluate(() => window.holocad.viewerStore.getState().materialMode)).toBe('original');

    const [glb] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'EXPORT GLB' }).click(),
    ]);
    expect(glb.suggestedFilename()).toBe('Untitled_assembly.glb');
    expect((await readFile(await glb.path())).subarray(0, 4).toString()).toBe('glTF');

    const [step] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'EXPORT STEP' }).click(),
    ]);
    const stepText = await readFile(await step.path(), 'utf8');
    expect(stepText).toContain("'Pin'");
    expect(stepText).toContain("'Mounting plate'");

    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'BOM CSV' }).click(),
    ]);
    const rows = (await readFile(await csv.path(), 'utf8')).trim().split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatch(/^2,Pin,Designed part,1,Brass,/);

    // Into the library as a model: both parts, viewable like any upload.
    await page.getByRole('button', { name: 'SAVE TO LIBRARY' }).click();
    await expect(page.getByLabel('Assembly message')).toContainText('Sent to the library');
    await page.getByRole('button', { name: '◂ VIEWER' }).click();
    await page.getByRole('tab', { name: 'LIBRARY' }).click();
    const row = page.locator('.library-row', { hasText: 'Untitled_assembly' });
    await expect(row.locator('.library-badge')).toHaveText('READY', { timeout: 30_000 });
    await expect(status(page)).toContainText('MODEL ONLINE · 2 PARTS');
    await row.getByRole('button', { name: /^Delete/ }).click();
    await row.getByRole('button', { name: /^Confirm delete/ }).click();
  });

  test("a model's faces come from its CAD data, not just triangles", async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.removeItem('holocad.assembly.v1'));
    await page.getByRole('tab', { name: 'ASSEMBLE' }).click();
    await page.getByLabel('Add a model').selectOption('aster');
    await expect(status(page)).toContainText('1 PARTS');
    await expect(page.getByRole('list', { name: 'Parts' })).toContainText('free: drag to move', { timeout: 60_000 });
    // The mate buttons need two parts; picking faces works the same with one.
    await page.evaluate(() => window.holocad.assembly.setTool('contact'));
    const faces = await page.evaluate(() => {
      const labels = new Set();
      let largest = 0;
      for (let y = 80; y < innerHeight - 80; y += 10) {
        for (let x = 60; x < innerWidth - 420; x += 10) {
          const face = window.holocad.faceAt(x, y);
          if (!face) continue;
          labels.add(face.label.split(' · ')[1]);
          largest = Math.max(largest, face.highlight.length / 9);
        }
      }
      return { labels: [...labels], largest };
    });
    // Whole CAD faces (many triangles each), named flat or round.
    expect(faces.largest).toBeGreaterThan(10);
    expect(faces.labels).toContain('flat face');
    expect(faces.labels.some((l) => l.startsWith('round face'))).toBe(true);
  });
});

test.describe('library', () => {
  test('upload a STEP file, convert it, open it, delete it', async ({ page }) => {
    await openApp(page);
    await page.getByRole('tab', { name: 'LIBRARY' }).click();
    await expect(page.locator('.library-api')).toHaveText('API ONLINE');

    await page.locator('.hud-library input[type=file]').setInputFiles(SAMPLE_STEP);
    const row = page.locator('.library-row', { hasText: 'mini-gearbox' });
    await expect(row.locator('.library-badge')).toHaveText('READY', { timeout: 30_000 });

    // Opens by itself once converted, with real part names from the STEP file.
    await expect(status(page)).toContainText('MODEL ONLINE · 7 PARTS');
    await page.getByRole('tab', { name: 'PARTS' }).click();
    await expect(page.locator('.tree-name', { hasText: 'Drive gear' })).toBeVisible();

    // Converted from STEP, so it has exact specs too.
    await page.locator('.tree-name', { hasText: 'Drive gear' }).click();
    await page.keyboard.press('p');
    await expect(page.getByLabel('Spec sheet')).toContainText('VOLUME');
    await expect(page.getByLabel('Spec sheet')).not.toContainText('No CAD data');

    // Delete asks for a second click; the viewer falls back to a sample.
    await page.getByRole('tab', { name: 'LIBRARY' }).click();
    await row.getByRole('button', { name: /^Delete/ }).click();
    await row.getByRole('button', { name: /^Confirm delete/ }).click();
    await expect(row).toHaveCount(0);
    await expect(status(page)).toContainText('118 PARTS');
  });

  test('rejects a file that is not really STEP', async ({ page }) => {
    await openApp(page);
    await page.getByRole('tab', { name: 'LIBRARY' }).click();
    await page.locator('.hud-library input[type=file]').setInputFiles({
      name: 'notes.step',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('just some notes'),
    });
    await expect(page.locator('.upload-row .library-error')).toContainText("doesn't look like a STEP file");
  });
});

test.describe('hand cursor', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    // A gesture engine fed made-up hands (the real camera is off in tests): window.hand
    // taps or pinch-drags at screen points, through the same code the webcam drives.
    await page.evaluate(() => {
      const engine = window.holocad.createGestureEngine();
      let now = 0;
      const hand = (x, y, pinching) => {
        const point = () => ({ x, y });
        return {
          id: 1,
          handedness: 'Right',
          gesture: 'None',
          landmarks: Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })),
          screen: Array.from({ length: 21 }, point),
          palmSizeScreen: 100,
          openness: 0.5,
          pinching,
          palmScreen: point(),
          pinchScreen: point(),
          indexTipScreen: point(),
          palmWorld: { x: 0, y: 0, z: 0 },
          pinchWorld: { x: 0, y: 0, z: 0 },
          indexTipWorld: { x: 0, y: 0, z: 0 },
        };
      };
      const frames = (n, x, y, pinching) => {
        for (let i = 0; i < n; i++) engine.update([hand(x, y, pinching)], (now += 33), innerWidth, innerHeight);
      };
      window.hand = {
        // Pinch-drag sideways (dx) or up/down (dy) from x, y.
        drag(x, y, dx, dy) {
          frames(5, x, y, true);
          for (let step = 1; step <= 10; step++) frames(1, x + (dx * step) / 10, y + (dy * step) / 10, true);
          frames(2, x + dx, y + dy, false);
          now += 1000;
        },
        tap(x, y) {
          frames(5, x, y, true);
          frames(2, x, y, false);
          now += 1000; // so the next tap isn't a double tap
        },
      };
    });
  });

  const centre = async (locator) => {
    const box = await locator.boundingBox();
    return [box.x + box.width / 2, box.y + box.height / 2];
  };
  const tap = async (page, [x, y]) => page.evaluate(([x, y]) => window.hand.tap(x, y), [x, y]);

  test('taps press tabs, open dropdowns as buttons, and select parts', async ({ page }) => {
    // A tab.
    await tap(page, await centre(page.getByRole('tab', { name: 'LIBRARY' })));
    await expect(page.getByRole('tab', { name: 'LIBRARY' })).toHaveAttribute('aria-selected', 'true');

    // A dropdown: its options appear as buttons; tapping one chooses it.
    await tap(page, await centre(page.getByLabel('Length unit')));
    const picker = page.locator('.gesture-picker');
    await expect(picker.getByRole('option')).toHaveCount(4);
    await tap(page, await centre(picker.getByRole('option', { name: 'IN' })));
    await expect(picker).toHaveCount(0);
    await expect(page.getByLabel('Length unit')).toHaveValue('in');

    // The model: tapping it selects the part under the hand; empty space clears.
    const size = page.viewportSize();
    const middle = [size.width * 0.42, size.height / 2];
    await tap(page, middle);
    await expect.poll(() => page.evaluate(() => window.holocad.viewerStore.getState().selectedPartIds.length)).toBe(1);
    await tap(page, [size.width * 0.42, 40 + size.height * 0.05]);
    await expect.poll(() => page.evaluate(() => window.holocad.viewerStore.getState().selectedPartIds.length)).toBe(0);

    // Workspaces are just tabs too.
    await tap(page, await centre(page.getByRole('tab', { name: 'DESIGN' })));
    await expect(status(page)).toContainText('DESIGN ·');
  });

  test('pinch-dragging a panel scrolls it', async ({ page }) => {
    const tree = page.locator('.assembly-tree, [role="tree"]').first();
    const scroller = await tree.evaluateHandle((node) => {
      for (let el = node; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight)
          return el;
      }
      return null;
    });
    expect(await scroller.evaluate((el) => el?.scrollTop)).toBe(0);
    const [x, y] = await centre(tree);
    await page.evaluate(([x, y]) => window.hand.drag(x, y, 0, -120), [x, y]);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    // A drag doesn't press what it started on.
    await expect(page.locator('.part-info')).toHaveCount(0);
  });
});
