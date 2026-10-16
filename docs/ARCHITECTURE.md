# YetSignal — Architecture

```
                         ┌──────────────────────────────────────────────┐
   Level 4: Apps         │  web/  React + Three.js UI (dashboards, 3D,    │
                         │        history, settings, privacy, uk/en)     │
                         └───────────────▲───────────────┬──────────────┘
                                  WS /ws │ REST /api      │ (Tauri shell — future)
                         ┌───────────────┴───────────────▼──────────────┐
   Level 3: Server       │  server/  Hub: state, node registry (SQLite), │
                         │           REST+WS API, retention, MQTT/HA,    │
                         │           mDNS+UDP discovery                  │
                         └───────────────▲───────────────┬──────────────┘
                                ProcessedFrame            │ SensingState
                         ┌───────────────┴───────────────▼──────────────┐
   Level 2: Pipeline &   │  Hampel (FR-06) → SpotFi phase (FR-07) →       │
            Inference    │  Fresnel (FR-08) → variance/motion → presence,│
                         │  occupancy, activity/fall, vitals (FFT)       │
                         │  Reference impl: server/src/{pipeline,inference}
                         │  Production edge impl: edge/ (Rust, NFR-07)    │
                         └───────────────▲───────────────────────────────┘
                                  CsiFrame│ (real or simulated)
                         ┌───────────────┴───────────────────────────────┐
   Level 1: Hardware     │  firmware/  ESP32-S3 node — CSI capture,       │
                         │             channel hop, WS uplink, discovery  │
                         │  Demo: server/src/csi/simulator.ts (NFR-16)    │
                         └────────────────────────────────────────────────┘
```

## Data flow

1. A **node** (real ESP32-S3 or the **simulator**) produces `CsiFrame`s (56 BW20
   subcarriers, ~25 Hz) and delivers them to the hub.
2. The **pipeline** turns each frame into a `ProcessedFrame`: Hampel-filtered
   amplitude, SpotFi-sanitised phase, the Fresnel slow-modulation scalar, a
   short-term motion-energy value and a per-subcarrier variance-energy value.
3. The **inference engine** buffers processed frames per node and, ~10×/s,
   derives a `SensingState`: presence (variance), occupancy (coarse), activity &
   fall (motion), and breathing/heart (FFT on the Fresnel signal).
4. The **hub** broadcasts `SensingState` over WebSocket, persists derived/vital
   events to SQLite under retention policy, and publishes to MQTT/Home Assistant.
5. The **web UI** renders dashboards, the 3D mesh, history and settings from the
   live WS feed and the REST API.

## Why presence uses variance

An empty room carries only receiver noise on every subcarrier; a person — even
breathing while still — perturbs many subcarriers. The mean per-subcarrier
amplitude variance therefore separates empty from occupied by ~200× (measured in
the Rust bench: empty 0.0008 vs occupied 0.184), which is far more robust than a
single-subcarrier tone or raw motion energy. Motion energy then distinguishes
still / moving / walking, and an FFT of the Fresnel signal recovers the
respiration rate when the subject is still.

## Two pipeline implementations, one behaviour

- `server/src/pipeline` + `server/src/inference` — the **reference TypeScript**
  implementation that runs live in the demo server.
- `edge/` — the **performance-critical Rust** implementation (NFR-07), benchmarked
  at ~12 µs/frame (KPI-04). It mirrors the TS algorithms stage-for-stage and is
  the path intended to run on the edge server / be cross-compiled for the node.

## Message contracts

See `server/src/types.ts` (authoritative) and `web/src/types.ts` (client mirror):
`ServerMessage` (hello / state / node / settings / csi / metrics / log) and
`ClientMessage` (set_settings / set_mode / set_privacy / calibrate / sim).

## Storage

SQLite (`node:sqlite`, no native build) holds the node registry, derived/vital
events (with per-category retention), settings and an access audit log. Raw CSI
is never persisted by default (NFR-21).
