/**
 * Resolves the current module URL/dir in a way that works both under ESM
 * (tsx dev / `npm start`) and inside the esbuild CommonJS bundle used for the
 * single-file exe (where `import.meta` is unavailable and `__filename` is set).
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

declare const __filename: string;

function resolveMetaUrl(): string {
  // ESM: import.meta.url is a string. CJS bundle: import.meta is {} → undefined.
  const u = (import.meta as { url?: string }).url;
  if (typeof u === 'string' && u.length) return u;
  // typeof on an undeclared identifier is safe (returns 'undefined') in ESM.
  return pathToFileURL(typeof __filename !== 'undefined' ? __filename : process.execPath).href;
}

export const metaUrl: string = resolveMetaUrl();
export const metaDir: string = path.dirname(fileURLToPath(metaUrl));
