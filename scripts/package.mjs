/**
 * Builds a single-file Windows executable (dist/YetSignal.exe) using Node's
 * Single Executable Application (SEA) feature.
 *
 * Pipeline:
 *   1. build the web UI (web/dist)
 *   2. bundle the server to one CommonJS file (esbuild)
 *   3. generate a SEA config that embeds the server bundle + every web asset
 *   4. produce the SEA blob, copy node.exe, and inject the blob (postject)
 *
 * Result: a self-contained exe that serves the UI + API on localhost and opens
 * the browser. No Node install, no flags, no external files required.
 */
import esbuild from 'esbuild';
import { inject } from 'postject';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN_README = `YetSignal — how to run
========================================================================

WHAT'S IN THIS FOLDER
  YetSignal.exe          The whole app (server + web UI). No install needed.
  yetsignal.config.json  Settings. Pre-set to REAL mode (no simulator).
  firmware/              ESP32-S3 sensor-node source code (to flash the nodes).
  README-RUN.txt         This file.

------------------------------------------------------------------------
1) RUN THE APP (the PC that collects data)
------------------------------------------------------------------------
  • Double-click YetSignal.exe.
  • FIRST RUN — Windows SmartScreen may say "Windows protected your PC"
    (the exe is unsigned). Click "More info" -> "Run anyway".
  • FIRST RUN — if a Windows Firewall dialog appears, tick "Private networks"
    and click "Allow access" — REQUIRED so the ESP32 nodes can reach the
    server on port 8787 over your LAN. (If you missed it: Windows Security ->
    Firewall -> Allow an app -> add YetSignal.exe for Private networks.)
  • A console window opens and your browser opens to the dashboard
    (http://localhost:8787). Keep the console open; close it to stop.
  • In REAL mode it shows "Absent / 0 nodes" until sensor nodes connect —
    that's normal, not a bug.

  Want the no-hardware DEMO instead? Open yetsignal.config.json and set
  "simNodes": 4, then restart. (0 = real hardware, 4 = simulated nodes.)

------------------------------------------------------------------------
2) FIND THIS PC's LAN IP (you'll put it into the nodes)
------------------------------------------------------------------------
  • Open Command Prompt and run:  ipconfig
  • Use the "IPv4 Address" of your Wi-Fi/Ethernet, e.g. 192.168.1.50

------------------------------------------------------------------------
3) FLASH THE SENSOR NODES (ESP32-S3)
------------------------------------------------------------------------
  Requires Espressif's ESP-IDF v5.x (installs its own C compiler).
  See firmware/README.md for full steps. In short, inside ESP-IDF:

     idf.py set-target esp32s3
     idf.py menuconfig      # YetSignal Node Configuration:
                            #   Wi-Fi SSID / password (same network as this PC)
                            #   Server URI: ws://<THIS-PC-IP>:8787/ws/node
     idf.py build flash monitor

  The node joins your Wi-Fi, is auto-discovered, and appears on the
  "Nodes" page as a real (non-"sim") node. Frames start flowing.

------------------------------------------------------------------------
4) CALIBRATE (important for accuracy)
------------------------------------------------------------------------
  • With nodes online and the room EMPTY, go to Settings →
    "Calibrate empty room". This sets the baseline so presence is accurate.
  • Adjust Sensitivity / thresholds in Settings if needed.

========================================================================
УКРАЇНСЬКОЮ (коротко)
========================================================================
  1) Запустіть YetSignal.exe на ПК, який збирає дані. Відкриється браузер
     (http://localhost:8787). Дозвольте доступ до мережі (порт 8787).
     Реальний режим: показує "Відсутній / 0 вузлів", доки не під'єднаються
     датчики. Для демо без заліза: у yetsignal.config.json встановіть
     "simNodes": 4 і перезапустіть.
  2) Дізнайтесь IP цього ПК:  ipconfig  → IPv4 (напр. 192.168.1.50).
  3) Прошийте вузли ESP32-S3 (потрібен ESP-IDF v5.x; див. firmware/README.md):
     у menuconfig вкажіть ваш Wi-Fi і Server URI ws://<IP-ПК>:8787/ws/node,
     потім: idf.py build flash monitor. Вузли з'являться на сторінці "Вузли".
  4) Порожня кімната → Налаштування → "Калібрувати порожню кімнату".
`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'build');
const dist = path.join(root, 'dist');
const webDist = path.join(root, 'web', 'dist');
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

fs.mkdirSync(build, { recursive: true });
fs.mkdirSync(dist, { recursive: true });

// 1. web UI ------------------------------------------------------------------
console.log('▶ building web UI…');
execSync('npm run build', { cwd: path.join(root, 'web'), stdio: 'inherit', shell: true });

// 2. bundle the server -------------------------------------------------------
console.log('▶ bundling server…');
const serverBundle = path.join(build, 'server.cjs');
await esbuild.build({
  entryPoints: [path.join(root, 'server', 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: serverBundle,
  logLevel: 'warning',
  // node: builtins (incl. node:sqlite, node:sea) are auto-externalised.
});

// 3. SEA config with embedded assets ----------------------------------------
console.log('▶ collecting web assets…');
const assets = {};
const walk = (dir, base = '') => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(abs, rel);
    else assets[rel] = abs; // key uses forward slashes, matches req.path
  }
};
walk(webDist);
console.log(`  embedded ${Object.keys(assets).length} asset(s)`);

const seaConfig = path.join(build, 'sea-config.json');
fs.writeFileSync(
  seaConfig,
  JSON.stringify(
    {
      main: serverBundle,
      output: path.join(build, 'sea-prep.blob'),
      disableExperimentalSEAWarning: true,
      assets,
    },
    null,
    2,
  ),
);

// 4. generate blob, copy node.exe, inject ------------------------------------
console.log('▶ generating SEA blob…');
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

const exe = path.join(dist, 'YetSignal.exe');
fs.copyFileSync(process.execPath, exe);
console.log('▶ injecting blob into YetSignal.exe…');
await inject(exe, 'NODE_SEA_BLOB', fs.readFileSync(path.join(build, 'sea-prep.blob')), {
  sentinelFuse: FUSE,
});

// 5. assemble the hand-off folder (exe + config + firmware + instructions) ----
console.log('▶ assembling distribution folder…');

// real-hardware config next to the exe (simNodes:0 = no simulator)
fs.writeFileSync(
  path.join(dist, 'yetsignal.config.json'),
  JSON.stringify({ port: 8787, simNodes: 0, simPeople: 1, csiRateHz: 25, logLevel: 'info' }, null, 2),
);

// copy the firmware source so the recipient can flash their ESP32-S3 nodes
const copyDir = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === 'build' || e.name === 'managed_components') continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
};
copyDir(path.join(root, 'firmware'), path.join(dist, 'firmware'));

fs.writeFileSync(path.join(dist, 'README-RUN.txt'), RUN_README);

const sizeMb = (fs.statSync(exe).size / 1e6).toFixed(1);
console.log(`\n✅ built distribution in ${dist}`);
console.log(`   • YetSignal.exe (${sizeMb} MB) — double-click to run`);
console.log('   • yetsignal.config.json — real mode (simNodes:0; set to 4 for the demo)');
console.log('   • firmware/ — ESP32-S3 source to flash the sensor nodes');
console.log('   • README-RUN.txt — how to run + connect real nodes');
console.log('\n   Hand the whole dist/ folder to your friend.');
