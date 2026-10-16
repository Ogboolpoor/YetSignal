/**
 * Spectral rate estimation for vital signs (FR-11 breathing, FR-12 heart).
 *
 * Given a detrended, windowed signal sampled at `fs` Hz, we scan a frequency
 * band with a Goertzel-style DFT and return the dominant frequency, its power
 * and an SNR-like confidence (peak power / mean band power). Working in the
 * frequency domain is what lets us pull a ~0.2–0.5 Hz respiration tone out of a
 * noisy CSI amplitude stream.
 */
export interface RateEstimate {
  freqHz: number;
  bpm: number;
  power: number;
  snr: number;
}

export function estimateRate(
  buf: Float64Array,
  fs: number,
  fLoHz: number,
  fHiHz: number,
  stepHz = 0.01,
): RateEstimate | null {
  const n = buf.length;
  if (n < fs * 4) return null; // need a few seconds of data

  // detrend (remove mean) + Hann window
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    w[i] = (buf[i] - mean) * hann;
  }

  let bestF = 0;
  let bestP = -Infinity;
  const powers: number[] = [];
  for (let f = fLoHz; f <= fHiHz; f += stepHz) {
    let re = 0;
    let im = 0;
    const omega = (2 * Math.PI * f) / fs;
    for (let i = 0; i < n; i++) {
      re += w[i] * Math.cos(omega * i);
      im += w[i] * Math.sin(omega * i);
    }
    const p = re * re + im * im;
    powers.push(p);
    if (p > bestP) {
      bestP = p;
      bestF = f;
    }
  }
  // Confidence = peak / median band power. The median tracks the noise floor and
  // is robust to the peak and its main lobe, so a clean tone scores very high
  // while broadband noise scores low (peak/mean would saturate near the lobe).
  const sorted = [...powers].sort((a, b) => a - b);
  const medP = sorted[sorted.length >> 1] || 1e-12;
  const snr = bestP / medP;
  return { freqHz: bestF, bpm: bestF * 60, power: bestP, snr };
}
