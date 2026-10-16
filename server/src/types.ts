/**
 * Shared domain types and the WebSocket/REST message contracts for YetSignal.
 * Mirrors web/src/types.ts (kept in sync by hand — small surface).
 */

/** Sensing modes the system can run (FR-09 … FR-14). Toggled per scenario. */
export interface SensingModes {
  presence: boolean; // FR-09 (always the most reliable mode)
  motion: boolean; // FR-10 (motion / activity / fall)
  breathing: boolean; // FR-11
  heart: boolean; // FR-12 (auxiliary, non-critical)
  pose: boolean; // FR-13 (needs several nodes)
}

/** A sensor node (ESP32-S3 or a simulated one). Registry record (FR-18). */
export interface NodeInfo {
  id: string; // MAC address — dedup key (4.1.3)
  name: string;
  ip: string | null;
  room: string;
  firmware: string;
  channel: number; // 1 | 6 | 11 (FR-03)
  online: boolean;
  simulated: boolean;
  lastSeen: number; // epoch ms (UTC)
  rssi: number; // dBm
  signalQuality: number; // 0..1 (derived from rssi + frame health)
  temperatureC: number | null; // NFR-18 (if sensor present)
  position: Vec3; // metres, for 3D topology (FR-19)
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** One CSI capture frame from a node. BW20 → 56 complex subcarriers (FR-02). */
export interface CsiFrame {
  nodeId: string;
  ts: number; // epoch ms (UTC) — FR-33
  channel: number;
  rssi: number;
  /** Real/imaginary interleaved is common on-wire; here we keep parallel arrays. */
  re: Float64Array;
  im: Float64Array;
}

/** Output of the signal-processing pipeline for one frame. */
export interface ProcessedFrame {
  nodeId: string;
  ts: number;
  amplitude: Float64Array; // Hampel-filtered magnitude per subcarrier
  phase: Float64Array; // SpotFi-sanitised phase per subcarrier
  /** Fresnel-filtered scalar (dominant slow-path variation) used for vitals. */
  fresnel: number;
  /** Short-term motion energy in [0..1]. */
  motionEnergy: number;
  /** Mean per-subcarrier amplitude variance — robust presence signal. */
  varEnergy: number;
}

/** Aggregated, derived sensing state broadcast to clients each inference tick. */
export interface SensingState {
  ts: number; // UTC ms
  privacyMode: boolean; // FR-23
  modes: SensingModes;
  presence: boolean; // FR-09
  peopleCount: number; // estimate
  motionLevel: number; // 0..1
  activity: Activity; // FR-10
  fall: boolean; // FR-10
  breathingRateBpm: number | null; // FR-11
  heartRateBpm: number | null; // FR-12
  heatmap: number[]; // row-major grid, 0..1 (FR-20)
  gridW: number;
  gridH: number;
  perNode: Record<string, NodeRuntime>;
}

export type Activity = 'absent' | 'still' | 'moving' | 'walking' | 'fall';

export interface NodeRuntime {
  rssi: number;
  signalQuality: number;
  motionEnergy: number;
}

/** Categories of stored telemetry with distinct retention policies (FR-34, FR-35). */
export type DataCategory = 'raw_csi' | 'derived' | 'vital';

export interface TelemetryEvent {
  ts: number; // UTC ms (FR-33)
  nodeId: string | null;
  room: string;
  category: DataCategory;
  kind: string; // e.g. 'presence', 'people_count', 'breathing', 'fall'
  value: number; // numeric value (bool → 0/1)
  meta?: Record<string, unknown>;
}

/** Tunable thresholds & sensitivity (FR-22, FR-30). */
export interface Settings {
  modes: SensingModes;
  privacyMode: boolean;
  /** Presence detection sensitivity 0..1 (higher = more sensitive → fewer misses, more FAR). */
  sensitivity: number;
  /** Motion energy threshold above which "moving" is reported. */
  motionThreshold: number;
  /** Fall detection sensitivity 0..1. */
  fallSensitivity: number;
  /** Retention in days per category (FR-35). 0 = do not store. */
  retention: Record<DataCategory, number>;
  locale: 'uk' | 'en';
}

// ---- WebSocket message contracts -------------------------------------------

export type ServerMessage =
  | { type: 'hello'; server: ServerInfo; settings: Settings; nodes: NodeInfo[]; state: SensingState }
  | { type: 'state'; state: SensingState }
  | { type: 'node'; node: NodeInfo }
  | { type: 'node_removed'; id: string }
  | { type: 'settings'; settings: Settings }
  | { type: 'csi'; nodeId: string; amplitude: number[] } // throttled debug preview
  | { type: 'event'; event: TelemetryEvent }
  | { type: 'log'; ts: number; level: LogLevel; msg: string }
  | { type: 'metrics'; metrics: Metrics };

export type ClientMessage =
  | { type: 'set_settings'; patch: Partial<Settings> }
  | { type: 'set_mode'; mode: keyof SensingModes; on: boolean }
  | { type: 'set_privacy'; on: boolean }
  | { type: 'calibrate'; nodeId?: string } // FR-29
  | { type: 'sim'; action: SimAction };

export type SimAction =
  | { kind: 'set_people'; count: number }
  | { kind: 'trigger_fall' }
  | { kind: 'add_node' }
  | { kind: 'remove_node'; id: string };

export interface ServerInfo {
  name: string;
  version: string;
  startedAt: number;
  csiRateHz: number;
  mqtt: boolean;
  simulator: boolean;
}

export interface Metrics {
  framesPerSec: number;
  avgFrameProcUs: number; // KPI-04 / NFR-01
  inferenceLatencyMs: number; // KPI-03 contribution
  uptimeSec: number;
  nodesOnline: number;
  // diagnostics (NFR-18)
  presenceScore: number;
  breathScore: number;
  breathSnr: number;
  varMax: number;
  motionMax: number;
  presenceFloor: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
