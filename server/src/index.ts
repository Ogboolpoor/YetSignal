import http from 'node:http';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { hub } from './hub.ts';
import { store } from './db.ts';
import { createApp } from './api/rest.ts';
import { attachWs } from './api/ws.ts';
import { CsiSimulator } from './csi/simulator.ts';
import { MqttIntegration } from './integrations/mqtt.ts';
import { Discovery } from './discovery/mdns.ts';
import { isPackaged, openBrowser } from './sea.ts';
import type { NodeInfo } from './types.ts';

const log = logger('main');

function restoreRegistry() {
  // Bring previously-known nodes back as offline until they reconnect (FR-18).
  for (const n of store.listNodes()) {
    if (n.simulated) continue; // simulated nodes are recreated by the simulator
    const info: NodeInfo = {
      ...n,
      online: false,
      rssi: -90,
      signalQuality: 0,
      temperatureC: null,
    };
    hub.nodes.set(info.id, info);
  }
}

async function main() {
  log.info(`YetSignal server v${config.version} starting`);
  restoreRegistry();

  // integrations
  const mqtt = new MqttIntegration();
  hub.mqtt = mqtt;
  mqtt.start();

  // HTTP + WebSocket
  const app = createApp();
  const server = http.createServer(app);
  attachWs(server);

  // node discovery for real hardware (FR-15)
  const discovery = new Discovery((n) => hub.registerNode(n));
  discovery.start();

  // simulated CSI source (NFR-16)
  if (config.simNodes > 0) {
    const sim = new CsiSimulator({
      onFrame: (f) => hub.ingestFrame(f),
      onNode: (n) => hub.registerNode(n),
    });
    hub.simulator = sim;
    sim.start();
  } else {
    log.info('simulator disabled (SIM_NODES=0) — awaiting real nodes');
  }

  hub.start();

  server.listen(config.port, () => {
    const url = `http://localhost:${config.port}`;
    log.info(`HTTP/WS listening on ${url}`);
    log.info(`  REST:      ${url}/api/health`);
    log.info(`  WebSocket: ws://localhost:${config.port}/ws`);
    if (isPackaged) {
      log.info('opening YetSignal in your browser…');
      openBrowser(url);
    }
  });

  const shutdown = () => {
    log.info('shutting down');
    discovery.stop();
    mqtt.stop();
    hub.simulator?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  log.error(`fatal: ${e?.stack ?? e}`);
  process.exit(1);
});
