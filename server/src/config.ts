import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isPackaged } from './sea.ts';
import { metaDir as __dirname } from './meta.ts';
import type { LogLevel, Settings } from './types.ts';

// Packaged exe writes its database to a per-user dir; dev uses ./data.
const defaultDataDir = isPackaged
  ? path.join(os.homedir(), '.yetsignal')
  : path.resolve(__dirname, '../../data');

/**
 * Optional config file so the packaged exe can be reconfigured (e.g. real mode
 * with no simulator) without env vars. Searched next to the exe, in the cwd,
 * and in ~/.yetsignal. Precedence: env var > config file > built-in default.
 */
function loadFileConfig(): Record<string, unknown> {
  const candidates = [
    process.env.YS_CONFIG,
    isPackaged ? path.join(path.dirname(process.execPath), 'yetsignal.config.json') : null,
    path.join(process.cwd(), 'yetsignal.config.json'),
    path.join(os.homedir(), '.yetsignal', 'config.json'),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return { ...JSON.parse(fs.readFileSync(p, 'utf8')), __path: p };
    } catch {
      /* ignore malformed config */
    }
  }
  return {};
}

const fileCfg = loadFileConfig();
export const configFilePath = (fileCfg.__path as string) || null;

function numOf(envName: string, key: string, def: number): number {
  const raw = process.env[envName] ?? (fileCfg[key] as string | number | undefined);
  const n = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : def;
}
function strOf(envName: string, key: string, def: string | null): string | null {
  const raw = process.env[envName] ?? (fileCfg[key] as string | undefined);
  return raw === undefined || raw === null ? def : String(raw);
}

export const config = {
  version: '0.1.0',
  port: numOf('PORT', 'port', 8787),
  dataDir: process.env.DATA_DIR ?? (fileCfg.dataDir as string) ?? defaultDataDir,
  logLevel: (strOf('LOG_LEVEL', 'logLevel', 'info') as LogLevel),

  // Simulator (NFR-16). Set simNodes to 0 for real-hardware mode.
  simNodes: numOf('SIM_NODES', 'simNodes', 4),
  simPeople: numOf('SIM_PEOPLE', 'simPeople', 1),
  csiRateHz: numOf('CSI_RATE_HZ', 'csiRateHz', 25), // FR-01: ≥ 20–28 Hz
  subcarriers: 56, // FR-02: BW20

  // MQTT / Home Assistant (FR-24)
  mqttUrl: strOf('MQTT_URL', 'mqttUrl', null),
  mqttDiscoveryPrefix: strOf('MQTT_DISCOVERY_PREFIX', 'mqttDiscoveryPrefix', 'homeassistant')!,

  // Discovery (FR-15)
  discoveryUdpPort: numOf('DISCOVERY_UDP_PORT', 'discoveryUdpPort', 53217),
  mdnsServiceType: '_signalsense._tcp',

  // Inference timing
  inferenceHz: numOf('INFERENCE_HZ', 'inferenceHz', 10),
} as const;

/** Channels used for channel hopping (FR-03). */
export const HOP_CHANNELS = [1, 6, 11] as const;

export const defaultSettings: Settings = {
  modes: { presence: true, motion: true, breathing: true, heart: false, pose: false },
  privacyMode: false,
  sensitivity: 0.6,
  motionThreshold: 0.18,
  fallSensitivity: 0.6,
  retention: { raw_csi: 0, derived: 30, vital: 7 }, // NFR-21: raw CSI not stored by default
  locale: 'uk',
};
