import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config, defaultSettings } from './config.ts';
import { logger } from './logger.ts';
import type { NodeInfo, Settings, TelemetryEvent, DataCategory } from './types.ts';

const log = logger('db');

/**
 * Local persistence (NFR-10): node registry, telemetry events with per-category
 * retention, settings and an access/audit log. Uses the built-in node:sqlite,
 * so no native build step is required.
 */
class Store {
  private db: DatabaseSync;

  constructor() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const file = path.join(config.dataDir, 'yetsignal.db');
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
    log.info(`opened ${file}`);
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ip TEXT,
        room TEXT NOT NULL DEFAULT 'default',
        firmware TEXT NOT NULL DEFAULT 'unknown',
        channel INTEGER NOT NULL DEFAULT 1,
        simulated INTEGER NOT NULL DEFAULT 0,
        pos_x REAL NOT NULL DEFAULT 0,
        pos_y REAL NOT NULL DEFAULT 0,
        pos_z REAL NOT NULL DEFAULT 0,
        last_seen INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        node_id TEXT,
        room TEXT NOT NULL,
        category TEXT NOT NULL,
        kind TEXT NOT NULL,
        value REAL NOT NULL,
        meta TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, ts);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT
      );
    `);
  }

  // ---- nodes (FR-18) ----
  upsertNode(n: NodeInfo) {
    this.db
      .prepare(
        `INSERT INTO nodes (id,name,ip,room,firmware,channel,simulated,pos_x,pos_y,pos_z,last_seen)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, ip=excluded.ip, room=excluded.room, firmware=excluded.firmware,
           channel=excluded.channel, simulated=excluded.simulated,
           pos_x=excluded.pos_x, pos_y=excluded.pos_y, pos_z=excluded.pos_z, last_seen=excluded.last_seen`,
      )
      .run(
        n.id,
        n.name,
        n.ip,
        n.room,
        n.firmware,
        n.channel,
        n.simulated ? 1 : 0,
        n.position.x,
        n.position.y,
        n.position.z,
        n.lastSeen,
      );
  }

  removeNode(id: string) {
    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
  }

  listNodes(): Array<Omit<NodeInfo, 'online' | 'rssi' | 'signalQuality' | 'temperatureC'>> {
    const rows = this.db.prepare('SELECT * FROM nodes ORDER BY name').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      ip: r.ip,
      room: r.room,
      firmware: r.firmware,
      channel: r.channel,
      simulated: !!r.simulated,
      lastSeen: r.last_seen,
      position: { x: r.pos_x, y: r.pos_y, z: r.pos_z },
    }));
  }

  // ---- events (FR-33, FR-34) ----
  insertEvent(e: TelemetryEvent) {
    this.db
      .prepare('INSERT INTO events (ts,node_id,room,category,kind,value,meta) VALUES (?,?,?,?,?,?,?)')
      .run(e.ts, e.nodeId, e.room, e.category, e.kind, e.value, e.meta ? JSON.stringify(e.meta) : null);
  }

  history(kind: string, sinceMs: number): Array<{ ts: number; value: number }> {
    const rows = this.db
      .prepare('SELECT ts, value FROM events WHERE kind = ? AND ts >= ? ORDER BY ts')
      .all(kind, sinceMs) as any[];
    return rows.map((r) => ({ ts: r.ts, value: r.value }));
  }

  /** Apply retention policies (FR-35). Returns number of rows deleted. */
  applyRetention(retention: Record<DataCategory, number>): number {
    let deleted = 0;
    const now = Date.now();
    for (const [cat, days] of Object.entries(retention) as [DataCategory, number][]) {
      if (days <= 0) {
        // 0 days = do not retain this category at all (NFR-21 for raw_csi)
        const r = this.db.prepare('DELETE FROM events WHERE category = ?').run(cat);
        deleted += Number(r.changes);
      } else {
        const cutoff = now - days * 86400_000;
        const r = this.db.prepare('DELETE FROM events WHERE category = ? AND ts < ?').run(cat, cutoff);
        deleted += Number(r.changes);
      }
    }
    return deleted;
  }

  // ---- settings (kv) ----
  loadSettings(): Settings {
    const row = this.db.prepare('SELECT v FROM kv WHERE k = ?').get('settings') as { v: string } | undefined;
    if (!row) return structuredClone(defaultSettings);
    try {
      return { ...defaultSettings, ...JSON.parse(row.v) };
    } catch {
      return structuredClone(defaultSettings);
    }
  }

  saveSettings(s: Settings) {
    this.db
      .prepare('INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')
      .run('settings', JSON.stringify(s));
  }

  // ---- audit (FR-32) ----
  audit(actor: string, action: string, detail?: unknown) {
    this.db
      .prepare('INSERT INTO audit (ts,actor,action,detail) VALUES (?,?,?,?)')
      .run(Date.now(), actor, action, detail !== undefined ? JSON.stringify(detail) : null);
  }
}

export const store = new Store();
