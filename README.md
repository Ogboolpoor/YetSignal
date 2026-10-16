# YetSignal

A system that senses people in a room using Wi-Fi signals instead of cameras or microphones. ESP32 sensor nodes capture Wi-Fi Channel State Information (CSI), and a local server turns it into presence, people count, movement, fall alerts and breathing rate, shown on a live web dashboard.

## Features

- **Live Dashboard:** Presence, people count, activity, breathing and heart rate, an activity heatmap, a live CSI chart and an event log.
- **3D Mesh:** The sensor nodes shown in a 3D room that you can rotate and zoom.
- **Fall Detection:** Raises an alert when a sudden movement is followed by stillness.
- **History:** Charts of presence, people count, motion and breathing for the last 1, 6 or 24 hours.
- **Privacy Mode:** One switch pauses all sensing. Everything is processed locally and raw signal data is not stored.
- **Simulator:** Virtual sensor nodes and people, so the whole system can run without any hardware.
- **Home Assistant:** Sends presence and alerts over MQTT.
- **Two Languages:** English and Ukrainian.

Built with TypeScript and Node.js (server), React and Three.js (dashboard), Rust (fast signal processing) and C with ESP-IDF (sensor firmware).

---

## Screens

### Dashboard
![Dashboard](screenshots/01-dashboard.png)

### 3D Mesh
![3D Mesh](screenshots/02-3d-mesh.png)

### Nodes
![Nodes](screenshots/03-nodes.png)

### History
![History](screenshots/04-history.png)

### Settings
![Settings](screenshots/05-settings.png)

### Privacy Mode
![Privacy Mode](screenshots/06-privacy-mode.png)

### Simulator: Empty Room
![Empty Room](screenshots/07-sim-empty-room.png)

### Simulator: Person Resting (breathing and heart rate)
![Person Resting](screenshots/08-sim-resting-vitals.png)

### Simulator: Fall Detected
![Fall Detected](screenshots/09-sim-fall-detected.png)

### Simulator: Three People
![Three People](screenshots/10-sim-three-people.png)
<br>
![Three People 3D](screenshots/11-sim-3d-three-people.png)

### Simulator: New Sensor Node
![New Node](screenshots/12-sim-node-added.png)
<br>
![Five Nodes 3D](screenshots/13-sim-3d-five-nodes.png)

All screenshots were taken with the built-in simulator.

## Run it

**Windows app:** Download the `dist` folder from Releases and double-click `YetSignal.exe`, then open http://localhost:8787. To try it without sensors, set `"simNodes": 4` in `yetsignal.config.json`.

**From source** (Node.js 22 or newer):

```bash
npm run install:all
npm run dev
```

Setup details, configuration and the sensor firmware are in [docs/SETUP.md](docs/SETUP.md) and [firmware/README.md](firmware/README.md).
