# YetSignal — setup and technical details

**Wi-Fi CSI sensing system** — turns existing Wi-Fi infrastructure into a privacy-preserving source of structured spatial data: who is present, where they are, how they move, and basic vital signs. No camera, no microphone — only radio.

This repository implements the software layers of the system specified in the technical requirements (ТЗ). The runnable application ships with a **simulated-CSI demo mode** (NFR-16) so the full UI and processing pipeline can be explored without ESP32-S3 hardware.

## Architecture (4 levels)

| Level | What | This repo |
|---|---|---|
| 1. Hardware | ESP32-S3 sensor nodes capturing CSI | `firmware/` (ESP-IDF C skeleton, FR-01…FR-05) |
| 2. Signal processing & inference | Hampel filter, SpotFi phase correction, Fresnel zones, ML inference | `server/src/pipeline`, `server/src/inference` (reference) · `edge/` (Rust, production) |
| 3. Server | Local sensing server — aggregates nodes, holds state, exposes API | `server/` (REST + WebSocket + SQLite + MQTT) |
| 4. Applications | Control + visualization UI, integrations | `web/` (React + Three.js dashboards) |

> The reference stack in the ТЗ is Tauri v2 (Rust) + React. To make the system **runnable today on the installed toolchain** and to satisfy NFR-16 directly, the app layer here is a Vite + React web app served by a Node sensing server. It is structured (single web build + thin server) so a Tauri/Rust shell can wrap it for the desktop deliverable, and `firmware/` carries the ESP-IDF node code for the hardware phase.

## Requirements

- **Node.js ≥ 22** (uses the built-in `node:sqlite`, so no native build / MSVC needed)
- A modern browser (Chromium, Firefox, Safari)
- (Optional) An MQTT broker for Home Assistant integration

## Quick start

```bash
# from the repo root
npm run install:all      # installs root + server + web deps
npm run dev              # starts the sensing server (with simulated nodes) + the web UI
```

Then open the URL Vite prints (default http://localhost:5173). The server runs on http://localhost:8787.

To run only the server (e.g. headless / for the web build):

```bash
npm run build            # build the web UI into web/dist
npm start                # server serves the built UI + API on http://localhost:8787
```

## Native edge pipeline (Rust, NFR-07)

The performance-critical CSI processing is also implemented in Rust under `edge/`
(Hampel, SpotFi phase, Fresnel, variance presence, FFT vitals). It builds with
either the msvc or gnu toolchain and needs no external crates:

```bash
cd edge
cargo test --release            # 8 unit tests
cargo run --release --bin bench # KPI-04 timing + empty/occupied separation
```

Measured during development: **~11.7 µs/frame** (KPI-04 ✓), ~85k frames/s per
core, and a **~233×** empty-vs-occupied variance separation that underpins the
presence detector. Building it natively requires Rust plus the Visual Studio C++
Build Tools on Windows.

## Configuration

The server reads environment variables (see `server/src/config.ts`):

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | HTTP/WebSocket port |
| `SIM_NODES` | `4` | Number of simulated CSI nodes (set `0` to disable the simulator) |
| `SIM_PEOPLE` | `1` | Initial simulated occupancy |
| `CSI_RATE_HZ` | `25` | Simulated CSI capture rate (FR-01: ≥ 20–28 Hz) |
| `MQTT_URL` | _(unset)_ | e.g. `mqtt://localhost:1883` to enable MQTT / HA auto-discovery (FR-24) |
| `MQTT_DISCOVERY_PREFIX` | `homeassistant` | HA discovery topic prefix |
| `DATA_DIR` | `./data` | SQLite + retention storage |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` (NFR-17) |

## Privacy (Section 5 of the ТЗ)

- **SR-01 Physical privacy**: only radio signals are captured — never image or audio.
- **SR-02 Local processing**: the full pipeline runs locally; raw data does not leave the premises without explicit opt-in.
- **SR-03 / NFR-21**: raw CSI is not persisted long-term by default; only derived events are stored.
- **FR-23**: a Privacy Mode toggle suspends sensing with a clear indicator.

See [`docs/REQUIREMENTS-TRACE.md`](REQUIREMENTS-TRACE.md) for the full FR/NFR → implementation map.

## Documentation

- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — system design, data flow, message contracts
- [`docs/REQUIREMENTS-TRACE.md`](REQUIREMENTS-TRACE.md) — requirement traceability matrix
- [`firmware/README.md`](../firmware/README.md) — ESP32-S3 node firmware (hardware phase)
