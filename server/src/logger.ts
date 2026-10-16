import { config } from './config.ts';
import type { LogLevel } from './types.ts';

/** Structured, level-based logging (NFR-17). Emits to console and to subscribers. */
const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

type Listener = (e: { ts: number; level: LogLevel; msg: string }) => void;
const listeners = new Set<Listener>();

export function onLog(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(level: LogLevel, scope: string, msg: string, extra?: unknown) {
  if (ORDER[level] < ORDER[config.logLevel]) return;
  const ts = Date.now();
  const line = `[${new Date(ts).toISOString()}] ${level.toUpperCase().padEnd(5)} ${scope} ${msg}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (extra !== undefined) fn(line, extra);
  else fn(line);
  for (const l of listeners) {
    try {
      l({ ts, level, msg: `${scope} ${msg}` });
    } catch {
      /* ignore listener errors */
    }
  }
}

export function logger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => emit('debug', scope, msg, extra),
    info: (msg: string, extra?: unknown) => emit('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => emit('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => emit('error', scope, msg, extra),
  };
}
