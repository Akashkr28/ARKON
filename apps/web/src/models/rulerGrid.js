// Grid lines in model space (metres) on the plane where coordinate `axis` = `level`:
// up to ±half cells around `centre`, trimmed to `bounds` (the model's extent, padded)
// so a coarse grid never runs metres past the model. Every 10th line is "major".
export function gridLines({ axis, level, centre, step, half, bounds }) {
  const [u, v] = [0, 1, 2].filter((i) => i !== axis);
  const range = (i) => {
    const pad = 0.05 * (bounds.max[i] - bounds.min[i]) + step;
    const lo = Math.max(centre[i] - half * step, bounds.min[i] - pad);
    const hi = Math.min(centre[i] + half * step, bounds.max[i] + pad);
    // In whole cells; the epsilon keeps 0.7 / 0.001 from rounding out to an extra cell.
    return [Math.floor(lo / step + 1e-9), Math.ceil(hi / step - 1e-9)];
  };
  const [u0, u1] = range(u);
  const [v0, v1] = range(v);
  const minor = [];
  const major = [];
  const point = (a, b) => {
    const p = [0, 0, 0];
    p[axis] = level;
    p[u] = a;
    p[v] = b;
    return p;
  };
  for (let i = u0; i <= u1; i += 1) {
    (i % 10 === 0 ? major : minor).push(...point(i * step, v0 * step), ...point(i * step, v1 * step));
  }
  for (let j = v0; j <= v1; j += 1) {
    (j % 10 === 0 ? major : minor).push(...point(u0 * step, j * step), ...point(u1 * step, j * step));
  }
  return { minor, major };
}
