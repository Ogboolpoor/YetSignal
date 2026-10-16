/**
 * Single-Executable-Application (SEA) helpers. When the server is bundled into
 * YetSignal.exe via Node's SEA, the web UI is embedded as assets and there is no
 * web/dist on disk; these helpers detect that mode, read embedded assets, and
 * open the default browser at launch.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { metaUrl } from './meta.ts';

const require = createRequire(metaUrl);

let _sea: { isSea(): boolean; getRawAsset(k: string): ArrayBuffer } | null = null;
try {
  const m = require('node:sea');
  if (m.isSea()) _sea = m;
} catch {
  /* not running as a SEA (dev / npm start) */
}

/** True when running inside the packaged YetSignal.exe. */
export const isPackaged = !!_sea;

/** Read an embedded web asset by relative key (e.g. "assets/index-abc.js"). */
export function getRawAsset(key: string): Buffer | null {
  if (!_sea) return null;
  try {
    return Buffer.from(_sea.getRawAsset(key));
  } catch {
    return null;
  }
}

/** Open the default browser at the given URL (packaged launch convenience). */
export function openBrowser(url: string) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* best effort */
  }
}
