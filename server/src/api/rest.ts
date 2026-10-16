import express, { type Express } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { metaDir as __dirname } from '../meta.ts';
import { hub } from '../hub.ts';
import { store } from '../db.ts';
import { logger } from '../logger.ts';
import { isPackaged, getRawAsset } from '../sea.ts';
import type { SimAction } from '../types.ts';

const log = logger('rest');
/**
 * Bucket a time series down to at most `max` points, keeping the peak value in
 * each bucket so transitions/spikes stay visible. Keeps the chart payload small
 * and the client render fast even for a 24h window.
 */
function downsample(rows: Array<{ ts: number; value: number }>, max: number) {
  if (rows.length <= max) return rows;
  const bucket = rows.length / max;
  const out: Array<{ ts: number; value: number }> = [];
  for (let i = 0; i < max; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.floor((i + 1) * bucket);
    let best = rows[start];
    for (let j = start + 1; j < end; j++) if (rows[j].value > best.value) best = rows[j];
    out.push(best);
  }
  return out;
}

/** REST API (FR-04, FR-21, FR-22) + static hosting of the built web UI. */
export function createApp(): Express {
  const app = express();
  app.use(express.json());

  // permissive CORS for the dev web server (Vite proxies anyway)
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });
  app.options('*', (_req, res) => res.sendStatus(204));

  app.get('/api/health', (_req, res) => res.json({ ok: true, ...hub.serverInfo() }));
  app.get('/api/state', (_req, res) => res.json(hub.state));
  app.get('/api/metrics', (_req, res) => res.json(hub.metrics()));
  app.get('/api/settings', (_req, res) => res.json(hub.settings));

  app.put('/api/settings', (req, res) => {
    hub.setSettings(req.body ?? {});
    res.json(hub.settings);
  });

  app.post('/api/privacy', (req, res) => {
    hub.setPrivacy(!!req.body?.on);
    res.json({ privacyMode: hub.settings.privacyMode });
  });

  app.post('/api/calibrate', (_req, res) => {
    const floor = hub.calibrate();
    res.json({ floor });
  });

  app.get('/api/nodes', (_req, res) => res.json([...hub.nodes.values()]));

  app.delete('/api/nodes/:id', (req, res) => {
    hub.removeNode(req.params.id.toUpperCase());
    res.json({ ok: true });
  });

  app.get('/api/history', (req, res) => {
    const kind = String(req.query.kind ?? 'presence');
    const hours = Math.min(720, Math.max(1, Number(req.query.hours ?? 24)));
    const maxPoints = Math.min(2000, Math.max(50, Number(req.query.points ?? 500)));
    const since = Date.now() - hours * 3600_000;
    res.json(downsample(store.history(kind, since), maxPoints));
  });

  // Firmware flashing over USB (FR-16) is a desktop/native capability (espflash).
  // The web/server build exposes the endpoint but reports it as hardware-only.
  app.post('/api/firmware/flash', (_req, res) => {
    res.status(501).json({ error: 'USB flashing requires the desktop app / espflash (hardware phase, FR-16)' });
  });

  app.post('/api/sim', (req, res) => {
    const action = req.body as SimAction;
    const sim = hub.simulator;
    if (!sim) return res.status(409).json({ error: 'simulator not running' });
    switch (action?.kind) {
      case 'set_people':
        sim.setPeople(action.count);
        break;
      case 'trigger_fall':
        sim.triggerFall();
        break;
      case 'add_node':
        sim.addNode();
        break;
      case 'remove_node':
        hub.removeNode(action.id);
        break;
      default:
        return res.status(400).json({ error: 'unknown sim action' });
    }
    res.json({ ok: true, people: sim.peopleCount });
  });

  // Serve the web UI: from embedded SEA assets when packaged, else from disk.
  if (isPackaged) {
    app.get('*', (req, res) => {
      const key = req.path.replace(/^\/+/, '') || 'index.html';
      let buf = getRawAsset(key);
      let ext = path.extname(key);
      if (!buf) {
        buf = getRawAsset('index.html'); // SPA fallback
        ext = '.html';
      }
      if (!buf) return res.sendStatus(404);
      res.type(ext || '.html').send(buf);
    });
    log.info('serving embedded web UI (packaged exe)');
  } else {
    // __dirname here is meta.ts's dir (server/src), so web/dist is two levels up.
    const webDist = path.resolve(__dirname, '../../web/dist');
    if (fs.existsSync(webDist)) {
      app.use(express.static(webDist));
      app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
      log.info(`serving web UI from ${webDist}`);
    }
  }

  return app;
}
