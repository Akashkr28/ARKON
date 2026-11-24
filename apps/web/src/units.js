// Lengths are stored in metres (glTF's unit; our converter writes STEP models in metres)
// and shown in the user's chosen unit.

export const LENGTH_UNITS = {
  mm: { label: 'mm', perMetre: 1000, decimals: 1 },
  cm: { label: 'cm', perMetre: 100, decimals: 2 },
  m: { label: 'm', perMetre: 1, decimals: 3 },
  in: { label: 'in', perMetre: 39.3700787, decimals: 2 },
};

// `precise`: always keep the unit's decimals (measurements); otherwise big numbers are
// rounded (1780 mm, not 1780.0 mm, for overall sizes).
export function formatLength(metres, unit = 'mm', { precise = false } = {}) {
  if (metres === null || metres === undefined || Number.isNaN(metres)) return '—';
  const { label, perMetre, decimals } = LENGTH_UNITS[unit] ?? LENGTH_UNITS.mm;
  const value = metres * perMetre;
  const shown = !precise && Math.abs(value) >= 100 ? Math.round(value).toString() : value.toFixed(decimals);
  return `${shown} ${label}`;
}

export function formatSize([x, y, z], unit = 'mm') {
  const { label } = LENGTH_UNITS[unit] ?? LENGTH_UNITS.mm;
  const bare = (v) => formatLength(v, unit).replace(` ${label}`, '');
  return `${bare(x)} × ${bare(y)} × ${bare(z)} ${label}`;
}

// Engineering data (part specs) comes in millimetres; areas and volumes follow the
// chosen length unit (mm → mm², in → in³). Metres show areas in m² and volumes in litres
// would mislead, so they stay m³.
const SPEC_DECIMALS = { mm: 1, cm: 2, m: 4, in: 3 };

function fixed(value, decimals) {
  if (Math.abs(value) >= 1e6) return Math.round(value).toLocaleString('en-US');
  if (Math.abs(value) >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return value.toFixed(decimals);
}

export function formatSpecLength(mm, unit = 'mm') {
  if (mm === null || mm === undefined) return '—';
  const { label, perMetre } = LENGTH_UNITS[unit] ?? LENGTH_UNITS.mm;
  return `${fixed((mm / 1000) * perMetre, SPEC_DECIMALS[unit] ?? 2)} ${label}`;
}

export function formatArea(mm2, unit = 'mm') {
  if (mm2 === null || mm2 === undefined) return '—';
  const { label, perMetre } = LENGTH_UNITS[unit] ?? LENGTH_UNITS.mm;
  return `${fixed(mm2 * 1e-6 * perMetre ** 2, SPEC_DECIMALS[unit] ?? 2)} ${label}²`;
}

export function formatVolume(mm3, unit = 'mm') {
  if (mm3 === null || mm3 === undefined) return '—';
  const { label, perMetre } = LENGTH_UNITS[unit] ?? LENGTH_UNITS.mm;
  return `${fixed(mm3 * 1e-9 * perMetre ** 3, SPEC_DECIMALS[unit] ?? 2)} ${label}³`;
}

export const KG_PER_LB = 0.45359237;

// Pounds alongside kilograms when the user works in inches.
export function formatMass(kg, unit = 'mm') {
  if (kg === null || kg === undefined) return '—';
  const metric = kg < 1 ? `${(kg * 1000).toFixed(1)} g` : `${fixed(kg, 3)} kg`;
  return unit === 'in' ? `${fixed(kg / KG_PER_LB, 3)} lb (${metric})` : metric;
}
