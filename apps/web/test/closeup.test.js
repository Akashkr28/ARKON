import { describe, expect, it } from 'vitest';
import { VIEW } from '../src/config.js';
import { metresPerPixel, niceStep, scaleBar } from '../src/models/scaleBar.js';
import { gridLines } from '../src/models/rulerGrid.js';
import { unrotateXYZ, rotateXYZ } from '../src/scene/viewPresets.js';

describe('scale bar', () => {
  it('rounds down to 1, 2 or 5 × 10ⁿ', () => {
    expect(niceStep(0.0037)).toBeCloseTo(0.002);
    expect(niceStep(7)).toBe(5);
    expect(niceStep(19)).toBe(10);
    expect(niceStep(250)).toBe(200);
    expect(niceStep(0)).toBe(0);
  });

  it('converts pixels to real metres at a depth', () => {
    const viewHeight = 2 * 5 * Math.tan((VIEW.cameraFov * Math.PI) / 360);
    const mpp = metresPerPixel({ depth: 5, scale: 10, metresPerSceneUnit: 2, viewportHeight: 800 });
    expect(mpp).toBeCloseTo((viewHeight / 800) * 2 / 10);
  });

  it('picks a round length in the chosen unit', () => {
    expect(scaleBar(0.0001, 'mm')).toMatchObject({ label: '10 mm' }); // 120 px ≈ 12 mm
    expect(scaleBar(0.0001, 'mm').pixels).toBeCloseTo(100);
    expect(scaleBar(0.00001, 'mm')).toMatchObject({ label: '1 mm' });
    expect(scaleBar(0.0001, 'in').label).toBe('0.2 in'); // 12 mm ≈ 0.47 in
    expect(scaleBar(0.02, 'm').label).toBe('2 m');
  });
});

describe('ruler grid', () => {
  const bounds = { min: [-1, 0, -2], max: [1, 1.4, 2] };

  it('lies on the given plane and stays within the model’s extent', () => {
    const { minor, major } = gridLines({ axis: 1, level: 0, centre: [0, 0, 0], step: 0.1, half: 1000, bounds });
    const all = [...minor, ...major];
    for (let i = 0; i < all.length; i += 3) {
      expect(all[i + 1]).toBe(0); // on the floor
      expect(Math.abs(all[i])).toBeLessThanOrEqual(1.3); // x within ±1 m + padding
      expect(Math.abs(all[i + 2])).toBeLessThanOrEqual(2.4);
    }
    expect(major.length).toBeGreaterThan(0);
  });

  it('is limited to ±half cells around the centre when zoomed in', () => {
    const { minor, major } = gridLines({ axis: 0, level: 0.5, centre: [0.5, 0.7, 0], step: 0.001, half: 30, bounds });
    const lines = (minor.length + major.length) / 6;
    expect(lines).toBeLessThanOrEqual(2 * 61);
    const all = [...minor, ...major];
    for (let i = 0; i < all.length; i += 3) expect(all[i]).toBe(0.5); // on the X = 0.5 m section
  });
});

describe('rotation helpers', () => {
  it('unrotateXYZ undoes rotateXYZ', () => {
    const angles = [0.4, -1.1, 0.25];
    const back = unrotateXYZ(rotateXYZ([0.3, -0.7, 1.2], angles), angles);
    back.forEach((v, i) => expect(v).toBeCloseTo([0.3, -0.7, 1.2][i]));
  });
});
