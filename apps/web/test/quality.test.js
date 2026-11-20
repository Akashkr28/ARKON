import { describe, expect, it } from 'vitest';
import { SlowFrameDetector, nextLowerLevel, pickAutoLevel, resolveQuality } from '../src/quality.js';

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148';

describe('pickAutoLevel', () => {
  it('picks HIGH for a well-specified laptop', () => {
    expect(pickAutoLevel({ userAgent: MAC, hardwareConcurrency: 8, deviceMemory: 16 })).toBe('high');
  });

  it('picks MEDIUM in between', () => {
    expect(pickAutoLevel({ userAgent: MAC, hardwareConcurrency: 6, deviceMemory: 8 })).toBe('medium');
  });

  it('picks LOW for small machines and phones', () => {
    expect(pickAutoLevel({ userAgent: MAC, hardwareConcurrency: 4, deviceMemory: 8 })).toBe('low');
    expect(pickAutoLevel({ userAgent: IPHONE, hardwareConcurrency: 6 })).toBe('low');
  });

  it('treats an iPad (reports as Mac, has touch) as mobile', () => {
    expect(pickAutoLevel({ userAgent: MAC, maxTouchPoints: 5, hardwareConcurrency: 8 })).toBe('low');
  });

  it('assumes 8 GB when the browser hides memory (Safari, Firefox)', () => {
    expect(pickAutoLevel({ userAgent: MAC, hardwareConcurrency: 8 })).toBe('high');
  });
});

describe('resolveQuality', () => {
  const device = { userAgent: MAC, hardwareConcurrency: 8, deviceMemory: 16 };

  it('prefers the URL, then the saved choice, then AUTO', () => {
    expect(resolveQuality({ search: '?quality=safe', stored: 'low', device })).toEqual({ level: 'safe', auto: false });
    expect(resolveQuality({ search: '', stored: 'low', device })).toEqual({ level: 'low', auto: false });
    expect(resolveQuality({ search: '', stored: null, device })).toEqual({ level: 'high', auto: true });
  });

  it('ignores unknown values', () => {
    expect(resolveQuality({ search: '?quality=ultra', stored: 'potato', device })).toEqual({
      level: 'high',
      auto: true,
    });
  });
});

describe('nextLowerLevel', () => {
  it('steps down and stops at SAFE', () => {
    expect(nextLowerLevel('high')).toBe('medium');
    expect(nextLowerLevel('low')).toBe('safe');
    expect(nextLowerLevel('safe')).toBeNull();
  });
});

describe('SlowFrameDetector', () => {
  const run = (detector, fps, seconds) => {
    let fired = false;
    for (let t = 0; t < seconds; t += 1 / fps) fired = detector.update(1 / fps) || fired;
    return fired;
  };

  it('stays quiet at a healthy frame rate', () => {
    expect(run(new SlowFrameDetector({ minFps: 20, slowForSeconds: 6 }), 30, 20)).toBe(false);
  });

  it('fires once after sustained slowness', () => {
    const detector = new SlowFrameDetector({ minFps: 20, slowForSeconds: 6 });
    expect(run(detector, 12, 3)).toBe(false); // not long enough yet
    expect(run(detector, 12, 5)).toBe(true);
    expect(run(detector, 12, 10)).toBe(false); // only once
  });

  it('ignores a single long hitch', () => {
    const detector = new SlowFrameDetector({ minFps: 20, slowForSeconds: 6 });
    run(detector, 60, 2);
    detector.update(3); // e.g. the tab was in the background
    expect(run(detector, 60, 10)).toBe(false);
  });
});
