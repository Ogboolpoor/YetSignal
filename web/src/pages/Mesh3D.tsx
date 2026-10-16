import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { useStore } from '../store';

const ROOM = { w: 6, h: 4.5 }; // matches server ROOM

/**
 * FR-19 — 3D visualisation of the mesh topology with real-time signal quality.
 * Raw Three.js (no react-three-fiber) for minimal dependencies. Node colour =
 * signal quality, glow/scale = live motion energy, links = node-to-node quality.
 */
export function Mesh3D() {
  const { t } = useTranslation();
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const width = mount.clientWidth;
    const height = Math.max(420, Math.round(width * 0.52));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f17);
    scene.fog = new THREE.Fog(0x0b0f17, 12, 26);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x4060a0, 1.2));
    const key = new THREE.PointLight(0x4f8cff, 120, 50);
    key.position.set(4, 8, 6);
    scene.add(key);

    // floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM.w, ROOM.h),
      new THREE.MeshStandardMaterial({ color: 0x121826, roughness: 0.9, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const grid = new THREE.GridHelper(Math.max(ROOM.w, ROOM.h), 12, 0x243049, 0x1c2436);
    scene.add(grid);

    const toScene = (p: { x: number; y: number; z: number }) =>
      new THREE.Vector3(p.x - ROOM.w / 2, p.z, p.y - ROOM.h / 2);

    const nodeGroup = new THREE.Group();
    const linkGroup = new THREE.Group();
    const personGroup = new THREE.Group();
    scene.add(nodeGroup, linkGroup, personGroup);

    type NodeObj = { mesh: THREE.Mesh; ring: THREE.Mesh };
    let nodeObjs: Record<string, NodeObj> = {};
    let builtIds = '';

    function rebuild(nodeList: { id: string; position: any }[]) {
      nodeGroup.clear();
      linkGroup.clear();
      nodeObjs = {};
      for (const n of nodeList) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 24, 24),
          new THREE.MeshStandardMaterial({ color: 0x4f8cff, emissive: 0x102040, roughness: 0.4 }),
        );
        mesh.position.copy(toScene(n.position));
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.32, 0.025, 8, 32),
          new THREE.MeshBasicMaterial({ color: 0x28d6a8, transparent: true, opacity: 0.6 }),
        );
        ring.position.copy(mesh.position);
        ring.rotation.x = Math.PI / 2;
        nodeGroup.add(mesh, ring);
        nodeObjs[n.id] = { mesh, ring };
      }
      // links between every node pair
      for (let i = 0; i < nodeList.length; i++) {
        for (let j = i + 1; j < nodeList.length; j++) {
          const geo = new THREE.BufferGeometry().setFromPoints([
            toScene(nodeList[i].position),
            toScene(nodeList[j].position),
          ]);
          const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x243049, transparent: true, opacity: 0.5 }));
          line.userData = { a: nodeList[i].id, b: nodeList[j].id };
          linkGroup.add(line);
        }
      }
    }

    // simple orbit via pointer drag + auto-rotate
    let theta = 0.7;
    let phi = 0.9;
    let radius = 9;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let autoRotate = true;
    renderer.domElement.addEventListener('pointerdown', (e) => {
      dragging = true;
      autoRotate = false;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => (dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      theta -= (e.clientX - lastX) * 0.006;
      phi = Math.max(0.2, Math.min(1.4, phi - (e.clientY - lastY) * 0.006));
      lastX = e.clientX;
      lastY = e.clientY;
    });
    renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      radius = Math.max(4, Math.min(18, radius + e.deltaY * 0.01));
    });

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const { nodes, sensing } = useStore.getState();
      const list = Object.values(nodes);
      const ids = list.map((n) => n.id).sort().join(',');
      if (ids !== builtIds) {
        builtIds = ids;
        rebuild(list);
      }

      for (const n of list) {
        const o = nodeObjs[n.id];
        if (!o) continue;
        const mat = o.mesh.material as THREE.MeshStandardMaterial;
        const q = n.online ? n.signalQuality : 0;
        // hue: red(low)→green(high) quality
        const col = new THREE.Color().setHSL(0.0 + 0.33 * q, 0.7, n.online ? 0.55 : 0.25);
        mat.color.copy(col);
        const motion = sensing?.perNode?.[n.id]?.motionEnergy ?? 0;
        mat.emissive.setHSL(0.5, 0.8, n.online ? 0.15 + motion * 0.5 : 0);
        const s = 1 + motion * 0.8;
        o.mesh.scale.setScalar(s);
        (o.ring.material as THREE.MeshBasicMaterial).opacity = n.online ? 0.3 + motion * 0.7 : 0.08;
        o.ring.scale.setScalar(1 + motion * 0.6);
      }
      // link opacity by combined quality
      for (const line of linkGroup.children as THREE.Line[]) {
        const a = nodes[line.userData.a];
        const b = nodes[line.userData.b];
        const m = line.material as THREE.LineBasicMaterial;
        const on = a?.online && b?.online;
        m.opacity = on ? 0.15 + 0.5 * Math.min(a.signalQuality, b.signalQuality) : 0.05;
      }

      if (autoRotate) theta += 0.0025;
      camera.position.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      );
      camera.lookAt(0, 0.8, 0);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth;
      const h = Math.max(420, Math.round(w * 0.52));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <h3>{t('nav.mesh')}</h3>
        <div ref={mountRef} className="full" style={{ cursor: 'grab' }} />
        <div className="sub" style={{ marginTop: 10 }}>
          🟢→🔴 {t('nodes.quality')} · {t('motion.title')} ⇒ glow/scale · drag to orbit, scroll to zoom
        </div>
      </div>
    </div>
  );
}
