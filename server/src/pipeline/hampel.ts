/**
 * FR-06 — Hampel filter: outlier rejection by Median Absolute Deviation (MAD).
 *
 * For each sample we look at a window of `halfWin` neighbours on each side,
 * compute the median and the MAD, and replace the sample by the median if it
 * deviates by more than `nSigma` scaled MADs. 1.4826 makes the MAD a consistent
 * estimator of the standard deviation for Gaussian data.
 */
const MAD_SCALE = 1.4826;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** In-place Hampel filter across a 1-D series (e.g. amplitude over subcarriers). */
export function hampel(x: Float64Array, halfWin = 3, nSigma = 3): Float64Array {
  const n = x.length;
  const out = new Float64Array(x);
  const win: number[] = [];
  for (let i = 0; i < n; i++) {
    win.length = 0;
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(n - 1, i + halfWin);
    for (let j = lo; j <= hi; j++) win.push(x[j]);
    const med = median(win);
    const devs = win.map((v) => Math.abs(v - med));
    const mad = MAD_SCALE * median(devs);
    // When the window is (near-)flat the MAD collapses to ~0; fall back to a
    // mean-absolute-deviation scale so isolated spikes are still rejected
    // instead of slipping through (a classic Hampel degenerate case).
    const scale = mad > 1e-6 ? mad : MAD_SCALE * (devs.reduce((a, b) => a + b, 0) / devs.length || 0);
    if (scale > 1e-9 && Math.abs(x[i] - med) > nSigma * scale) {
      out[i] = med; // replace outlier
    }
  }
  return out;
}
