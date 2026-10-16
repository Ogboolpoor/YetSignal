# YetSignal Node Firmware (ESP32-S3)

CSI-capturing sensor node firmware (NFR-06, NFR-12 — **ESP32-S3 only**, not C3 / original ESP32).

## What it does

| Requirement | Implementation |
|---|---|
| FR-01 | CSI capture via `esp_wifi_set_csi_rx_cb` (≥ 20–28 Hz) |
| FR-02 | BW20, 56 complex subcarriers, packed as interleaved int8 I/Q |
| FR-03 | Channel hopping across 1 / 6 / 11 (`hop_task`) |
| FR-04 | Streams frames to the server over WebSocket (`esp_websocket_client`) |
| FR-05 | FreeRTOS ring buffer holds frames while the server link is down |
| FR-15 | Discovery via mDNS `_signalsense._tcp` + a UDP broadcast beacon |

> OTA update + firmware rollback (FR-17, SR-08) integrate with `esp_https_ota` and the dual-OTA partition scheme; wire the server's `/api/firmware/ota` endpoint to it in the hardware phase.

## Prerequisites

- **ESP-IDF v5.x** ([install guide](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/get-started/))
- An ESP32-S3 dev board (USB)

The C/C++ host toolchain for ESP-IDF is the **Xtensa cross-compiler** that ESP-IDF installs itself (`install.bat`/`install.sh`) — it is *not* the MSVC toolchain used by the Rust/desktop layer.

## Build & flash

```bash
# one-time, in the ESP-IDF environment
idf.py set-target esp32s3
idf.py menuconfig          # set Wi-Fi SSID/pass and the server URI under "YetSignal Node Configuration"

idf.py build
idf.py -p <PORT> flash monitor
```

The desktop app's USB flasher (FR-16) wraps `espflash` to do this without a manual ESP-IDF setup.

## Getting a good CSI rate (important for a real test)

CSI is only produced when the node **receives** Wi-Fi frames, so the frame rate
depends on how much traffic the node hears. For a clean ≥20 Hz stream during a
test, generate steady traffic between the node and the router, e.g.:

- continuously `ping -t <node-ip>` from the server PC, or
- keep the node on the same AP as a device doing constant traffic.

If the dashboard shows a low `fps` on the Nodes/Diagnostics view, that's the
cause — add traffic. (A future firmware revision can self-generate traffic.)

## Note on dependencies

`main/idf_component.yml` declares `espressif/esp_websocket_client` and
`espressif/mdns`; `idf.py build` fetches them automatically on first build.

## Wire format

Each frame is the packed `ys_frame_t`:

```c
struct {
  int64_t ts_us;                 // node-local timestamp (µs)
  int8_t  rssi;                  // dBm
  uint8_t channel;               // 1 | 6 | 11
  int8_t  iq[56 * 2];            // interleaved Re/Im, BW20
} __attribute__((packed));
```

The server's node WebSocket endpoint (hardware phase) decodes this into the same
`CsiFrame` the simulator produces, so the entire processing/inference path is
identical for real and simulated nodes.
