import { estimateRate } from './vitals.ts';
import { FallDetector } from './fall.ts';
import { config } from '../config.ts';
import type { NodeInfo, ProcessedFrame, SensingState, Settings, Activity, NodeRuntime } from '../types.ts';

/** [variance, people] anchors measured on the simulator (see occupancy estimate). */
const OCC_ANCHORS: [number, number][] = [[0.057, 1], [0.107, 2], [0.12, 3], [0.14, 4]];

function occupancyFromVariance(v: number): number {
  if (v <= OCC_ANCHORS[0][0]) return 1;
  for (let i = 1; i < OCC_ANCHORS.length; i++) {
    const [x0, y0] = OCC_ANCHORS[i - 1];
    const [x1, y1] = OCC_ANCHORS[i];
    if (v <= x1) return y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
  }
  const [xl, yl] = OCC_ANCHORS[OCC_ANCHORS.length - 1];
  return yl + (v - xl) / 0.02;
}

/** Physical room footprint used for the activity heatmap (metres). */
export const ROOM = { w: 6, h: 4.5 };
const GRID_W = 18;
const GRID_H = 12;

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

class Ring {
  private buf: Float64Array;
  private i = 0;
  private filled = false;
  constructor(public readonly size: number) {
    this.buf = new Float64Array(size);
  }
  push(v: number) {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.size;
    if (this.i === 0) this.filled = true;
  }
  /** Chronologically ordered copy of available samples. */
  ordered(): Float64Array {
    if (!this.filled) return this.buf.slice(0, this.i);
    const out = new Float64Array(this.size);
    out.set(this.buf.subarray(this.i));
    out.set(this.buf.subarray(0, this.i), this.size - this.i);
    return out;
  }
}

interface NodeBuf {
  fresnel: Ring;
  motion: number;
  varEnergy: number;
  lastTs: number;
}

/**
 * Inference engine (level 2/3). Buffers processed frames per node and, on each
 * inference tick, derives the aggregate SensingState: presence, occupancy,
 * motion/activity, fall, and vital signs. Operates purely on processed CSI —
 * it never reads simulator ground truth, so it exercises the real path.
 */
export class InferenceEngine {
  private nodes = new Map<string, NodeBuf>();
  private fall = new FallDetector();
  private vitalTick = 0;
  private lastBreathing: number | null = null;
  private lastHeart: number | null = null;
  private breathSnr = 0;
  private lastVarMax = 0;
  private peopleEma = 0;
  private floor = 0; // empty-room presence-score baseline (FR-29)
  private lastScore = 0;
  private lastBreathScore = 0;
  private lastMotionMax = 0;
  lastLatencyMs = 0;

  /** FR-29: capture the current (assumed empty) room as the presence baseline. */
  calibrate(): number {
    this.floor = this.lastScore;
    return this.floor;
  }

  /** Diagnostic scores for the observability view (NFR-18). */
  diag() {
    return {
      presenceScore: round3(this.lastScore),
      breathScore: round3(this.lastBreathScore),
      breathSnr: round3(this.breathSnr),
      varMax: round3(this.lastVarMax),
      motionMax: round3(this.lastMotionMax),
      presenceFloor: round3(this.floor),
    };
  }

  private bufFor(id: string): NodeBuf {
    let b = this.nodes.get(id);
    if (!b) {
      b = { fresnel: new Ring(Math.round(config.csiRateHz * 16)), motion: 0, varEnergy: 0, lastTs: 0 };
      this.nodes.set(id, b);
    }
    return b;
  }

  ingest(p: ProcessedFrame) {
    const b = this.bufFor(p.nodeId);
    b.fresnel.push(p.fresnel);
    b.motion = p.motionEnergy;
    b.varEnergy = p.varEnergy;
    b.lastTs = p.ts;
  }

  drop(id: string) {
    this.nodes.delete(id);
  }

  tick(settings: Settings, nodes: NodeInfo[]): SensingState {
    const t0 = performance.now();
    const now = Date.now();
    const online = nodes.filter((n) => n.online);

    // ---- motion + variance aggregation ----
    let motionSum = 0;
    let motionMax = 0;
    let varMax = 0;
    let varSum = 0;
    const perNode: Record<string, NodeRuntime> = {};
    for (const n of nodes) {
      const b = this.nodes.get(n.id);
      const m = n.online && b ? b.motion : 0;
      const v = n.online && b ? b.varEnergy : 0;
      motionSum += m;
      motionMax = Math.max(motionMax, m);
      varSum += v;
      varMax = Math.max(varMax, v);
      perNode[n.id] = { rssi: n.rssi, signalQuality: n.signalQuality, motionEnergy: m };
    }
    const motionLevel = Math.min(1, motionMax);

    // raw Fresnel RMS — kept only as a diagnostic (NFR-18)
    let breathScore = 0;
    for (const n of online) {
      const b = this.nodes.get(n.id);
      if (!b) continue;
      const sig = b.fresnel.ordered();
      if (sig.length > 8) {
        let v = 0;
        for (const s of sig) v += s * s;
        breathScore = Math.max(breathScore, Math.sqrt(v / sig.length));
      }
    }

    // ---- vitals + breathing evidence (FR-11, FR-12), throttled to ~2 Hz ----
    // Computed before presence: a strong periodic chest signal is itself the
    // evidence that a (still) person is present. Cannot be measured while moving.
    this.vitalTick++;
    if (this.vitalTick % Math.max(1, Math.round(config.inferenceHz / 2)) === 0) {
      const stillEnough = motionLevel < 0.35;
      const breath = stillEnough ? this.bestRate(online, 0.12, 0.55) : null;
      const heart = motionLevel < 0.15 ? this.bestRate(online, 0.8, 2.4) : null;
      this.breathSnr = breath?.snr ?? 0;
      this.lastBreathing = breath && breath.snr > 15 ? Math.round(breath.bpm) : null;
      this.lastHeart = heart && heart.snr > 14 ? Math.round(heart.bpm) : null;
    }

    // ---- presence (FR-09) ----
    // Primary signal is the per-subcarrier amplitude variance: an empty room
    // carries only receiver noise on every subcarrier, while a person (even
    // breathing while still) perturbs many of them. Robust to still vs moving.
    // Higher sensitivity → lower threshold (more sensitive, higher FAR).
    const presenceScore = varMax;
    this.lastScore = presenceScore;
    this.lastVarMax = varMax;
    this.lastBreathScore = breathScore;
    this.lastMotionMax = motionMax;
    // Presence signal is now a coefficient of variation (scale-invariant):
    // empty room ≈ 0.012, one still person ≈ 0.09, several ≈ 0.12+.
    const presenceThresh = 0.06 - 0.04 * settings.sensitivity; // 0.02 .. 0.06
    const effThresh = Math.max(presenceThresh, this.floor * 2);
    const presence = settings.modes.presence && online.length > 0 && presenceScore > effThresh;

    // ---- occupancy estimate (coarse — exact counting is out of scope, 4.6) ----
    // The strongest link's variance (CoV) saturates with occupancy. Measured
    // medians: 1 ≈ 0.057, 2 ≈ 0.107, 3 ≈ 0.12, 4 ≈ 0.14 — so interpolate between
    // those anchors (the old mean/0.1 mapping rounded nearly everything to 1).
    // 2–4 people differ by little, so beyond 2 this stays a coarse estimate.
    const occMetric = varMax;
    const rawCount = presence ? Math.min(8, occupancyFromVariance(occMetric)) : 0;
    this.peopleEma += 0.12 * (rawCount - this.peopleEma);
    const peopleCount = presence ? Math.max(1, Math.round(this.peopleEma)) : 0;

    // ---- activity + fall (FR-10) ----
    const fall = settings.modes.motion && presence && this.fall.update(motionLevel, settings.fallSensitivity, now);
    let activity: Activity = 'absent';
    if (presence) {
      if (fall) activity = 'fall';
      else if (motionLevel > settings.motionThreshold * 2.4) activity = 'walking';
      else if (motionLevel > settings.motionThreshold) activity = 'moving';
      else activity = 'still';
    }
    if (!presence) {
      this.lastBreathing = null;
      this.lastHeart = null;
    }

    const state: SensingState = {
      ts: now,
      privacyMode: settings.privacyMode,
      modes: settings.modes,
      presence,
      peopleCount,
      motionLevel,
      activity,
      fall,
      breathingRateBpm: settings.modes.breathing ? this.lastBreathing : null,
      heartRateBpm: settings.modes.heart ? this.lastHeart : null,
      heatmap: this.heatmap(nodes),
      gridW: GRID_W,
      gridH: GRID_H,
      perNode,
    };
    this.lastLatencyMs = performance.now() - t0;
    return state;
  }

  /** Best (highest-SNR) spectral rate estimate across all online nodes. */
  private bestRate(online: NodeInfo[], fLo: number, fHi: number) {
    let best: { bpm: number; snr: number } | null = null;
    for (const n of online) {
      const b = this.nodes.get(n.id);
      if (!b) continue;
      const est = estimateRate(b.fresnel.ordered(), config.csiRateHz, fLo, fHi, 0.01);
      if (est && (!best || est.snr > best.snr)) best = { bpm: est.bpm, snr: est.snr };
    }
    return best;
  }

  /**
   * Activity heatmap (FR-20): each link between two online nodes lights up its
   * midpoint proportionally to the motion seen on both ends (a person disturbs
   * the link), plus a small radial bump per node. Normalised to 0..1.
   */
  private heatmap(nodes: NodeInfo[]): number[] {
    const grid = new Float64Array(GRID_W * GRID_H);
    const online = nodes.filter((n) => n.online);
    const cell = { w: ROOM.w / GRID_W, h: ROOM.h / GRID_H };
    const add = (px: number, py: number, weight: number, radius: number) => {
      for (let gy = 0; gy < GRID_H; gy++) {
        for (let gx = 0; gx < GRID_W; gx++) {
          const cx = (gx + 0.5) * cell.w;
          const cy = (gy + 0.5) * cell.h;
          const d2 = (cx - px) ** 2 + (cy - py) ** 2;
          grid[gy * GRID_W + gx] += weight * Math.exp(-d2 / (2 * radius * radius));
        }
      }
    };
    for (const n of online) {
      const b = this.nodes.get(n.id);
      add(n.position.x, n.position.y, (b?.motion ?? 0) * 0.4, 0.8);
    }
    for (let i = 0; i < online.length; i++) {
      for (let j = i + 1; j < online.length; j++) {
        const a = online[i];
        const c = online[j];
        const ma = this.nodes.get(a.id)?.motion ?? 0;
        const mc = this.nodes.get(c.id)?.motion ?? 0;
        const link = Math.min(ma, mc);
        if (link > 0.02) {
          add((a.position.x + c.position.x) / 2, (a.position.y + c.position.y) / 2, link, 1.1);
        }
      }
    }
    // Normalise against a fixed floor so receiver noise in an empty room isn't
    // stretched to full scale.
    let max = 0.5;
    for (const v of grid) max = Math.max(max, v);
    const out = new Array(grid.length);
    for (let i = 0; i < grid.length; i++) out[i] = max > 0 ? Math.round((grid[i] / max) * 100) / 100 : 0;
    return out;
  }
}
