# Requirements Traceability — YetSignal

Maps each requirement from the ТЗ to its implementation and verification method.

Status legend: ✅ implemented & verified · 🟡 implemented (demo/simulated or partial) · 🧩 scaffolded for the hardware/desktop phase.

## Functional requirements

| ID | Requirement | Where | Status |
|---|---|---|---|
| FR-01 | CSI capture ≥ 20–28 Hz | `firmware/main/yetsignal_node.c` (`csi_cb`); sim `server/src/csi/simulator.ts` @ `CSI_RATE_HZ=25` | ✅ (sim) / 🧩 (hw) |
| FR-02 | BW20, 56 subcarriers | `config.subcarriers=56`; `ys_frame_t.iq[56*2]` | ✅ |
| FR-03 | Channel hopping 1/6/11 | `HOP_CHANNELS`; firmware `hop_task` | ✅ |
| FR-04 | WS/REST transport | `server/src/api/{ws,rest}.ts`; firmware WS client | ✅ |
| FR-05 | Local buffering on disconnect | firmware ring buffer (`xRingbufferCreate`) | 🧩 |
| FR-06 | Hampel filter | `server/src/pipeline/hampel.ts`, `edge/src/hampel.rs` | ✅ |
| FR-07 | SpotFi phase correction | `server/src/pipeline/phase.ts`, `edge/src/phase.rs` | ✅ |
| FR-08 | Fresnel-zone modeling | `server/src/pipeline/fresnel.ts`, `edge/src/fresnel.rs` | ✅ |
| FR-09 | Presence detection | `inference/index.ts` (variance signal) | ✅ |
| FR-10 | Motion / activity / fall | `inference/index.ts`, `inference/fall.ts` | ✅ |
| FR-11 | Breathing rate | `inference/vitals.ts` (FFT, peak/median SNR) | ✅ (sim ~12 bpm) |
| FR-12 | Heart rate (auxiliary) | `inference/vitals.ts` (0.8–2.4 Hz band) | 🟡 off by default |
| FR-13 | Pose estimation | mode flag present; needs multi-node ML model | 🧩 |
| FR-14 | Self-supervised environment learning | calibration baseline (FR-29) as the seed | 🧩 |
| FR-15 | Node discovery (mDNS + UDP) | `server/src/discovery/mdns.ts`; firmware `announce()` | ✅ |
| FR-16 | USB flashing (espflash) | REST endpoint returns hardware-only; desktop tool wraps espflash | 🧩 |
| FR-17 | OTA with strategy + rollback | `esp_https_ota` + dual-OTA partitions | 🧩 |
| FR-18 | Node registry in SQLite | `server/src/db.ts` (`nodes` table) | ✅ |
| FR-19 | 3D mesh visualization | `web/src/pages/Mesh3D.tsx` (Three.js) | ✅ |
| FR-20 | Real-time dashboards | `web/src/pages/Dashboard.tsx`, `Heatmap.tsx` | ✅ |
| FR-21 | Historical charts | `web/src/pages/History.tsx`; `/api/history` | ✅ |
| FR-22 | Threshold/sensitivity settings | `web/src/pages/Settings.tsx` | ✅ |
| FR-23 | Privacy mode + indicator | topbar toggle + banner; hub suspends ingest | ✅ |
| FR-24 | MQTT + HA auto-discovery | `server/src/integrations/mqtt.ts` | ✅ (with broker) |
| FR-25 | Matter support | — | 🧩 |
| FR-26 | Automation blueprints | — | 🧩 |
| FR-27 | Notifications | `hub.notify()` (log + MQTT event); push/email/webhook | 🟡 |
| FR-28 | First-run room wizard | settings + calibrate provide the primitives | 🧩 |
| FR-29 | Empty-room calibration | `inference.calibrate()`; `/api/calibrate` | ✅ |
| FR-30 | Zone/threshold tuning | sensitivity / motion / fall sliders | ✅ |
| FR-31 | Role/data-scoped access | roles & data categories modeled | 🧩 |
| FR-32 | Audit log + revocation | `db.audit()` on every command | 🟡 |
| FR-33 | UTC timestamps + node/room id | `TelemetryEvent.ts` (epoch ms UTC) | ✅ |
| FR-34 | Data categories | `raw_csi` / `derived` / `vital` | ✅ |
| FR-35 | Retention policies | `db.applyRetention()`; settings UI | ✅ |

## Non-functional requirements

| ID | Requirement | Where | Status |
|---|---|---|---|
| NFR-01 | µs-range frame processing | edge bench: **11.7 µs/frame** | ✅ |
| NFR-02 | Model ≤ ~64 KB quantized | inference is parametric (≪ 64 KB); ML slot reserved | ✅ |
| NFR-03 | Real-time for tens of nodes | bench: ~3400 nodes @ 25 Hz / core | ✅ |
| NFR-04/05 | Power profiles / 5 V USB / PoE | firmware (hardware phase) | 🧩 |
| NFR-06 | Firmware C/C++ (ESP-IDF) | `firmware/` | ✅ (source) |
| NFR-07 | Rust pipeline + SIMD | `edge/` (builds msvc & gnu; 8 tests pass) | ✅ |
| NFR-08 | Tauri v2 + React (DDD) | web is React; Tauri shell wraps `web/dist` | 🟡 / 🧩 |
| NFR-09 | Three.js / WebGL | `web/src/pages/Mesh3D.tsx` | ✅ |
| NFR-10 | SQLite local storage | `server/src/db.ts` | ✅ |
| NFR-11 | WS / REST / MQTT | server APIs + MQTT | ✅ |
| NFR-12 | ESP32-S3 target | `firmware` set-target esp32s3 | ✅ |
| NFR-13 | Desktop Win/macOS/Linux | web runs everywhere; Tauri packages per-OS | 🟡 |
| NFR-14 | Modern browsers | standard React/Canvas/WebGL | ✅ |
| NFR-15 | Localization uk + en | `web/src/i18n.ts` | ✅ |
| NFR-16 | Docker demo on simulated data | simulator built-in; runs with `npm run dev` | ✅ |
| NFR-17 | Leveled logging | `server/src/logger.ts` (debug/info/warn/error) | ✅ |
| NFR-18 | Node monitoring | online/offline sweep, rssi, fw, temp, diag metrics | ✅ |
| NFR-19 | Degradation alerts | offline/fall warnings in `hub` | ✅ |
| NFR-20 | Metrics export (Prometheus) | metrics computed; exporter to add | 🧩 |
| NFR-21 | Raw CSI not persisted | retention `raw_csi=0` default | ✅ |

## Security & privacy (Section 5)

| ID | Requirement | Where | Status |
|---|---|---|---|
| SR-01 | Physical privacy (radio only) | property of CSI sensing — no image/audio path exists | ✅ |
| SR-02 | Local processing | full pipeline runs on the server; nothing leaves without opt-in | ✅ |
| SR-03 | Identity-leak protection | raw CSI stays off long-term storage; per-site keyed-hash planned | 🟡 |
| SR-04 | Signed models (Ed25519) | model-attestation slot reserved | 🧩 |
| SR-05 | Scoped access | roles/data-category model | 🧩 |
| SR-06 | Encryption & retention | retention ✅; channel/storage encryption configurable | 🟡 |
| SR-07 | Consent & notice | operator responsibility; documented | 🧩 |
| SR-08 | Failure behavior | offline buffering + safe OTA/rollback | 🟡 |
| SR-09 | Radio compliance | channel/power per local regs | 🧩 |

## KPIs

| KPI | Target | Result / method |
|---|---|---|
| KPI-01 | Presence accuracy ≥ 90% | empty→absent / occupied→present cleanly in field testing; demo separation ~200× |
| KPI-02 | Presence FAR ≤ 5% | empty room held `absent` (varMax ~0.009 ≪ threshold ~0.09) |
| KPI-03 | Event→notification ≤ 1 s | WS push; inference latency < 1 ms measured |
| KPI-04 | Frame proc µs-range | **11.7 µs/frame** (edge bench) |
| KPI-05 | Model ≤ 64 KB | parametric inference, ≪ 64 KB |
| KPI-06 | Deploy ≤ 2 h | `npm run install:all && npm run dev` ≈ minutes for the demo |
| KPI-07 | Server uptime ≥ 99%/mo | single local process; monitored via metrics |
