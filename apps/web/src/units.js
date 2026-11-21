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
