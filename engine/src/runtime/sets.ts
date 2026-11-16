// Visual construction of set presets + dynamic set behaviour (lights, doors, crowds).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mat } from './puppet';
import type { WorldEvent } from '../shared/types';

export interface BuiltSet {
  group: THREE.Group;
  update(t: number, events: WorldEvent[]): void;
  lights: Record<string, THREE.Light>;
  background: THREE.Color;
}

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/** Most recent event of a kind at or before t. */
function latest(events: WorldEvent[], kind: string, t: number) {
  let e: WorldEvent | undefined;
  for (const ev of events) if (ev.kind === kind && ev.t <= t && (!e || ev.t >= e.t)) e = ev;
  return e;
}

function keyLight(scene: THREE.Group, pos: [number, number, number], target: [number, number, number], intensity: number, color = '#ffffff', area = 16, mapSize = 2048) {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.set(...pos); l.target.position.set(...target);
  l.castShadow = true; l.shadow.mapSize.set(mapSize, mapSize);
  const c = l.shadow.camera as THREE.OrthographicCamera; c.left = -area; c.right = area; c.top = area; c.bottom = -area; c.near = 1; c.far = 80;
  l.shadow.bias = -0.0004; l.shadow.normalBias = 0.02; l.shadow.radius = 3;
  scene.add(l, l.target); return l;
}

// ----------------------------------------------------------------- COURT
function buildCourt(params: Record<string, any>, seed: number): BuiltSet {
  const g = new THREE.Group();
  const W = 15, Lc = 28;
  const floorTex = canvasTex(1024, 2048, (c) => {
    const sx = 1024 / 19, sz = 2048 / 34; // texture spans 19m x 34m
    c.fillStyle = '#5a3d24'; c.fillRect(0, 0, 1024, 2048);
    const r = rng(seed + 1);
    // planks
    const pw = 0.12 * sx;
    for (let x = 0; x < 1024; x += pw) {
      for (let y = -r() * 300; y < 2048; y += 180 + r() * 220) {
        const l = 0.55 + r() * 0.12; c.fillStyle = `hsl(${30 + r() * 6}, ${48 + r() * 10}%, ${l * 62}%)`; c.fillRect(x, y, pw - 1, 400);
      }
    }
    c.globalAlpha = 0.12; for (let i = 0; i < 4000; i++) { c.fillStyle = r() > 0.5 ? '#000' : '#fff'; c.fillRect(r() * 1024, r() * 2048, 1, 6 + r() * 20); } c.globalAlpha = 1;
    // court paint
    const cx = 512, cy = 1024; const X = (m: number) => cx + m * sx, Y = (m: number) => cy + m * sz;
    c.fillStyle = 'rgba(20,20,20,0.0)';
    c.strokeStyle = 'rgba(255,255,255,0.92)'; c.lineWidth = 0.06 * sx;
    c.strokeRect(X(-W / 2), Y(-Lc / 2), W * sx, Lc * sz);
    c.beginPath(); c.moveTo(X(-W / 2), Y(0)); c.lineTo(X(W / 2), Y(0)); c.stroke();
    c.beginPath(); c.ellipse(X(0), Y(0), 1.8 * sx, 1.8 * sz, 0, 0, Math.PI * 2); c.stroke();
    for (const end of [-1, 1]) {
      const by = end * Lc / 2; const hoopZ = end * 12.6;
      c.fillStyle = params.paint ?? 'rgba(170,40,30,0.85)';
      c.fillRect(X(-2.45), end < 0 ? Y(by) : Y(by - 5.8), 4.9 * sx, 5.8 * sz);
      c.strokeRect(X(-2.45), end < 0 ? Y(by) : Y(by - 5.8), 4.9 * sx, 5.8 * sz);
      c.beginPath(); c.ellipse(X(0), Y(by - end * 5.8), 1.8 * sx, 1.8 * sz, 0, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.ellipse(X(0), Y(hoopZ), 6.75 * sx, 6.75 * sz, 0, end < 0 ? 0 : Math.PI, end < 0 ? Math.PI : Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(X(-6.6), Y(by)); c.lineTo(X(-6.6), Y(hoopZ + end * 0.1)); c.moveTo(X(6.6), Y(by)); c.lineTo(X(6.6), Y(hoopZ + end * 0.1)); c.stroke();
    }
    // center logo
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.font = `900 ${0.9 * sx}px Inter, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(params.logo ?? 'SPLIT ARENA', X(0), Y(0));
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(19, 34), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.42, metalness: 0.0 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat('#2b2622', { rough: 0.9 }));
  surround.rotation.x = -Math.PI / 2; surround.position.y = -0.005; surround.receiveShadow = true; g.add(surround);

  // hoops (both ends, -Z is the active one)
  for (const end of [-1, 1]) {
    const hg = new THREE.Group(); hg.position.z = end * 12.6; if (end > 0) hg.rotation.y = Math.PI; g.add(hg);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.05, 0.05), new THREE.MeshStandardMaterial({ color: '#f5f7fa', roughness: 0.25, transparent: true, opacity: 0.88 }));
    board.position.set(0, 3.4, -0.78); board.castShadow = true; hg.add(board);
    const sq = new THREE.Mesh(new THREE.BoxGeometry(0.59, 0.45, 0.052), mat('#d62828')); sq.position.set(0, 3.27, -0.776); hg.add(sq);
    const sqi = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.39, 0.054), mat('#f5f7fa', { rough: 0.25 })); sqi.position.copy(sq.position); hg.add(sqi);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.84, 1.09, 0.03), mat('#1d1d1d')); frame.position.set(0, 3.4, -0.81); hg.add(frame);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.012, 8, 32), mat('#ff5a1f', { metal: 0.3, rough: 0.4 }));
    rim.rotation.x = Math.PI / 2; rim.position.set(0, 3.05, 0); rim.castShadow = true; hg.add(rim);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.55), mat('#ff5a1f')); bracket.position.set(0, 3.03, -0.5); hg.add(bracket);
    const net = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.15, 0.42, 14, 4, true), new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.85 }));
    net.position.set(0, 2.83, 0); net.name = end < 0 ? 'net' : 'net2'; hg.add(net);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.6), mat('#3a3f47', { metal: 0.5, rough: 0.4 })); arm.position.set(0, 3.25, -1.6); arm.castShadow = true; hg.add(arm);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.3, 0.35), mat('#3a3f47', { metal: 0.5, rough: 0.4 })); pole.position.set(0, 1.65, -2.4); pole.castShadow = true; hg.add(pole);
    const pad = new THREE.Mesh(new RoundedBoxGeometry(0.5, 1.8, 0.5, 2, 0.08), mat('#1f4e8c')); pad.position.set(0, 0.9, -2.4); pad.castShadow = true; hg.add(pad);
  }

  // bleachers + spectators
  const r = rng(seed + 7);
  const specs: { side: number; x: number; y: number; z: number; ph: number }[] = [];
  for (const side of [-1, 1]) {
    for (let row = 0; row < 7; row++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45 * (row + 1), 30), mat(row % 2 ? '#30353d' : '#3a4049'));
      step.position.set(side * (10.2 + row * 0.9), 0.225 * (row + 1), 0); step.receiveShadow = true; g.add(step);
      for (let z = -14; z < 14; z += 0.62) {
        if (r() < 0.22) continue;
        specs.push({ side, x: side * (10.2 + row * 0.9) + (r() - 0.5) * 0.15, y: 0.45 * (row + 1), z: z + (r() - 0.5) * 0.2, ph: r() * 10 });
      }
    }
  }
  for (const end of [-1, 1]) for (let row = 0; row < 6; row++) for (let x = -8.5; x < 8.5; x += 0.62) { if (r() < 0.25) continue; specs.push({ side: 0, x: x + (r() - 0.5) * 0.15, y: 0.45 * (row + 1), z: end * (16.2 + row * 0.9) + (r() - 0.5) * 0.15, ph: r() * 10 }); }
  const specBody = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.19, 0.4, 3, 8), new THREE.MeshStandardMaterial({ roughness: 0.8 }), specs.length);
  const specHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.6 }), specs.length);
  const shirts = ['#d62828', '#1f6feb', '#f4a261', '#2a9d8f', '#e9c46a', '#f1f1f1', '#264653', '#e76f51', '#8ab17d', '#222222'];
  const skins = ['#f1c7a6', '#d9a07b', '#a86b45', '#7a4a2c', '#ffd9bf', '#c68e63'];
  const col = new THREE.Color();
  specs.forEach((s, i) => { specBody.setColorAt(i, col.set(shirts[Math.floor(r() * shirts.length)])); specHead.setColorAt(i, col.set(skins[Math.floor(r() * skins.length)])); });
  g.add(specBody, specHead);
  const m4 = new THREE.Matrix4();

  // walls, banners, jumbotron
  const wallM = mat(params.wall ?? '#3b4456', { rough: 0.9 });
  for (const [x, z, w, d] of [[0, -19.5, 44, 0.5], [0, 19.5, 44, 0.5], [17.5, 0, 0.5, 40], [-17.5, 0, 0.5, 40]] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 16, d), wallM); wall.position.set(x, 8, z); wall.receiveShadow = true; g.add(wall);
  }
  // upper concourse band (lit)
  for (const [x, z, w, d, ry] of [[0, -19.2, 40, 1, 0], [0, 19.2, 40, 1, 0], [17.2, 0, 40, 1, Math.PI / 2], [-17.2, 0, 40, 1, Math.PI / 2]] as const) {
    const band = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat('#d9e2f2', { emissive: '#cfdcff', ei: 0.6 })); band.position.set(x, 6.6, z); band.rotation.y = ry + (z > 0 ? Math.PI : 0) + (x > 0 ? Math.PI : 0); g.add(band);
  }
  // LED advertising boards around the court
  const adTex = canvasTex(2048, 64, (c) => {
    const msgs = params.ads ?? ['SPLIT ARENA', 'TEAM RED', 'TEAM BLUE', 'NO REFUNDS', 'SNACKS ->', 'SPLIT ARENA'];
    const cols = ['#0d1b2a', '#c1121f', '#1d4ed8', '#111111', '#2a9d8f', '#0d1b2a'];
    const w = 2048 / msgs.length; msgs.forEach((m: string, i: number) => { c.fillStyle = cols[i % cols.length]; c.fillRect(i * w, 0, w, 64); c.fillStyle = '#ffffff'; c.font = '900 40px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(m, i * w + w / 2, 34); });
  });
  const adM = new THREE.MeshStandardMaterial({ map: adTex, emissive: '#ffffff', emissiveMap: adTex, emissiveIntensity: 0.55, roughness: 0.5 });
  for (const [x, z, len, ry] of [[0, -15.2, 18, 0], [0, 15.2, 18, Math.PI], [9.6, 0, 30, -Math.PI / 2], [-9.6, 0, 30, Math.PI / 2]] as const) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(len, 0.8, 0.12), adM); board.position.set(x, 0.4, z); board.rotation.y = ry; board.castShadow = true; board.receiveShadow = true; g.add(board);
  }
  // end stands behind both baselines
  for (const end of [-1, 1]) for (let row = 0; row < 6; row++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(18, 0.45 * (row + 1), 0.9), mat(row % 2 ? '#30353d' : '#3a4049'));
    step.position.set(0, 0.225 * (row + 1), end * (16.2 + row * 0.9)); step.receiveShadow = true; g.add(step);
  }
  const bannerColors = ['#d62828', '#1f6feb', '#f4a261', '#2a9d8f'];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.2), mat(bannerColors[i % 4], { rough: 0.9 }));
    b.position.set(-8.75 + i * 3.5, 9.5, -16.2); g.add(b);
  }
  const jumbo = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 5), mat('#111418', { metal: 0.4, rough: 0.4 })); jumbo.position.set(0, 11.5, 0); g.add(jumbo);
  for (let i = 0; i < 4; i++) {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.1), mat('#0e2238', { emissive: '#1d4f91', ei: 0.9 }));
    scr.position.set(Math.sin((i * Math.PI) / 2) * 2.52, 11.5, Math.cos((i * Math.PI) / 2) * 2.52); scr.rotation.y = (i * Math.PI) / 2; g.add(scr);
  }
  // ceiling light rigs (emissive strips)
  for (let i = -2; i <= 2; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(14, 0.15, 0.6), mat('#ffffff', { emissive: '#fff6e0', ei: 2.2 }));
    strip.position.set(0, 13.5, i * 6); g.add(strip);
  }

  // lighting
  const hemi = new THREE.HemisphereLight('#dfe8ff', '#5a4330', 1.1); g.add(hemi);
  const amb = new THREE.AmbientLight('#ffffff', 0.35); g.add(amb);
  const key = keyLight(g, [6, 22, 8], [0, 0, -3], 2.4, '#fff4e2', 18);
  const fill = new THREE.DirectionalLight('#9fb8ff', 0.6); fill.position.set(-10, 8, -6); g.add(fill);
  const spot = new THREE.SpotLight('#ffffff', 0, 40, 0.35, 0.5, 1.2); spot.position.set(0, 14, 0); spot.castShadow = false; g.add(spot, spot.target);

  const base = { hemi: 1.1, key: 2.4, fill: 0.6 };
  return {
    group: g, background: new THREE.Color('#1c2130'), lights: { hemi, key, fill, spot, amb },
    update(t, events) {
      // lights preset
      const le = latest(events, 'lights', t);
      const preset = le?.p.preset ?? params.lights ?? 'arena';
      const k = le ? Math.min(1, (t - le.t) / (le.p.fade ?? 0.01)) : 1;
      let target = { hemi: base.hemi, key: base.key, fill: base.fill, spot: 0 };
      if (preset === 'arena-dim') target = { hemi: 0.25, key: 0.5, fill: 0.15, spot: 0 };
      amb.intensity = preset === 'arena' ? 0.35 : 0.06;
      if (preset === 'spotlight') target = { hemi: 0.12, key: 0.15, fill: 0.05, spot: 220 };
      hemi.intensity += (target.hemi - hemi.intensity) * k; key.intensity += (target.key - key.intensity) * k; fill.intensity += (target.fill - fill.intensity) * k; spot.intensity += (target.spot - spot.intensity) * k;
      const se = latest(events, 'spotTarget', t); if (se) spot.target.position.set(se.p.x, 0, se.p.z);
      // crowd excitement: 0 calm .. 1 roaring; 'boo' makes them sit low
      const ce = latest(events, 'crowd', t); const ex = ce?.p.level ?? 0.25; const boo = ce?.p.mood === 'boo';
      specs.forEach((s, i) => {
        const bounce = Math.max(0, Math.sin(t * (6 + (s.ph % 3)) + s.ph)) * ex * 0.18;
        const y = s.y + 0.35 + bounce - (boo ? 0.05 : 0);
        m4.makeTranslation(s.x, y, s.z); specBody.setMatrixAt(i, m4);
        m4.makeTranslation(s.x, y + 0.42, s.z); specHead.setMatrixAt(i, m4);
      });
      specBody.instanceMatrix.needsUpdate = true; specHead.instanceMatrix.needsUpdate = true;
      // net swish
      const net = g.getObjectByName('net'); const sw = latest(events, 'swish', t);
      if (net && sw) { const a = t - sw.t; const s = a < 0.6 ? 1 + Math.sin(a * 30) * 0.25 * (1 - a / 0.6) : 1; net.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s)); }
    },
  };
}

// ----------------------------------------------------------------- APARTMENT
function buildApartment(params: Record<string, any>, seed: number): BuiltSet {
  const g = new THREE.Group();
  const r = rng(seed + 3);
  const floorTex = canvasTex(1024, 1024, (c) => {
    for (let y = 0; y < 1024; y += 64) for (let x = -r() * 300; x < 1024; x += 260 + r() * 120) { c.fillStyle = `hsl(25, 30%, ${22 + r() * 8}%)`; c.fillRect(x, y, 300, 63); }
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  const wallTex = canvasTex(512, 512, (c) => { c.fillStyle = '#6d6a5f'; c.fillRect(0, 0, 512, 512); for (let x = 0; x < 512; x += 32) { c.fillStyle = 'rgba(0,0,0,0.06)'; c.fillRect(x, 0, 12, 512); } });
  const wallM = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.1), wallM); back.position.set(0, 1.5, -3); back.receiveShadow = true; g.add(back);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 6), wallM); left.position.set(-3, 1.5, 0); left.receiveShadow = true; g.add(left);
  // right wall with a doorway (z 0.72..1.68, height 2.15) leading to a hallway
  const rA = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 3.72), wallM); rA.position.set(3, 1.5, -1.14); rA.receiveShadow = true; g.add(rA);
  const rB = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 1.32), wallM); rB.position.set(3, 1.5, 2.34); rB.receiveShadow = true; g.add(rB);
  const rC = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.96), wallM); rC.position.set(3, 2.575, 1.2); g.add(rC);
  const hallM = new THREE.MeshStandardMaterial({ color: '#4b4f57', roughness: 0.95 });
  const hallFloor = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.4), mat('#2c2a28', { rough: 0.8 })); hallFloor.rotation.x = -Math.PI / 2; hallFloor.position.set(4.5, 0.001, 1.2); hallFloor.receiveShadow = true; g.add(hallFloor);
  for (const z of [0.1, 2.3]) { const hw = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.1), hallM); hw.position.set(4.5, 1.5, z); hw.receiveShadow = true; g.add(hw); }
  const hallBack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 2.4), hallM); hallBack.position.set(6, 1.5, 1.2); g.add(hallBack);
  const hallCeil = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 2.4), hallM); hallCeil.position.set(4.5, 3, 1.2); g.add(hallCeil);
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(6, 0.1, 6), mat('#4a4740')); ceil.position.set(0, 3, 0); g.add(ceil);
  // window with night city
  const cityTex = canvasTex(512, 384, (c) => {
    const grd = c.createLinearGradient(0, 0, 0, 384); grd.addColorStop(0, '#05070f'); grd.addColorStop(1, '#14203a'); c.fillStyle = grd; c.fillRect(0, 0, 512, 384);
    for (let b = 0; b < 14; b++) { const x = b * 38 + r() * 10, h = 120 + r() * 200; c.fillStyle = '#0a0d16'; c.fillRect(x, 384 - h, 34, h); for (let wy = 384 - h + 8; wy < 380; wy += 14) for (let wx = x + 4; wx < x + 30; wx += 9) if (r() < 0.35) { c.fillStyle = r() < 0.8 ? '#ffd27a' : '#9fd3ff'; c.fillRect(wx, wy, 4, 6); } }
    c.fillStyle = '#e8ecf5'; c.beginPath(); c.arc(420, 70, 22, 0, Math.PI * 2); c.fill();
  });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.3), new THREE.MeshBasicMaterial({ map: cityTex })); win.position.set(-2.94, 1.6, -0.5); win.rotation.y = Math.PI / 2; g.add(win);
  const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.4, 1.9), mat('#2a2622')); winFrame.position.set(-2.96, 1.6, -0.5); g.add(winFrame);
  for (const z of [-0.5]) { const mull = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.3, 0.04), mat('#2a2622')); mull.position.set(-2.92, 1.6, z); g.add(mull); }
  // sofa
  const sofaM = mat(params.sofa ?? '#5b3b3b', { rough: 0.95 });
  const base = new THREE.Mesh(new RoundedBoxGeometry(2.2, 0.45, 0.85, 3, 0.08), sofaM); base.position.set(0, 0.25, -2.35); base.castShadow = base.receiveShadow = true; g.add(base);
  const backrest = new THREE.Mesh(new RoundedBoxGeometry(2.2, 0.6, 0.25, 3, 0.08), sofaM); backrest.position.set(0, 0.7, -2.7); backrest.castShadow = true; g.add(backrest);
  for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new RoundedBoxGeometry(0.25, 0.6, 0.85, 3, 0.08), sofaM); arm.position.set(sx * 1.1, 0.42, -2.35); arm.castShadow = true; g.add(arm); }
  // side table + phone
  const table = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.55, 0.5, 2, 0.03), mat('#3b2a1e', { rough: 0.6 })); table.position.set(1.55, 0.29, -2.3); table.castShadow = table.receiveShadow = true; g.add(table);
  const phoneBase = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.07, 0.2, 2, 0.02), mat('#d9d2c3', { rough: 0.4 })); phoneBase.position.set(1.55, 0.6, -2.3); phoneBase.castShadow = true; g.add(phoneBase);
  const phoneLight = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: '#330000' })); phoneLight.position.set(1.65, 0.64, -2.21); g.add(phoneLight);
  // lamp
  const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 8), mat('#222')); lampPole.position.set(-1.6, 0.75, -2.4); g.add(lampPole);
  const shadeM = new THREE.MeshStandardMaterial({ color: '#e9d8b0', emissive: '#ffcf7a', emissiveIntensity: 0.6, roughness: 0.9, side: THREE.DoubleSide });
  const shadeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 0.32, 16, 1, true), shadeM); shadeMesh.position.set(-1.6, 1.55, -2.4); g.add(shadeMesh);
  // door (hinged)
  const frameM = mat('#2b2420');
  for (const z of [0.69, 1.71]) { const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.07), frameM); jamb.position.set(2.97, 1.1, z); g.add(jamb); }
  const header = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 1.1), frameM); header.position.set(2.97, 2.19, 1.2); g.add(header);
  const doorPivot = new THREE.Group(); doorPivot.position.set(2.92, 0, 0.7); g.add(doorPivot);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.05, 0.95), mat('#4a3a2c', { rough: 0.7 })); door.position.set(0, 1.03, 0.48); door.castShadow = true; doorPivot.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat('#c8a24a', { metal: 0.8, rough: 0.3 })); knob.position.set(-0.05, 1.0, 0.85); doorPivot.add(knob);
  const hallLight = new THREE.PointLight('#bcd2ff', 0, 8, 1.2); hallLight.position.set(4.4, 2.1, 1.2); hallLight.castShadow = true; hallLight.shadow.mapSize.set(512, 512); g.add(hallLight);
  // rug, shelf, frames
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), mat('#3d4a5c', { rough: 1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.005, -0.8); rug.receiveShadow = true; g.add(rug);
  for (let i = 0; i < 3; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.03), mat('#1a1714')); f.position.set(-0.7 + i * 0.7, 1.9, -2.94); g.add(f); const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.42), mat(['#7a8c99', '#99857a', '#8a997a'][i])); pic.position.set(-0.7 + i * 0.7, 1.9, -2.92); g.add(pic); }
  // lights
  const hemi = new THREE.HemisphereLight('#6c7fa8', '#1b1612', 0.6); g.add(hemi);
  const moon = keyLight(g, [-8, 5, -1], [0, 0, -1], 1.4, '#8fb0ff', 6, 1024);
  const fillA = new THREE.PointLight('#7f93c9', 2.5, 9, 1.2); fillA.position.set(-1.5, 2.4, 2.4); g.add(fillA);
  const lamp = new THREE.PointLight('#ffc879', 22, 9, 1.4); lamp.position.set(-1.6, 1.5, -2.2); lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.002; g.add(lamp);
  const phoneGlow = new THREE.PointLight('#ff4040', 0, 3, 1.5); phoneGlow.position.set(1.6, 0.8, -2.1); g.add(phoneGlow);
  return {
    group: g, background: new THREE.Color('#05060a'), lights: { hemi, moon, lamp, phoneGlow, hallLight, fillA },
    update(t, events) {
      const le = latest(events, 'lights', t); const preset = le?.p.preset ?? params.lights ?? 'night';
      const flick = latest(events, 'flicker', t);
      let lampI = preset === 'blackout' ? 0 : preset === 'lamp' ? 30 : 22; let hemiI = preset === 'blackout' ? 0.22 : 0.6; fillA.intensity = preset === 'blackout' ? 1.2 : 2.5;
      if (flick && t - flick.t < (flick.p.dur ?? 1.2)) { const f = Math.sin((t - flick.t) * 60) * Math.sin((t - flick.t) * 23); lampI *= f > 0.1 ? 1 : 0.05; }
      lamp.intensity = lampI; hemi.intensity = hemiI; shadeM.emissiveIntensity = lampI > 0.5 ? 0.6 : 0.02;
      const ring = latest(events, 'phoneRing', t); const ringing = ring && ring.p.on !== false;
      const rp = ringing ? (Math.sin((t - ring!.t) * 18) > 0 && ((t - ring!.t) % 2.4) < 1.4 ? 1 : 0) : 0;
      phoneGlow.intensity = rp * 6; (phoneLight.material as THREE.MeshBasicMaterial).color.set(rp ? '#ff2020' : '#330000');
      phoneBase.position.y = 0.6 + rp * 0.004 * Math.sin(t * 90);
      const de = latest(events, 'door', t); const target = de ? (de.p.open ?? 1) : 0; const dk = de ? Math.min(1, (t - de.t) / (de.p.dur ?? 1.5)) : 1;
      const prev = de?.p.from ?? 0; const open = prev + (target - prev) * (dk * dk * (3 - 2 * dk));
      doorPivot.rotation.y = open * 1.6; hallLight.intensity = open * (de?.p.hallLight ?? 3) * 8;
    },
  };
}

// ----------------------------------------------------------------- CITY
export function windowTexture(base: string, lit = 0.25, seed = 1, cols = 3) {
  const r = rng(seed);
  return canvasTex(128, 128, (c) => {
    c.fillStyle = base; c.fillRect(0, 0, 128, 128);
    const w = 128 / cols;
    for (let i = 0; i < cols; i++) {
      c.fillStyle = r() < lit ? '#ffe9a8' : `hsl(210, 25%, ${18 + r() * 14}%)`;
      c.fillRect(i * w + w * 0.18, 26, w * 0.64, 64);
      c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(i * w + w * 0.18, 26, w * 0.64, 8);
    }
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, 120, 128, 8);
  });
}

function buildCity(params: Record<string, any>, seed: number): BuiltSet {
  const g = new THREE.Group(); const r = rng(seed + 11);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat('#5d6b4f', { rough: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; g.add(ground);
  const roadTex = canvasTex(256, 1024, (c) => { c.fillStyle = '#34373c'; c.fillRect(0, 0, 256, 1024); for (let i = 0; i < 3000; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; c.fillRect(Math.random() * 256, Math.random() * 1024, 2, 2); } c.fillStyle = '#e8c547'; c.fillRect(124, 0, 3, 1024); c.fillRect(130, 0, 3, 1024); c.fillStyle = '#e9e9e9'; for (let y = 0; y < 1024; y += 64) { c.fillRect(62, y, 4, 34); c.fillRect(190, y, 4, 34); } }, [1, 6]);
  for (const rot of [0, Math.PI / 2]) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(12, 160), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9 })); road.rotation.set(-Math.PI / 2, 0, rot); road.position.y = 0.0; road.receiveShadow = true; g.add(road);
  }
  const inter = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), mat('#34373c', { rough: 0.9 })); inter.rotation.x = -Math.PI / 2; inter.position.y = 0.004; inter.receiveShadow = true; g.add(inter);
  // crosswalks
  for (const [x, z, rot] of [[0, 7.2, 0], [0, -7.2, 0], [7.2, 0, Math.PI / 2], [-7.2, 0, Math.PI / 2]] as const) for (let k = -5; k <= 5; k++) { const st = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 2.2), mat('#ececec', { rough: 0.8 })); st.rotation.set(-Math.PI / 2, 0, rot); st.position.set(x + (rot ? 0 : k * 1.05), 0.008, z + (rot ? k * 1.05 : 0)); st.receiveShadow = true; g.add(st); }
  // sidewalks (raised blocks at the four corners)
  const walkM = mat('#b9b4aa', { rough: 0.9 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const sw = new THREE.Mesh(new THREE.BoxGeometry(74, 0.18, 74), walkM); sw.position.set(sx * (6 + 37), 0.09, sz * (6 + 37)); sw.receiveShadow = true; g.add(sw); }
  // background skyline (static, instanced)
  const towers: { x: number; z: number; w: number; d: number; h: number; c: string }[] = [];
  const palette = ['#8a9bb0', '#b7a48f', '#9aa79a', '#c9c2b6', '#7f8a99', '#a8968a', '#d1cbbf'];
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, rad = 34 + r() * 40; const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (Math.abs(x) < 9 || Math.abs(z) < 9) continue;
    if (x > 0 && z > 0) continue; // keep the camera-side quadrant open for aerial shots
    towers.push({ x, z, w: 8 + r() * 10, d: 8 + r() * 10, h: 18 + r() * 60, c: palette[Math.floor(r() * palette.length)] });
  }
  for (const t of towers) {
    const tex = windowTexture(t.c, 0.15, Math.floor(r() * 1000)); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(Math.round(t.w / 3), Math.round(t.h / 3.2));
    const m = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })); m.position.set(t.x, t.h / 2, t.z); m.castShadow = false; m.receiveShadow = true; g.add(m);
  }
  // street lamps, trees, parked cars along the sidewalks
  const poleM = mat('#2d3136', { metal: 0.6, rough: 0.4 });
  for (const sx of [-1, 1]) for (let z = -30; z <= 30; z += 10) {
    if (Math.abs(z) < 8) continue;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6, 8), poleM); pole.position.set(sx * 6.6, 3, z); pole.castShadow = true; g.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), poleM); arm.position.set(sx * 6.0, 5.95, z); g.add(arm);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.3), mat('#fff6d8', { emissive: '#fff1c2', ei: 0.4 })); head.position.set(sx * 5.4, 5.88, z); g.add(head);
    const pole2 = pole.clone(); pole2.position.set(z, 3, sx * 6.6); g.add(pole2);
  }
  const leafM = mat('#3f7a3a', { rough: 0.9 }), trunkM = mat('#5a4030');
  for (let i = 0; i < 24; i++) {
    const side = i % 4; const along = 9 + (i >> 2) * 5 + r() * 1.5; const sgn = side < 2 ? 1 : -1;
    const x = side % 2 ? sgn * along : sgn * 7.8 * (r() < 0.5 ? 1 : -1), z = side % 2 ? (r() < 0.5 ? 7.8 : -7.8) : sgn * along;
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.6, 6), trunkM); tr.position.set(x, 0.8, z); tr.castShadow = true; g.add(tr);
    const lf = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2 + r() * 0.4, 0), leafM); lf.position.set(x, 2.4, z); lf.castShadow = true; g.add(lf);
  }
  const carCols = ['#c1121f', '#1d4ed8', '#f1f1f1', '#222222', '#e9c46a', '#2a9d8f'];
  for (let i = 0; i < 10; i++) {
    const car = new THREE.Group(); const c = mat(carCols[i % carCols.length], { metal: 0.3, rough: 0.4 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.7, 4.2, 2, 0.15), c); body.position.y = 0.55; body.castShadow = true; car.add(body);
    const cab = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.6, 2.2, 2, 0.15), mat('#9fb3c8', { metal: 0.5, rough: 0.2 })); cab.position.set(0, 1.15, -0.2); cab.castShadow = true; car.add(cab);
    for (const [wx, wz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 12), mat('#111')); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.33, wz); car.add(w); }
    const along = 12 + i * 5.5; const lane = i % 2 ? 4.4 : -4.4;
    if (i < 5) car.position.set(lane, 0, along * (i % 3 ? 1 : -1)); else { car.position.set(along * (i % 3 ? 1 : -1), 0, lane); car.rotation.y = Math.PI / 2; }
    car.name = `car${i}`; g.add(car);
  }
  const hemi = new THREE.HemisphereLight('#cfe3ff', '#6b6150', 1.0); g.add(hemi);
  const sun = keyLight(g, [30, 50, 20], [0, 0, 0], 2.6, '#fff1dc', 34, 2048);
  const amb = new THREE.AmbientLight('#ffffff', 0.25); g.add(amb);
  return {
    group: g, background: new THREE.Color(params.sky ?? '#9cc3e6'), lights: { hemi, sun, amb },
    update(t, events) {
      const le = latest(events, 'lights', t); const dusk = le?.p.preset === 'dusk';
      sun.color.set(dusk ? '#ffb27a' : '#fff1dc'); hemi.intensity = dusk ? 0.6 : 1.0;
      // vehicles sag under gravity (visual cue)
      const ge = latest(events, 'gravity', t); const gv = ge?.p.value ?? 1;
      for (let i = 0; i < 10; i++) { const c = g.getObjectByName(`car${i}`); if (c) c.scale.y = Math.max(0.55, 1 - Math.log2(Math.max(1, gv)) * 0.08); }
    },
  };
}

// ----------------------------------------------------------------- LAB
function buildLab(params: Record<string, any>, seed: number): BuiltSet {
  const g = new THREE.Group();
  const gridTex = (base: string, line: string) => canvasTex(512, 512, (c) => { c.fillStyle = base; c.fillRect(0, 0, 512, 512); c.strokeStyle = line; c.lineWidth = 4; for (let i = 0; i <= 512; i += 64) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 512); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(512, i); c.stroke(); } }, [5, 5]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), new THREE.MeshStandardMaterial({ map: gridTex('#d9dde3', '#aab2bd'), roughness: 0.5 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  const wm = new THREE.MeshStandardMaterial({ map: gridTex('#eef1f5', '#c3cad3'), roughness: 0.8 });
  for (const [x, z, ry] of [[0, -5.5, 0], [-5.5, 0, Math.PI / 2], [5.5, 0, -Math.PI / 2]] as const) { const w = new THREE.Mesh(new THREE.PlaneGeometry(11, 6.5), wm); w.position.set(x, 3.25, z); w.rotation.y = ry; w.receiveShadow = true; g.add(w); }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), mat('#c9ced6')); ceil.rotation.x = Math.PI / 2; ceil.position.y = 6.5; g.add(ceil);
  const desk = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.9, 1.0, 2, 0.05), mat('#38414d', { metal: 0.3, rough: 0.5 })); desk.position.set(0, 0.45, -3); desk.castShadow = desk.receiveShadow = true; g.add(desk);
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.08, 20), mat('#e63946', { emissive: '#e63946', ei: 0.3 })); button.position.set(0.6, 0.94, -2.85); g.add(button);
  const dialG = new THREE.Group(); dialG.position.set(0, 3.4, -5.45); g.add(dialG);
  const dialFace = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), new THREE.MeshStandardMaterial({ map: canvasTex(512, 512, (c) => { c.fillStyle = '#f7f3e8'; c.beginPath(); c.arc(256, 256, 250, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#222'; c.lineWidth = 10; c.stroke(); c.font = '700 44px Inter'; c.textAlign = 'center'; c.fillStyle = '#222'; const labels = ['0', '1G', '2G', '4G', '8G', '16G']; labels.forEach((l, i) => { const a = Math.PI * 0.75 + (i / (labels.length - 1)) * Math.PI * 1.5; c.fillText(l, 256 + Math.cos(a) * 185, 270 + Math.sin(a) * 185); }); c.fillStyle = '#c1121f'; c.font = '900 40px Inter'; c.fillText('GRAVITY', 256, 380); }), roughness: 0.6 }));
  dialG.add(dialFace);
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.03), mat('#c1121f')); needle.geometry.translate(0, 0.42, 0); needle.position.z = 0.03; dialG.add(needle);
  const hemi = new THREE.HemisphereLight('#ffffff', '#8b95a3', 1.1); g.add(hemi);
  const key = keyLight(g, [4, 12, 6], [0, 0, -1], 2.0, '#ffffff', 9);
  const alarm = new THREE.PointLight('#ff2a2a', 0, 14, 1.2); alarm.position.set(0, 5.5, 0); g.add(alarm);
  return {
    group: g, background: new THREE.Color('#dfe3e8'), lights: { hemi, key, alarm },
    update(t, events) {
      const ge = latest(events, 'gravityDial', t); const val = ge?.p.value ?? params.gravity ?? 1;
      const idx = val <= 0 ? 0 : Math.min(5, 1 + Math.log2(val)); const a = Math.PI * 0.75 + (idx / 5) * Math.PI * 1.5;
      // canvas angle a (clockwise, y-down) -> needle (points +Y at rotation 0)
      needle.rotation.z = -a - Math.PI / 2 + Math.sin(t * 40) * 0.01 * idx;
      const le = latest(events, 'lights', t); const alarmOn = le?.p.preset === 'lab-alarm';
      alarm.intensity = alarmOn ? (Math.sin(t * 8) > 0 ? 40 : 0) : 0; hemi.intensity = alarmOn ? 0.5 : 1.1;
    },
  };
}

export function buildSet(preset: string, params: Record<string, any>, seed: number): BuiltSet {
  switch (preset) {
    case 'court': return buildCourt(params, seed);
    case 'apartment': return buildApartment(params, seed);
    case 'lab': return buildLab(params, seed);
    case 'city': return buildCity(params, seed);
    default: throw new Error(`Unknown set preset "${preset}"`);
  }
}
