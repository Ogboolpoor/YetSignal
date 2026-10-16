import { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import { hub } from '../hub.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { ROOM } from '../inference/index.ts';
import type { CsiFrame, Vec3 } from '../types.ts';

const log = logger('node');

/**
 * Real-hardware CSI ingestion (FR-04). ESP32-S3 nodes connect to /ws/node and
 * stream packed binary frames; this decodes them into CsiFrame and feeds the
 * same pipeline the simulator uses, so real and simulated paths are identical.
 *
 * Wire format (matches firmware ys_frame_t, little-endian, packed):
 *   int64 ts_us | int8 rssi | uint8 channel | int8 iq[subcarriers*2]  (Re,Im…)
 */
const HEADER = 10; // 8 (ts) + 1 (rssi) + 1 (channel)

export function decodeNodeFrame(nodeId: string, buf: Buffer): CsiFrame | null {
  const n = config.subcarriers;
  if (buf.length < HEADER + n * 2) return null;
  const rssi = buf.readInt8(8);
  const channel = buf.readUInt8(9);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let o = HEADER;
  for (let k = 0; k < n; k++) {
    re[k] = buf.readInt8(o++);
    im[k] = buf.readInt8(o++);
  }
  // Use the server clock for a consistent timeline across nodes (FR-33).
  return { nodeId, ts: Date.now(), channel, rssi, re, im };
}

const PERIMETER: Vec3[] = [
  { x: 0.2, y: 0.2, z: 2.4 },
  { x: ROOM.w - 0.2, y: 0.2, z: 2.4 },
  { x: ROOM.w - 0.2, y: ROOM.h - 0.2, z: 2.4 },
  { x: 0.2, y: ROOM.h - 0.2, z: 2.4 },
  { x: ROOM.w / 2, y: 0.2, z: 2.6 },
  { x: ROOM.w / 2, y: ROOM.h - 0.2, z: 2.6 },
];

interface NodeMeta {
  name?: string;
  channel: number;
  fw: string;
  ip: string | null;
}

function registerRealNode(id: string, meta: NodeMeta) {
  const existing = hub.nodes.get(id);
  hub.registerNode({
    id,
    name: meta.name ?? existing?.name ?? `node-${id.slice(-5)}`,
    ip: meta.ip ?? existing?.ip ?? null,
    room: existing?.room ?? 'default',
    firmware: meta.fw,
    channel: meta.channel || existing?.channel || 1,
    online: true,
    simulated: false,
    lastSeen: Date.now(),
    rssi: existing?.rssi ?? -60,
    signalQuality: existing?.signalQuality ?? 0.5,
    temperatureC: existing?.temperatureC ?? null,
    position: existing?.position ?? PERIMETER[hub.nodes.size % PERIMETER.length],
  });
}

/** A noServer WebSocketServer for the /ws/node ingestion path. */
export function createNodeWss(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const q = url.searchParams;
    const ip = (req.socket.remoteAddress ?? '').replace('::ffff:', '') || null;
    const meta: NodeMeta = {
      name: q.get('name') ?? undefined,
      channel: Number(q.get('ch') ?? q.get('channel') ?? 1),
      fw: q.get('fw') ?? q.get('firmware') ?? 'unknown',
      ip,
    };
    let id = (q.get('id') ?? '').toUpperCase();
    if (id) registerRealNode(id, meta);
    log.info(`link from ${ip ?? '?'} ${id || '(awaiting hello)'}`);

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        // optional JSON hello: { id, fw, channel, name }
        try {
          const h = JSON.parse(data.toString());
          if (h.id) {
            id = String(h.id).toUpperCase();
            if (h.fw) meta.fw = String(h.fw);
            if (h.channel) meta.channel = Number(h.channel);
            if (h.name) meta.name = String(h.name);
            registerRealNode(id, meta);
          }
        } catch {
          /* not a hello */
        }
        return;
      }
      if (!id) return; // ignore frames until the node identifies itself
      const frame = decodeNodeFrame(id, data as Buffer);
      if (frame) hub.ingestFrame(frame);
    });

    ws.on('close', () => log.info(`link closed ${id || ip}`));
    ws.on('error', () => {});
  });
  return wss;
}
