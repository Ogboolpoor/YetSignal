import { create } from 'zustand';
import type { LogEntry, Metrics, NodeInfo, SensingState, ServerInfo, ServerMessage, Settings } from './types';

interface State {
  connected: boolean;
  server: ServerInfo | null;
  settings: Settings | null;
  sensing: SensingState | null;
  nodes: Record<string, NodeInfo>;
  metrics: Metrics | null;
  logs: LogEntry[];
  csi: Record<string, number[]>;
  // actions
  apply: (m: ServerMessage) => void;
  setConnected: (v: boolean) => void;
}

const MAX_LOGS = 200;

export const useStore = create<State>((set) => ({
  connected: false,
  server: null,
  settings: null,
  sensing: null,
  nodes: {},
  metrics: null,
  logs: [],
  csi: {},
  setConnected: (v) => set({ connected: v }),
  apply: (m) =>
    set((s) => {
      switch (m.type) {
        case 'hello': {
          const nodes: Record<string, NodeInfo> = {};
          for (const n of m.nodes) nodes[n.id] = n;
          return { server: m.server, settings: m.settings, sensing: m.state, nodes };
        }
        case 'state':
          return { sensing: m.state };
        case 'settings':
          return { settings: m.settings };
        case 'node':
          return { nodes: { ...s.nodes, [m.node.id]: m.node } };
        case 'node_removed': {
          const nodes = { ...s.nodes };
          delete nodes[m.id];
          return { nodes };
        }
        case 'metrics':
          return { metrics: m.metrics };
        case 'csi':
          return { csi: { ...s.csi, [m.nodeId]: m.amplitude } };
        case 'log': {
          const logs = [...s.logs, { ts: m.ts, level: m.level, msg: m.msg }];
          if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
          return { logs };
        }
        default:
          return {};
      }
    }),
}));

/** Connect (and auto-reconnect) the live WebSocket feed. */
export function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws`;
  let ws: WebSocket;
  let retry: ReturnType<typeof setTimeout>;

  const open = () => {
    ws = new WebSocket(url);
    ws.onopen = () => useStore.getState().setConnected(true);
    ws.onmessage = (ev) => {
      try {
        useStore.getState().apply(JSON.parse(ev.data) as ServerMessage);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      useStore.getState().setConnected(false);
      retry = setTimeout(open, 1500);
    };
    ws.onerror = () => ws.close();
  };
  open();
  return () => {
    clearTimeout(retry);
    ws?.close();
  };
}

// ---- REST command helpers ----
async function req(path: string, method: string, body?: unknown) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 501) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json().catch(() => ({}));
}

export const api = {
  setSettings: (patch: Partial<Settings>) => req('/settings', 'PUT', patch),
  setPrivacy: (on: boolean) => req('/privacy', 'POST', { on }),
  calibrate: () => req('/calibrate', 'POST'),
  removeNode: (id: string) => req(`/nodes/${id}`, 'DELETE'),
  history: (kind: string, hours = 1) =>
    fetch(`/api/history?kind=${kind}&hours=${hours}`).then((r) => r.json()),
  sim: (action: Record<string, unknown>) => req('/sim', 'POST', action),
};
