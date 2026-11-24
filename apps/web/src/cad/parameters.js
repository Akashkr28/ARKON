// Named parameters ("length = 200", "margin = 15", "pitch = length - 2 * margin") and
// formula dimensions on features. Everything resolves to plain numbers before the part
// is built, so cad/buildPart.js never sees a formula.

import { ExpressionError, evaluate, isValidName, namesIn } from './expressions';
import { FEATURE_TYPES, clampParam } from './features';

let nextId = 1;
export function makeParameter(name, expression) {
  return { id: `p${Date.now().toString(36)}${(nextId++).toString(36)}`, name, expression: String(expression) };
}

// A dimension is a number, or a formula { expr: "length - 30" }.
export const isFormula = (value) => Boolean(value && typeof value === 'object' && 'expr' in value);

// → { values: { name: number }, errors: { parameterId: message } }
// Each parameter may use those it refers to, in any order; loops are reported.
export function resolveParameters(parameters) {
  const values = {};
  const errors = {};
  const seen = new Set();
  const usable = [];
  for (const p of parameters) {
    if (!isValidName(p.name)) {
      errors[p.id] = `“${p.name}” isn't a valid name (letters, digits, _; not a function name)`;
    } else if (seen.has(p.name)) {
      errors[p.id] = `“${p.name}” is defined twice`;
    } else {
      seen.add(p.name);
      usable.push(p);
    }
  }

  // Evaluate whatever has its inputs ready, until nothing more resolves.
  const failed = new Set();
  const settled = (name) => Object.hasOwn(values, name) || failed.has(name);
  let pending = usable;
  for (;;) {
    const waiting = [];
    for (const p of pending) {
      const needs = namesIn(p.expression);
      if (needs.some((name) => seen.has(name) && !settled(name))) {
        waiting.push(p);
        continue;
      }
      const broken = needs.find((name) => failed.has(name));
      try {
        if (broken) throw new ExpressionError(`Uses “${broken}”, which has an error`);
        values[p.name] = evaluate(p.expression, values);
      } catch (error) {
        errors[p.id] = error instanceof ExpressionError ? error.message : String(error);
        failed.add(p.name);
      }
    }
    if (waiting.length === pending.length) {
      for (const p of waiting) {
        errors[p.id] = `“${p.name}” depends on itself (through ${namesIn(p.expression).join(', ')})`;
        failed.add(p.name);
      }
      break;
    }
    pending = waiting;
    if (!pending.length) break;
  }
  return { values, errors };
}

// → { features: with every formula replaced by its (clamped) number,
//     errors: { featureId: message } } — a feature with a bad formula is left out.
export function resolveFeatures(features, values) {
  const errors = {};
  const resolved = [];
  for (const feature of features) {
    const params = {};
    let failed = null;
    for (const [key, value] of Object.entries(feature.params)) {
      if (!isFormula(value)) {
        params[key] = value;
        continue;
      }
      try {
        params[key] = clampParam(feature.type, key, evaluate(value.expr, values));
      } catch (error) {
        const label = FEATURE_TYPES[feature.type].params.find((p) => p.key === key)?.label ?? key;
        failed = `${label}: ${error instanceof ExpressionError ? error.message : String(error)}`;
        break;
      }
    }
    if (failed) {
      errors[feature.id] = failed;
      // The base shape is still needed for everything after it; operations can be skipped.
      if (FEATURE_TYPES[feature.type].base) resolved.push({ ...feature, params: { ...feature.params, ...defaultsFor(feature) } });
      continue;
    }
    resolved.push({ ...feature, params });
  }
  return { features: resolved, errors };
}

function defaultsFor(feature) {
  return Object.fromEntries(
    FEATURE_TYPES[feature.type].params.filter((p) => isFormula(feature.params[p.key])).map((p) => [p.key, p.value]),
  );
}

// What a number field holds after typing: a number, or a formula when it isn't one.
// "=" in front forces a formula ("=40" stays linked as a formula).
export function parseDimensionInput(text) {
  const trimmed = String(text).trim();
  if (trimmed.startsWith('=')) return { expr: trimmed.slice(1).trim() };
  if (/^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i.test(trimmed)) return Number(trimmed);
  return { expr: trimmed };
}

// The value a dimension shows: its number, or its formula's result (or null).
export function dimensionValue(value, values) {
  if (!isFormula(value)) return value;
  try {
    return evaluate(value.expr, values);
  } catch {
    return null;
  }
}
