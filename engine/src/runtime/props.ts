import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mat } from './puppet';
import { windowTexture } from './sets';
const blockMats = new Map<string, THREE.Material>();

function ballTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d')!;
  g.fillStyle = '#e2661f'; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(Math.random() * 512, Math.random() * 256, 2, 2); }
  g.strokeStyle = '#1a0d05'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(0, 128); g.lineTo(512, 128); g.stroke();
  for (const x of [128, 384]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  for (const x of [0, 256]) { g.beginPath(); g.ellipse(x + 128, 128, 90, 128, 0, 0, Math.PI * 2); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildProp(kind: string, params: Record<string, any>): THREE.Object3D {
  let o: THREE.Object3D;
  switch (kind) {
    case 'ball': {
      const r = params.radius ?? 0.12;
      o = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.65 }));
      break;
    }
    case 'crate': { const s = params.size ?? 0.5; o = new THREE.Mesh(new RoundedBoxGeometry(s, s, s, 2, s * 0.05), mat(params.color ?? '#a0723f')); break; }
    case 'box': { const s = params.size ?? [0.4, 0.4, 0.4]; o = new THREE.Mesh(new RoundedBoxGeometry(s[0], s[1], s[2], 2, Math.min(...s) * 0.08), mat(params.color ?? '#888')); break; }
    case 'sphere': { o = new THREE.Mesh(new THREE.SphereGeometry(params.radius ?? 0.2, 20, 14), mat(params.color ?? '#ccc')); break; }
    case 'handset': {
      const g = new THREE.Group(); const m = mat(params.color ?? '#d9d2c3', { rough: 0.4 });
      const body = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.22, 0.05, 2, 0.02), m); g.add(body);
      for (const y of [-0.11, 0.11]) { const e = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.06, 0.07, 2, 0.02), m); e.position.set(0, y, 0.02); g.add(e); }
      o = g; break;
    }
    case 'mug': { const g = new THREE.Group(); const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 16), mat(params.color ?? '#f1f1f1', { rough: 0.3 })); g.add(cup); const h = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12), cup.material); h.position.x = 0.05; g.add(h); o = g; break; }
    case 'chair': {
      const g = new THREE.Group(); const m = mat(params.color ?? '#7a5a3a');
      const seat = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.05, 0.45, 2, 0.01), m); seat.position.y = 0.45; g.add(seat);
      const back = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.45, 0.04, 2, 0.01), m); back.position.set(0, 0.7, -0.2); g.add(back);
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.04), m); l.position.set(x, 0.225, z); g.add(l); }
      o = g; break;
    }
    case 'block': { // building block (structure piece) with windows
      const s = params.size ?? [3, 3, 3]; const key = `${params.color}|${params.windows ?? true}|${params.seed ?? 0}`;
      if (!blockMats.has(key)) { const tex = params.windows === false ? null : windowTexture(params.color ?? '#9aa', 0.2, params.seed ?? 1, Math.max(1, Math.round(s[0] / 1.6))); blockMats.set(key, new THREE.MeshStandardMaterial({ color: tex ? '#ffffff' : params.color, map: tex, roughness: 0.85 })); }
      o = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), blockMats.get(key)!); (o as THREE.Mesh).receiveShadow = true; break;
    }
    case 'cone': { o = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 16), mat(params.color ?? '#ff7b00')); break; }
    default: o = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat('#ff00ff'));
  }
  o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; } });
  return o;
}
