import { expect, test } from '@playwright/test';
import { join } from 'node:path';

// ?tracking=off: no hand-tracking model download; ?quality=safe: lightest rendering,
// since the test browser renders WebGL in software.
const APP = '/?tracking=off&quality=safe';
const SAMPLE_STEP = join(import.meta.dirname, '../services/converter/samples/mini-gearbox.step');

const status = (page) => page.locator('.hud-status');
const treeRow = (page, name) => page.getByRole('treeitem', { name, exact: true });

async function openApp(page) {
  await page.goto(APP);
  await expect(status(page)).toContainText('MODEL ONLINE · 118 PARTS');
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
    await expect.poll(() => page.evaluate(() => window.holocad.viewerStore.getState().rotation[1])).toBeCloseTo(-Math.PI / 2);
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
