import { describe, expect, it } from 'vitest';
import { evaluate, isValidName, namesIn } from '../src/cad/expressions.js';
import { makeFeature } from '../src/cad/features.js';
import {
  dimensionValue,
  makeParameter,
  parseDimensionInput,
  resolveFeatures,
  resolveParameters,
} from '../src/cad/parameters.js';

describe('formulas', () => {
  it('follows arithmetic rules', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14);
    expect(evaluate('(2 + 3) * 4')).toBe(20);
    expect(evaluate('-2 ^ 2')).toBe(-4);
    expect(evaluate('2 ^ 3 ^ 2')).toBe(512);
    expect(evaluate('10 / 4 - 1')).toBe(1.5);
    expect(evaluate('1.5e2')).toBe(150);
    expect(evaluate('length - 2 * margin', { length: 200, margin: 15 })).toBe(170);
  });

  it('has the usual functions, trigonometry in degrees', () => {
    expect(evaluate('max(10, width / 4)', { width: 60 })).toBe(15);
    expect(evaluate('sqrt(16) + abs(-2) + round(2.6)')).toBe(9);
    expect(evaluate('sin(30)')).toBeCloseTo(0.5);
    expect(evaluate('2 * pi')).toBeCloseTo(2 * Math.PI);
  });

  it('explains what is wrong', () => {
    expect(() => evaluate('length - ')).toThrow('Incomplete formula');
    expect(() => evaluate('(1 + 2')).toThrow('Missing “)”');
    expect(() => evaluate('width * 2')).toThrow('Unknown parameter “width”');
    expect(() => evaluate('foo(2)')).toThrow('Unknown function “foo”');
    expect(() => evaluate('1 / 0')).toThrow('Division by zero');
    expect(() => evaluate('2 $ 3')).toThrow('Unexpected “$”');
    expect(() => evaluate('sqrt(1, 2)')).toThrow('takes 1 value');
  });

  it('never runs code', () => {
    expect(() => evaluate('alert(1)')).toThrow('Unknown function');
    expect(() => evaluate('constructor')).toThrow('Unknown parameter');
    expect(() => evaluate('"x"')).toThrow();
  });

  it('lists the names a formula uses', () => {
    expect(namesIn('length - 2 * margin + pi + max(a, 1)').sort()).toEqual(['a', 'length', 'margin']);
    expect(namesIn('(((')).toEqual([]);
    expect(isValidName('wall_2')).toBe(true);
    expect(isValidName('2wall')).toBe(false);
    expect(isValidName('sqrt')).toBe(false);
  });
});

describe('parameters', () => {
  it('resolve in dependency order, whatever order they are listed in', () => {
    const params = [
      makeParameter('pitch', 'length - 2 * margin'),
      makeParameter('length', '200'),
      makeParameter('margin', '15'),
    ];
    expect(resolveParameters(params)).toEqual({ values: { length: 200, margin: 15, pitch: 170 }, errors: {} });
  });

  it('report loops, duplicates, bad names and bad formulas', () => {
    const a = makeParameter('a', 'b + 1');
    const b = makeParameter('b', 'a * 2');
    const dup = makeParameter('c', '1');
    const dup2 = makeParameter('c', '2');
    const bad = makeParameter('2x', '1');
    const broken = makeParameter('d', '3 +');
    const user = makeParameter('e', 'd * 2');
    const { values, errors } = resolveParameters([a, b, dup, dup2, bad, broken, user]);
    expect(values).toEqual({ c: 1 });
    expect(errors[a.id]).toMatch(/depends on itself/);
    expect(errors[b.id]).toMatch(/depends on itself/);
    expect(errors[dup2.id]).toMatch(/defined twice/);
    expect(errors[bad.id]).toMatch(/isn't a valid name/);
    expect(errors[broken.id]).toMatch(/Incomplete/);
    expect(errors[user.id]).toBe('Uses “d”, which has an error');
  });
});

describe('formula dimensions on features', () => {
  it('resolve to clamped numbers before building', () => {
    const box = makeFeature('box', { length: { expr: 'length' }, width: { expr: 'length / 2' } });
    const hole = makeFeature('hole', { pitch: { expr: 'length - 2 * margin' }, count: { expr: '2.6' } });
    const { features, errors } = resolveFeatures([box, hole], { length: 200, margin: 15 });
    expect(errors).toEqual({});
    expect(features[0].params).toMatchObject({ length: 200, width: 100 });
    expect(features[1].params).toMatchObject({ pitch: 170, count: 3 });
  });

  it('leave out an operation with a bad formula, keep a base with defaults', () => {
    const box = makeFeature('box', { length: { expr: 'nope * 2' } });
    const hole = makeFeature('hole', { diameter: { expr: 'nope' } });
    const { features, errors } = resolveFeatures([box, hole], {});
    expect(errors[box.id]).toMatch(/Length \(X\): Unknown parameter “nope”/);
    expect(errors[hole.id]).toMatch(/Diameter: Unknown parameter/);
    expect(features).toHaveLength(1);
    expect(features[0].params.length).toBe(100); // the box's default
  });

  it('reads what was typed in a number field', () => {
    expect(parseDimensionInput('120')).toBe(120);
    expect(parseDimensionInput(' -2.5 ')).toBe(-2.5);
    expect(parseDimensionInput('length - 30')).toEqual({ expr: 'length - 30' });
    expect(parseDimensionInput('=40')).toEqual({ expr: '40' });
    expect(dimensionValue({ expr: 'a * 2' }, { a: 4 })).toBe(8);
    expect(dimensionValue({ expr: 'a *' }, {})).toBe(null);
    expect(dimensionValue(7, {})).toBe(7);
  });
});
