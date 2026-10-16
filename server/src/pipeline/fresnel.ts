/**
 * FR-08 — Fresnel-zone modeling.
 *
 * Between a Tx and an Rx, space is divided into concentric ellipsoidal Fresnel
 * zones. A reflector (e.g. a chest moving with respiration) crossing zone
 * boundaries modulates the received signal; the direct (line-of-sight) path is
 * the n=0 contribution. Separating the slow Fresnel modulation from the direct
 * path is what makes respiration / fine-motion estimation possible.
 *
 * We provide:
 *  - fresnelZone(): which Fresnel zone a reflection point falls in;
 *  - FresnelExtractor: a per-node band-pass that isolates the dominant slow
 *    Fresnel modulation (DC-removed, smoothed) from the amplitude stream.
 */

const C = 299_792_458; // m/s
/** Wavelength for a 2.4 GHz channel (m). 5 GHz would be ~0.06 m. */
export function wavelength(freqHz = 2.437e9): number {
  return C / freqHz;
}

/**
 * Fresnel zone number for a reflection point P given Tx and Rx positions.
 * Zone n boundary: |TP| + |PR| − |TR| = n·λ/2.
 */
export function fresnelZone(
  tx: { x: number; y: number; z: number },
  rx: { x: number; y: number; z: number },
  p: { x: number; y: number; z: number },
  lambda = wavelength(),
): number {
  const d = (a: typeof tx, b: typeof tx) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const excess = d(tx, p) + d(p, rx) - d(tx, rx);
  return Math.max(0, Math.round((2 * excess) / lambda));
}

/**
 * Isolates the slow Fresnel modulation from an amplitude stream:
 * subtracts a slow DC baseline (long EMA) then smooths the residual (short EMA).
 * The output emphasises the periodic component caused by chest motion.
 */
export class FresnelExtractor {
  private dc = 0;
  private out = 0;
  private inited = false;
  constructor(
    private readonly dcAlpha = 0.01, // slow baseline tracker
    private readonly smoothAlpha = 0.4, // residual smoother
  ) {}

  push(amplitude: number): number {
    if (!this.inited) {
      this.dc = amplitude;
      this.inited = true;
    }
    this.dc += this.dcAlpha * (amplitude - this.dc);
    const residual = amplitude - this.dc;
    this.out += this.smoothAlpha * (residual - this.out);
    return this.out;
  }
}
