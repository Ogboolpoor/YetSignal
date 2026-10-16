import { config, defaultSettings } from './config.ts';
import { logger } from './logger.ts';
import { store } from './db.ts';
import { Pipeline } from './pipeline/index.ts';
import { InferenceEngine } from './inference/index.ts';
import type { CsiSimulator } from './csi/simulator.ts';
import type { MqttIntegration } from './integrations/mqtt.ts';
import type {
  CsiFrame,
  NodeInfo,
  SensingState,
  ServerMessage,
  Settings,
  Metrics,
  TelemetryEvent,
  SensingModes,
} from './types.ts';

const log = logger('hub');
const OFFLINE_AFTER_MS = 5000;

/**
 * Application core (level 3). Owns the live system state and coordinates the
 * pipeline, inference, persistence, integrations and client broadcast. The API
 * layers (REST/WS) are thin wrappers over the command methods here.
 */
export class Hub {
  settings: Settings;
  readonly nodes = new Map<string, NodeInfo>();
  state: SensingState;
  readonly pipeline = new Pipeline();
  readonly inference = new InferenceEngine();
  simulator: CsiSimulator | null = null;
  mqtt: MqttIntegration | null = null;

  private broadcastFn: (m: ServerMessage) => void = () => {};
  private startedAt = Date.now();
  private frameCount = 0;
  private framesPerSec = 0;
  private csiPreviewAt = 0;
  private persistAt = 0;
  private prevFall = false;
  private prevPresence = false;

  constructor() {
    this.settings = store.loadSettings();
    this.state = this.emptyState();
  }

  // ---- wiring ----
  setBroadcast(fn: (m: ServerMessage) => void) {
    this.broadcastFn = fn;
  }
  broadcast(m: ServerMessage) {
    this.broadcastFn(m);
  }

  start() {
    setInterval(() => this.tickInference(), 1000 / config.inferenceHz);
    setInterval(() => this.sweep(), 1000);
    setInterval(() => {
      this.framesPerSec = this.frameCount;
      this.frameCount = 0;
    }, 1000);
    // retention sweep hourly (FR-35)
    setInterval(() => {
      const n = store.applyRetention(this.settings.retention);
      if (n > 0) log.debug(`retention removed ${n} rows`);
    }, 3600_000);
    store.applyRetention(this.settings.retention);
    log.info('hub started');
  }

  // ---- ingestion ----
  ingestFrame(frame: CsiFrame) {
    this.touchNode(frame.nodeId, { rssi: frame.rssi });
    if (this.settings.privacyMode) return; // FR-23 / SR-02 — sensing suspended
    const processed = this.pipeline.process(frame);
    this.inference.ingest(processed);
    this.frameCount++;
    // throttled CSI amplitude preview for the debug view (raw CSI never stored)
    const now = Date.now();
    if (now - this.csiPreviewAt > 250) {
      this.csiPreviewAt = now;
      this.broadcast({
        type: 'csi',
        nodeId: frame.nodeId,
        amplitude: Array.from(processed.amplitude, (v) => Math.round(v * 100) / 100),
      });
    }
  }

  // ---- node registry (FR-15, FR-18) ----
  registerNode(info: NodeInfo) {
    const existing = this.nodes.get(info.id); // dedup by MAC (4.1.3)
    const merged: NodeInfo = { ...info, online: true, lastSeen: Date.now() };
    this.nodes.set(info.id, merged);
    store.upsertNode(merged);
    if (!existing) log.info(`node registered ${info.id} (${info.name})`);
    this.broadcast({ type: 'node', node: merged });
  }

  private touchNode(id: string, patch: Partial<NodeInfo>) {
    const n = this.nodes.get(id);
    if (!n) return;
    Object.assign(n, patch, { online: true, lastSeen: Date.now() });
    if (typeof patch.rssi === 'number') {
      n.signalQuality = Math.max(0, Math.min(1, (patch.rssi + 90) / 50));
    }
  }

  removeNode(id: string) {
    this.nodes.delete(id);
    this.inference.drop(id);
    this.pipeline.reset(id);
    store.removeNode(id);
    this.simulator?.removeNode(id);
    this.broadcast({ type: 'node_removed', id });
    log.info(`node removed ${id}`);
  }

  private sweep() {
    const now = Date.now();
    let changed = false;
    for (const n of this.nodes.values()) {
      const online = now - n.lastSeen < OFFLINE_AFTER_MS;
      if (online !== n.online) {
        n.online = online;
        changed = true;
        if (!online) log.warn(`node offline ${n.id} (${n.name})`); // NFR-19
        this.broadcast({ type: 'node', node: n });
      }
    }
    if (changed) this.publishMetrics();
  }

  // ---- inference loop ----
  private tickInference() {
    const nodes = [...this.nodes.values()];
    if (this.settings.privacyMode) {
      this.state = { ...this.emptyState(), privacyMode: true };
    } else {
      this.state = this.inference.tick(this.settings, nodes);
    }
    this.broadcast({ type: 'state', state: this.state });
    this.persist(this.state);
    this.notify(this.state);
    this.mqtt?.publishState(this.state);
    this.publishMetrics();
  }

  private persist(s: SensingState) {
    const now = Date.now();
    if (now - this.persistAt < 1000) return; // ~1 Hz
    this.persistAt = now;
    const room = 'default';
    const push = (e: Omit<TelemetryEvent, 'ts' | 'room'>) => {
      if (this.settings.retention[e.category] === 0 && e.category === 'raw_csi') return;
      store.insertEvent({ ts: now, room, ...e });
    };
    push({ nodeId: null, category: 'derived', kind: 'presence', value: s.presence ? 1 : 0 });
    push({ nodeId: null, category: 'derived', kind: 'people_count', value: s.peopleCount });
    push({ nodeId: null, category: 'derived', kind: 'motion', value: Math.round(s.motionLevel * 100) / 100 });
    if (s.breathingRateBpm != null)
      push({ nodeId: null, category: 'vital', kind: 'breathing', value: s.breathingRateBpm });
    if (s.heartRateBpm != null) push({ nodeId: null, category: 'vital', kind: 'heart', value: s.heartRateBpm });
  }

  private notify(s: SensingState) {
    // FR-27 / NFR-19 — edge-triggered notifications
    if (s.fall && !this.prevFall) {
      log.error('ALERT: fall detected');
      this.broadcast({ type: 'event', event: { ts: s.ts, nodeId: null, room: 'default', category: 'derived', kind: 'fall', value: 1 } });
      this.mqtt?.publishEvent('fall', 1);
    }
    if (s.presence !== this.prevPresence) {
      log.info(`presence ${s.presence ? 'detected' : 'cleared'}`);
    }
    this.prevFall = s.fall;
    this.prevPresence = s.presence;
  }

  private publishMetrics() {
    const m: Metrics = this.metrics();
    this.broadcast({ type: 'metrics', metrics: m });
  }

  metrics(): Metrics {
    return {
      framesPerSec: this.framesPerSec,
      avgFrameProcUs: Math.round(this.pipeline.avgFrameProcUs * 10) / 10,
      inferenceLatencyMs: Math.round(this.inference.lastLatencyMs * 100) / 100,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      nodesOnline: [...this.nodes.values()].filter((n) => n.online).length,
      ...this.inference.diag(),
    };
  }

  // ---- commands (FR-22, FR-23, FR-29, FR-30) ----
  setSettings(patch: Partial<Settings>, actor = 'operator') {
    this.settings = { ...this.settings, ...patch, modes: { ...this.settings.modes, ...(patch.modes ?? {}) } };
    store.saveSettings(this.settings);
    store.audit(actor, 'set_settings', patch); // FR-32
    this.broadcast({ type: 'settings', settings: this.settings });
    log.info('settings updated');
  }

  setMode(mode: keyof SensingModes, on: boolean, actor = 'operator') {
    this.setSettings({ modes: { ...this.settings.modes, [mode]: on } }, actor);
  }

  setPrivacy(on: boolean, actor = 'user') {
    this.setSettings({ privacyMode: on }, actor);
    log.warn(`privacy mode ${on ? 'ENABLED — sensing suspended' : 'disabled'}`); // FR-23
  }

  calibrate(actor = 'operator'): number {
    const floor = this.inference.calibrate();
    store.audit(actor, 'calibrate', { floor });
    log.info(`calibrated empty-room baseline = ${floor.toFixed(4)}`);
    return floor;
  }

  serverInfo() {
    return {
      name: 'YetSignal',
      version: config.version,
      startedAt: this.startedAt,
      csiRateHz: config.csiRateHz,
      mqtt: !!this.mqtt?.connected,
      simulator: !!this.simulator,
    };
  }

  private emptyState(): SensingState {
    return {
      ts: Date.now(),
      privacyMode: this.settings?.privacyMode ?? false,
      modes: this.settings?.modes ?? defaultSettings.modes,
      presence: false,
      peopleCount: 0,
      motionLevel: 0,
      activity: 'absent',
      fall: false,
      breathingRateBpm: null,
      heartRateBpm: null,
      heatmap: new Array(18 * 12).fill(0),
      gridW: 18,
      gridH: 12,
      perNode: {},
    };
  }
}

export const hub = new Hub();
