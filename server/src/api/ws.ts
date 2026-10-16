import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { hub } from '../hub.ts';
import { onLog } from '../logger.ts';
import { createNodeWss } from './node-ingest.ts';
import type { ClientMessage, ServerMessage } from '../types.ts';

/**
 * WebSocket API. Two paths share the HTTP server:
 *   /ws       — UI clients (live state/node/metrics/log push + commands; FR-20)
 *   /ws/node  — ESP32-S3 nodes streaming binary CSI frames (FR-04)
 */
export function attachWs(server: Server) {
  const clientWss = new WebSocketServer({ noServer: true });
  const nodeWss = createNodeWss();

  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      /* ignore */
    }
    if (pathname === '/ws') clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req));
    else if (pathname === '/ws/node') nodeWss.handleUpgrade(req, socket, head, (ws) => nodeWss.emit('connection', ws, req));
    else socket.destroy();
  });

  const send = (ws: WebSocket, m: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  // hub → all clients
  hub.setBroadcast((m: ServerMessage) => {
    const data = JSON.stringify(m);
    for (const client of clientWss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  });

  // forward server logs to clients (NFR-17 observability in the UI)
  onLog((e) => {
    const data = JSON.stringify({ type: 'log', ...e } satisfies ServerMessage);
    for (const client of clientWss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  });

  clientWss.on('connection', (ws) => {
    send(ws, {
      type: 'hello',
      server: hub.serverInfo(),
      settings: hub.settings,
      nodes: [...hub.nodes.values()],
      state: hub.state,
    });

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case 'set_settings':
          hub.setSettings(msg.patch);
          break;
        case 'set_mode':
          hub.setMode(msg.mode, msg.on);
          break;
        case 'set_privacy':
          hub.setPrivacy(msg.on);
          break;
        case 'calibrate':
          hub.calibrate();
          break;
        case 'sim': {
          const sim = hub.simulator;
          if (!sim) break;
          const a = msg.action;
          if (a.kind === 'set_people') sim.setPeople(a.count);
          else if (a.kind === 'trigger_fall') sim.triggerFall();
          else if (a.kind === 'add_node') sim.addNode();
          else if (a.kind === 'remove_node') hub.removeNode(a.id);
          break;
        }
      }
    });
  });

  return clientWss;
}
