/**
 * Software stand-in for an ESP32-S3 node — connects to /ws/node and streams
 * binary CSI frames in the exact firmware wire format. Lets you verify the
 * real-hardware ingestion path (and the server) without any physical sensor.
 *
 * Usage (from the server/ folder, where `ws` is installed):
 *   node scripts/fake-node.mjs                 # one node, person present
 *   node scripts/fake-node.mjs --empty         # one node, empty room
 *   node scripts/fake-node.mjs --id=02:FA:KE:00:00:02
 *   SERVER=ws://192.168.1.10:8787/ws/node node scripts/fake-node.mjs
 */
import { WebSocket } from 'ws';

const SERVER = process.env.SERVER || 'ws://localhost:8787/ws/node';
const N = 56;
const RATE = 25;
const present = !process.argv.includes('--empty');
const id = (process.argv.find((a) => a.startsWith('--id=')) || '--id=02:FA:KE:00:00:01').slice(5);

const ws = new WebSocket(`${SERVER}?id=${encodeURIComponent(id)}&ch=1&fw=fake-1.0&name=${encodeURIComponent('fake-' + id.slice(-2))}`);
ws.on('open', () => {
  console.log(`connected as ${id} (${present ? 'person present' : 'empty room'})`);
  setInterval(send, 1000 / RATE);
});
ws.on('error', (e) => console.error('error:', e.message));
ws.on('close', () => console.log('closed'));

let t = 0;
const gauss = () => {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clampI8 = (v) => (v > 127 ? 127 : v < -128 ? -128 : Math.round(v));

let motionPhase = 0;
function send() {
  t += 1 / RATE;
  const buf = Buffer.alloc(10 + N * 2);
  buf.writeBigInt64LE(BigInt(Math.round(t * 1e6)), 0);
  buf.writeInt8(-50, 8); // rssi
  buf.writeUInt8(1, 9); // channel
  const breath = present ? 0.8 * Math.sin(2 * Math.PI * 0.25 * t) : 0;
  // mostly still (so breathing is observable), with light fidget
  motionPhase = motionPhase * 0.85 + (present ? gauss() * 0.05 : 0);
  let o = 10;
  for (let k = 0; k < N; k++) {
    const basePh = (2 * Math.PI * k) / N;
    let re = 30 * Math.cos(basePh);
    let im = 30 * Math.sin(basePh);
    if (present) {
      const ph = basePh * 1.3 + breath + motionPhase;
      re += 11 * Math.cos(ph);
      im += 11 * Math.sin(ph);
    }
    re += gauss() * 1.2;
    im += gauss() * 1.2;
    buf.writeInt8(clampI8(re), o++);
    buf.writeInt8(clampI8(im), o++);
  }
  if (ws.readyState === WebSocket.OPEN) ws.send(buf);
}
