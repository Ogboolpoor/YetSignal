/**
 * FR-07 — SpotFi-style phase sanitisation.
 *
 * Raw CSI phase on commodity hardware is corrupted by a Sampling Time Offset
 * (STO) and Carrier Frequency Offset (CFO), which together add a term that is
 * approximately linear in the subcarrier index, plus a constant offset. SpotFi
 * removes this by fitting a line to the unwrapped phase across subcarriers and
 * subtracting it, leaving the propagation-induced phase.
 *
 *   φ̂_k = φ_k − (a·k + b)
 *
 * where a, b are the least-squares slope/intercept of the unwrapped phase.
 */

/** Unwrap phase so successive differences stay within (−π, π]. */
export function unwrap(phase: Float64Array): Float64Array {
  const out = new Float64Array(phase.length);
  if (phase.length === 0) return out;
  out[0] = phase[0];
  let prev = phase[0];
  let acc = 0;
  for (let i = 1; i < phase.length; i++) {
    let d = phase[i] - prev;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    acc += d;
    out[i] = phase[0] + acc;
    prev = phase[i];
  }
  return out;
}

/** Remove the linear (STO/CFO) trend across subcarriers. Returns sanitised phase. */
export function sanitisePhase(re: Float64Array, im: Float64Array): Float64Array {
  const n = re.length;
  const raw = new Float64Array(n);
  for (let k = 0; k < n; k++) raw[k] = Math.atan2(im[k], re[k]);
  const uw = unwrap(raw);

  // Least-squares fit φ ≈ a·k + b over k = 0..n-1.
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let k = 0; k < n; k++) {
    sx += k;
    sy += uw[k];
    sxx += k * k;
    sxy += k * uw[k];
  }
  const denom = n * sxx - sx * sx;
  const a = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const b = (sy - a * sx) / n;

  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) out[k] = uw[k] - (a * k + b);
  return out;
}
