// Client-side mirror of the server's protocol types (server/src/types.ts).

export interface SensingModes {
  presence: boolean;
  motion: boolean;
  breathing: boolean;
  heart: boolean;
  pose: boolean;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface NodeInfo {
  id: string;
  name: string;
  ip: string | null;
  room: string;
  firmware: string;
  channel: number;
  online: boolean;
  simulated: boolean;
  lastSeen: number;
  rssi: number;
  signalQuality: number;
  temperatureC: number | null;
  position: Vec3;
}

export type Activity = 'absent' | 'still' | 'moving' | 'walking' | 'fall';

export interface NodeRuntime {
  rssi: number;
  signalQuality: number;
  motionEnergy: number;
}

export interface SensingState {
  ts: number;
  privacyMode: boolean;
  modes: SensingModes;
  presence: boolean;
  peopleCount: number;
  motionLevel: number;
  activity: Activity;
  fall: boolean;
  breathingRateBpm: number | null;
  heartRateBpm: number | null;
  heatmap: number[];
  gridW: number;
  gridH: number;
  perNode: Record<string, NodeRuntime>;
}

export type DataCategory = 'raw_csi' | 'derived' | 'vital';

export interface Settings {
  modes: SensingModes;
  privacyMode: boolean;
  sensitivity: number;
  motionThreshold: number;
  fallSensitivity: number;
  retention: Record<DataCategory, number>;
  locale: 'uk' | 'en';
}

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
  avgFrameProcUs: number;
  inferenceLatencyMs: number;
  uptimeSec: number;
  nodesOnline: number;
  presenceScore: number;
  breathScore: number;
  breathSnr: number;
  varMax: number;
  motionMax: number;
  presenceFloor: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
  ts: number;
  level: LogLevel;
  msg: string;
}

export type ServerMessage =
  | { type: 'hello'; server: ServerInfo; settings: Settings; nodes: NodeInfo[]; state: SensingState }
  | { type: 'state'; state: SensingState }
  | { type: 'node'; node: NodeInfo }
  | { type: 'node_removed'; id: string }
  | { type: 'settings'; settings: Settings }
  | { type: 'csi'; nodeId: string; amplitude: number[] }
  | { type: 'event'; event: unknown }
  | { type: 'log'; ts: number; level: LogLevel; msg: string }
  | { type: 'metrics'; metrics: Metrics };
