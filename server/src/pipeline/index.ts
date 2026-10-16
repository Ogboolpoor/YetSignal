import { hampel } from './hampel.ts';
import { sanitisePhase } from './phase.ts';
import { FresnelExtractor } from './fresnel.ts';
import type { CsiFrame, ProcessedFrame } from '../types.ts';

interface NodeState {
  prevAmp: Float64Array | null;
  motion: number; // smoothed motion energy
  fresnel: FresnelExtractor;
  emaMean: Float64Array | null; // per-subcarrier running mean
  emaVar: Float64Array | null; // per-subcarrier running variance
  kSel: number; // currently selected (most-modulated) subcarrier
}

/**
 * Signal-processing pipeline (level 2). Per CSI frame it runs:
 *   1. amplitude/phase extraction,
 *   2. Hampel outlier rejection on amplitude (FR-06),
 *   3. SpotFi phase sanitisation (FR-07),
 *   4. Fresnel slow-modulation extraction (FR-08),
 *   5. short-term motion-energy estimate.
 *
 * Tracks rolling average per-frame processing time to report KPI-04 / NFR-01.
 */
export class Pipeline {
  private nodes = new Map<string, NodeState>();
  private procTimeUs = 0; // EMA of per-frame processing time (microseconds)
  private frames = 0;

  get avgFrameProcUs(): number {
    return this.procTimeUs;
  }

  reset(nodeId: string) {
    this.nodes.delete(nodeId);
  }

  process(frame: CsiFrame): ProcessedFrame {
    const t0 = process.hrtime.bigint();
    const n = frame.re.length;

    // amplitude + raw phase
    const amp = new Float64Array(n);
    for (let k = 0; k < n; k++) amp[k] = Math.hypot(frame.re[k], frame.im[k]);

    const amplitude = hampel(amp, 3, 3); // FR-06
    const phase = sanitisePhase(frame.re, frame.im); // FR-07

    let st = this.nodes.get(frame.nodeId);
    if (!st) {
      st = { prevAmp: null, motion: 0, fresnel: new FresnelExtractor(), emaMean: null, emaVar: null, kSel: 0 };
      this.nodes.set(frame.nodeId, st);
    }

    // motion energy: normalised mean absolute amplitude change between frames
    let energy = 0;
    if (st.prevAmp && st.prevAmp.length === n) {
      let diff = 0;
      let mag = 0;
      for (let k = 0; k < n; k++) {
        diff += Math.abs(amplitude[k] - st.prevAmp[k]);
        mag += amplitude[k];
      }
      energy = mag > 0 ? Math.min(1, (diff / mag) * 6) : 0;
    }
    st.prevAmp = amplitude;
    st.motion += 0.35 * (energy - st.motion); // smooth

    // Track per-subcarrier running mean/variance and feed the Fresnel extractor
    // with the *most modulated* subcarrier — that is where chest motion and
    // fine movement are most observable (where direct & reflected paths beat).
    if (!st.emaMean) {
      st.emaMean = new Float64Array(amplitude);
      st.emaVar = new Float64Array(n);
    }
    let kVar = 0;
    let vMax = -Infinity;
    let vSum = 0;
    let ampSum = 0;
    const mean = st.emaMean;
    const varr = st.emaVar!;
    for (let k = 0; k < n; k++) {
      const d = amplitude[k] - mean[k];
      mean[k] += 0.02 * d;
      varr[k] += 0.02 * (d * d - varr[k]);
      vSum += varr[k];
      ampSum += amplitude[k];
      if (varr[k] > vMax) {
        vMax = varr[k];
        kVar = k;
      }
    }
    // Coefficient of variation (std / mean): scale-invariant presence signal, so
    // the same thresholds hold for simulated and real hardware regardless of the
    // absolute CSI amplitude scale. Empty room ≈ noise floor.
    const meanAmp = ampSum / n;
    const varEnergy = Math.sqrt(vSum / n) / Math.max(meanAmp, 1e-6);
    // Hysteresis: only switch the tracked subcarrier when another is clearly
    // more modulated, so a stable breathing tone isn't chopped up by ties.
    if (varr[kVar] > varr[st.kSel] * 1.3) st.kSel = kVar;
    // Feed the *mean-removed* residual so that switching the selected subcarrier
    // never injects a baseline-amplitude step (only true modulation passes).
    const fresnel = st.fresnel.push(amplitude[st.kSel] - mean[st.kSel]); // FR-08

    const us = Number(process.hrtime.bigint() - t0) / 1000;
    this.procTimeUs += this.frames < 50 ? (us - this.procTimeUs) / (this.frames + 1) : 0.02 * (us - this.procTimeUs);
    this.frames++;

    return { nodeId: frame.nodeId, ts: frame.ts, amplitude, phase, fresnel, motionEnergy: st.motion, varEnergy };
  }
}
