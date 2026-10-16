import dgram from 'node:dgram';
import makeMdns from 'multicast-dns';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import type { NodeInfo } from '../types.ts';

const log = logger('discovery');

/**
 * FR-15 — node discovery. Two complementary mechanisms, both best-effort
 * (multicast can be blocked by the host/sandbox, so failures only warn):
 *
 *  1. UDP broadcast beacon: nodes periodically broadcast a small JSON descriptor
 *     on DISCOVERY_UDP_PORT; the server also broadcasts a query on start.
 *  2. mDNS service browse for `_signalsense._tcp`.
 *
 * Either path yields a NodeInfo that is handed to the registrar (dedup by MAC
 * happens in the hub).
 */
export class Discovery {
  private udp: dgram.Socket | null = null;
  private mdns: ReturnType<typeof makeMdns> | null = null;

  constructor(private readonly register: (n: NodeInfo) => void) {}

  start() {
    this.startUdp();
    this.startMdns();
  }

  private toNode(d: any, ip: string | null): NodeInfo | null {
    if (!d || typeof d.id !== 'string') return null;
    return {
      id: String(d.id).toUpperCase(),
      name: d.name ?? `node-${d.id}`,
      ip: d.ip ?? ip,
      room: d.room ?? 'default',
      firmware: d.firmware ?? d.fw ?? 'unknown',
      channel: Number(d.channel ?? d.ch ?? 1),
      online: true,
      simulated: false,
      lastSeen: Date.now(),
      rssi: Number(d.rssi ?? -60),
      signalQuality: 0.5,
      temperatureC: d.temp != null ? Number(d.temp) : null,
      position: { x: 0, y: 0, z: 2.4 },
    };
  }

  private startUdp() {
    try {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', (e) => log.warn(`udp error: ${e.message}`));
      sock.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString());
          if (data.query === 'yetsignal-discover') return; // ignore our own queries
          const node = this.toNode(data, rinfo.address);
          if (node) this.register(node);
        } catch {
          /* not a beacon */
        }
      });
      sock.bind(config.discoveryUdpPort, () => {
        try {
          sock.setBroadcast(true);
        } catch {
          /* ignore */
        }
        // ask any listening nodes to announce themselves
        const q = Buffer.from(JSON.stringify({ query: 'yetsignal-discover' }));
        sock.send(q, config.discoveryUdpPort, '255.255.255.255', () => {});
        log.info(`UDP discovery listening on :${config.discoveryUdpPort}`);
      });
      this.udp = sock;
    } catch (e) {
      log.warn(`UDP discovery unavailable: ${(e as Error).message}`);
    }
  }

  private startMdns() {
    try {
      const m = makeMdns();
      m.on('warning', () => {});
      m.on('error', (e: Error) => log.warn(`mDNS error: ${e.message}`));
      m.on('response', (res: any) => {
        const txt = res.answers.find((a: any) => a.type === 'TXT' && String(a.name).includes(config.mdnsServiceType));
        const a = res.answers.find((x: any) => x.type === 'A');
        if (!txt) return;
        const fields: Record<string, string> = {};
        for (const buf of [].concat(txt.data)) {
          const [k, v] = String(buf).split('=');
          if (k) fields[k] = v;
        }
        const node = this.toNode(fields, a?.data ?? null);
        if (node) this.register(node);
      });
      m.query({ questions: [{ name: config.mdnsServiceType, type: 'PTR' }] });
      this.mdns = m;
      log.info(`mDNS browsing ${config.mdnsServiceType}`);
    } catch (e) {
      log.warn(`mDNS unavailable: ${(e as Error).message}`);
    }
  }

  stop() {
    try {
      this.udp?.close();
    } catch {
      /* ignore */
    }
    try {
      this.mdns?.destroy();
    } catch {
      /* ignore */
    }
  }
}
