import { config, HOP_CHANNELS } from '../config.ts';
import { ROOM } from '../inference/index.ts';
import { logger } from '../logger.ts';
import type { CsiFrame, NodeInfo, Vec3 } from '../types.ts';

const log = logger('sim');
const LAMBDA = 0.122; // ~2.45 GHz wavelength (m)
const TWO_PI = Math.PI * 2;

function gaussian(): number {
  // Box–Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v);
}

interface Person {
  pos: Vec3;
  vel: Vec3;
  breathBpm: number;
  heartBpm: number;
  reflectivity: number;
  motion: number; // 0..1 macro-motion level
  walkPhase: number; // random-walk phase accumulator (radians)
  breathPhase: number;
  heartPhase: number;
}

interface SimNode {
  info: NodeInfo;
  baseRe: Float64Array; // static multipath (direct path + walls)
  baseIm: Float64Array;
}

/**
 * Simulated CSI source (NFR-16). Models the room as a set of static multipath
 * vectors per node plus one reflecting "person" per occupant. Respiration and
 * heartbeat modulate the reflected path's phase (chest displacement), and
 * macro-motion adds a random-walk phase term — exactly the interference model
 * that makes real CSI sensing work, so the downstream pipeline/inference sees a
 * realistic signal rather than canned numbers.
 */
export class CsiSimulator {
  private nodes: SimNode[] = [];
  private people: Person[] = [];
  private timer: NodeJS.Timeout | null = null;
  private fallUntil = 0;
  private impactUntil = 0;
  private seq = 0;
  private onFrame: (f: CsiFrame) => void;
  private onNode: (n: NodeInfo) => void;

  constructor(handlers: { onFrame: (f: CsiFrame) => void; onNode: (n: NodeInfo) => void }) {
    this.onFrame = handlers.onFrame;
    this.onNode = handlers.onNode;
  }

  start() {
    for (let i = 0; i < config.simNodes; i++) this.spawnNode(i);
    this.setPeople(config.simPeople);
    const period = 1000 / config.csiRateHz;
    this.timer = setInterval(() => this.tick(), period);
    log.info(`started: ${this.nodes.length} nodes @ ${config.csiRateHz} Hz, ${this.people.length} person(s)`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get nodeInfos(): NodeInfo[] {
    return this.nodes.map((n) => n.info);
  }

  private spawnNode(i: number) {
    // Place nodes around the room perimeter (walls/ceiling mounted, 3.1).
    const perimeter: Vec3[] = [
      { x: 0.2, y: 0.2, z: 2.4 },
      { x: ROOM.w - 0.2, y: 0.2, z: 2.4 },
      { x: ROOM.w - 0.2, y: ROOM.h - 0.2, z: 2.4 },
      { x: 0.2, y: ROOM.h - 0.2, z: 2.4 },
      { x: ROOM.w / 2, y: 0.2, z: 2.6 },
      { x: ROOM.w / 2, y: ROOM.h - 0.2, z: 2.6 },
    ];
    const pos = perimeter[i % perimeter.length];
    const mac = `02:53:53:${((i >> 8) & 0xff).toString(16).padStart(2, '0')}:${(i & 0xff)
      .toString(16)
      .padStart(2, '0')}:${(0xa0 + i).toString(16).padStart(2, '0')}`.toUpperCase();
    const n = config.subcarriers;
    const baseRe = new Float64Array(n);
    const baseIm = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const amp = 9 + 2 * Math.sin((k / n) * Math.PI * 1.5) + gaussian() * 0.4;
      const ph = (TWO_PI * k) / n + gaussian() * 0.2;
      baseRe[k] = amp * Math.cos(ph);
      baseIm[k] = amp * Math.sin(ph);
    }
    const info: NodeInfo = {
      id: mac,
      name: `sim-node-${i + 1}`,
      ip: `127.0.0.${10 + i}`,
      room: 'default',
      firmware: 'sim-1.0.0',
      channel: HOP_CHANNELS[i % HOP_CHANNELS.length],
      online: true,
      simulated: true,
      lastSeen: Date.now(),
      rssi: -45,
      signalQuality: 0.9,
      temperatureC: 32 + gaussian(),
      position: pos,
    };
    this.nodes.push({ info, baseRe, baseIm });
    this.onNode(info);
  }

  addNode() {
    this.spawnNode(this.nodes.length);
  }

  removeNode(id: string) {
    const idx = this.nodes.findIndex((n) => n.info.id === id);
    if (idx >= 0) this.nodes.splice(idx, 1);
  }

  setPeople(count: number) {
    count = Math.max(0, Math.min(8, Math.round(count)));
    while (this.people.length < count) {
      this.people.push({
        pos: { x: 1 + Math.random() * (ROOM.w - 2), y: 1 + Math.random() * (ROOM.h - 2), z: 1.1 },
        vel: { x: 0, y: 0, z: 0 },
        breathBpm: 12 + Math.random() * 8, // 12–20 bpm at rest
        heartBpm: 60 + Math.random() * 20,
        reflectivity: 4.5 + Math.random(),
        motion: 0.05,
        walkPhase: 0,
        breathPhase: Math.random() * TWO_PI,
        heartPhase: Math.random() * TWO_PI,
      });
    }
    this.people.length = count;
    log.info(`occupancy set to ${count}`);
  }

  get peopleCount(): number {
    return this.people.length;
  }

  triggerFall() {
    if (this.people.length === 0) return;
    const p = this.people[0];
    // ~0.4 s of violent motion (the descent / impact), long enough to fill the
    // motion-energy window, then forced stillness on the floor.
    this.impactUntil = Date.now() + 400;
    this.fallUntil = Date.now() + 9000;
    p.pos.z = 0.3;
    log.warn('fall scenario triggered');
  }

  private tick() {
    const dt = 1 / config.csiRateHz;
    const now = Date.now();
    const fallen = now < this.fallUntil;

    // advance ground-truth people
    for (const p of this.people) {
      p.breathPhase += TWO_PI * (p.breathBpm / 60) * dt;
      p.heartPhase += TWO_PI * (p.heartBpm / 60) * dt;
      if (fallen && p === this.people[0] && now < this.impactUntil) {
        p.motion = 1; // impact
      } else if (fallen) {
        p.motion = Math.max(0, p.motion - 0.15); // collapse to stillness
        p.vel.x = p.vel.y = 0;
      } else {
        // Switch activity state infrequently and stay mostly at rest, so the
        // person holds still long enough for respiration to be resolved (FR-11),
        // with occasional sustained movement bursts (FR-10).
        if (Math.random() < 0.004) p.motion = Math.random() < 0.72 ? 0.015 : 0.32 + Math.random() * 0.5;
        p.pos.z = 1.1;
      }
      // mean-reverting macro-motion phase (Ornstein–Uhlenbeck): stays ~0 when
      // still so respiration dominates, swings widely when moving.
      p.walkPhase = p.walkPhase * 0.85 + gaussian() * p.motion * 1.3;
      // drift position when moving
      if (p.motion > 0.15) {
        p.vel.x += (Math.random() - 0.5) * 0.05;
        p.vel.y += (Math.random() - 0.5) * 0.05;
        p.pos.x = clamp(p.pos.x + p.vel.x, 0.4, ROOM.w - 0.4);
        p.pos.y = clamp(p.pos.y + p.vel.y, 0.4, ROOM.h - 0.4);
        p.vel.x *= 0.9;
        p.vel.y *= 0.9;
      }
    }

    for (const node of this.nodes) {
      if (!node.info.online) continue;
      this.onFrame(this.synthFrame(node, now));
    }
    this.seq++;
  }

  private synthFrame(node: SimNode, now: number): CsiFrame {
    const n = config.subcarriers;
    const re = new Float64Array(node.baseRe);
    const im = new Float64Array(node.baseIm);

    for (const p of this.people) {
      const d = Math.hypot(p.pos.x - node.info.position.x, p.pos.y - node.info.position.y, p.pos.z - node.info.position.z);
      const gain = p.reflectivity / (1 + d);
      const breath = 0.8 * Math.sin(p.breathPhase); // ~chest displacement → phase (rad)
      const heart = 0.05 * Math.sin(p.heartPhase);
      const motionJitter = p.walkPhase;
      for (let k = 0; k < n; k++) {
        const phi = (TWO_PI * d) / LAMBDA + (TWO_PI * k * d) / (n * LAMBDA) + breath + heart + motionJitter;
        const a = gain * (1 + p.motion * 0.3 * gaussian());
        re[k] += a * Math.cos(phi);
        im[k] += a * Math.sin(phi);
      }
    }

    // receiver noise
    for (let k = 0; k < n; k++) {
      re[k] += gaussian() * 0.05;
      im[k] += gaussian() * 0.05;
    }
    // occasional impulse outlier (exercises the Hampel filter, FR-06)
    if (Math.random() < 0.04) {
      const k = (Math.random() * n) | 0;
      re[k] += (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6);
    }

    // RSSI from nearest person distance + noise
    const rssi = -42 - Math.min(20, this.people.length * 1.5) + gaussian() * 1.5;
    node.info.rssi = Math.round(rssi);
    node.info.signalQuality = clamp((rssi + 90) / 50, 0, 1);
    node.info.lastSeen = now;
    node.info.temperatureC = 32 + gaussian() * 0.5;

    return { nodeId: node.info.id, ts: now, channel: node.info.channel, rssi, re, im };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
