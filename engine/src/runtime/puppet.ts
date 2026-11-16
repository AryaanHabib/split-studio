// Procedural, parametric character rig ("puppet").
// One rig covers toddlers, adults, giants, elders etc. through proportions,
// outfits, hair and accessories. Faces are built from parts so expressions are
// controllable (brows, eyes, mouth shapes, tears, blush) without lip-sync.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PuppetLook } from '../shared/types';
import { JOINTS, type JointName, type Pose, type Face } from './pose';

const matCache = new Map<string, THREE.Material>();
let vcMaterial: THREE.Material | null = null;
export function getVertexColorMaterial() { return (vcMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 })); }
export function mat(color: string, opts: { rough?: number; metal?: number; emissive?: string; ei?: number } = {}) {
  const key = `${color}|${opts.rough ?? 0.72}|${opts.metal ?? 0}|${opts.emissive ?? ''}|${opts.ei ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.72, metalness: opts.metal ?? 0, emissive: opts.emissive ?? '#000000', emissiveIntensity: opts.ei ?? 0 });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const r3 = (x: number) => Math.round(x * 1000) / 1000;
function capsule(r: number, len: number) { return geo(`cap${r3(r)}_${r3(len)}`, () => new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10)); }
function sphere(r: number, w = 16, h = 12) { return geo(`sph${r3(r)}_${w}`, () => new THREE.SphereGeometry(r, w, h)); }
function rbox(w: number, h: number, d: number, rad: number) { return geo(`rb${r3(w)}_${r3(h)}_${r3(d)}_${r3(rad)}`, () => new RoundedBoxGeometry(w, h, d, 3, Math.min(rad, w / 2, h / 2, d / 2) * 0.999)); }

function mesh(g: THREE.BufferGeometry, m: THREE.Material, shadow = true) {
  const o = new THREE.Mesh(g, m);
  o.castShadow = shadow; o.receiveShadow = false;
  return o;
}

export const ARCHETYPES: Record<string, Partial<PuppetLook>> = {
  adult: { height: 1.8, headScale: 1, bodyWidth: 1, limb: 1 },
  athlete: { height: 2.05, headScale: 0.92, bodyWidth: 1.08, limb: 1.05 },
  giant: { height: 2.6, headScale: 0.9, bodyWidth: 1.2, limb: 1.2 },
  toddler: { height: 0.86, headScale: 2.05, bodyWidth: 1.35, limb: 1.55, eyeSize: 1.3 },
  child: { height: 1.25, headScale: 1.5, bodyWidth: 1.05, limb: 1.1, eyeSize: 1.15 },
  elder: { height: 1.68, headScale: 1.05, bodyWidth: 1.05, limb: 0.95 },
  stocky: { height: 1.72, headScale: 1.05, bodyWidth: 1.35, limb: 1.25 },
};

export interface PuppetDims {
  H: number; R: number; T: number; L: number; SW: number; HW: number; up: number; fore: number; thigh: number; shin: number; footH: number; armR: number; legR: number;
}

export function puppetDims(look: PuppetLook): PuppetDims {
  const H = look.height;
  const toddlerish = H < 1.3;
  const R = H * 0.075 * look.headScale;
  const T = H * (toddlerish ? 0.3 : 0.33);
  const n = H * 0.025;
  const L = H - T - n - R * 1.9;
  const SW = H * (toddlerish ? 0.15 : 0.125) * look.bodyWidth;
  const footH = H * 0.04;
  return {
    H, R, T, L, SW, HW: SW * 0.55,
    up: T * (toddlerish ? 0.5 : 0.56), fore: T * (toddlerish ? 0.46 : 0.5),
    thigh: (L - footH) * 0.5, shin: (L - footH) * 0.5, footH,
    armR: H * 0.028 * look.limb, legR: H * 0.037 * look.limb,
  };
}

function jerseyTexture(num: string, color: string, trim: string) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = color; g.fillRect(0, 0, 256, 256);
  g.font = '900 150px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 14; g.strokeStyle = trim; g.strokeText(num, 128, 140);
  g.fillStyle = '#ffffff'; g.fillText(num, 128, 140);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Puppet {
  root = new THREE.Group();
  j = {} as Record<JointName, THREE.Group>;
  dims: PuppetDims;
  look: PuppetLook;
  face: { eyes: THREE.Object3D[]; browL: THREE.Object3D; browR: THREE.Object3D; mouthOpen: THREE.Mesh; smile: THREE.Mesh; frown: THREE.Mesh; line: THREE.Mesh; grin: THREE.Mesh; tears: THREE.Mesh[]; blush: THREE.Mesh[] };
  handL = new THREE.Object3D();
  handR = new THREE.Object3D();
  headTop = new THREE.Object3D();
  headCenter = new THREE.Object3D();
  private hipsBaseY: number;

  constructor(look: PuppetLook) {
    this.look = look;
    const d = (this.dims = puppetDims(look));
    const { H, R, T, SW, HW } = d;
    const skin = mat(look.skin, { rough: 0.6 });
    const shirt = mat(look.shirt);
    const pants = mat(look.pants);
    const shoes = mat(look.shoes, { rough: 0.5 });
    const hairM = mat(look.hairColor, { rough: 0.85 });
    const dark = mat('#14110f', { rough: 0.35 });
    const toddler = H < 1.3;

    for (const n of JOINTS) { this.j[n] = new THREE.Group(); this.j[n].name = n; }
    const J = this.j;
    this.hipsBaseY = d.L;
    this.root.add(J.hips); J.hips.position.y = d.L;
    J.hips.add(J.spine);
    J.spine.add(J.chest); J.chest.position.y = T * 0.55;
    J.chest.add(J.neck); J.neck.position.y = T * 0.45;
    J.neck.add(J.head); J.head.position.y = H * 0.025;

    // pelvis / shorts / diaper
    const pelvisM = look.outfit === 'diaper' ? mat('#f4f1ea', { rough: 0.9 }) : look.outfit === 'onesie' ? shirt : pants;
    const pelvis = mesh(rbox(SW * 1.75, T * 0.32, SW * 1.15, SW * 0.4), pelvisM);
    pelvis.position.y = -T * 0.02; J.hips.add(pelvis);
    // torso
    const torsoM = look.outfit === 'diaper' ? skin : shirt;
    const taper = toddler ? 1 : look.archetype === 'athlete' || look.archetype === 'giant' ? 0.72 : 0.84;
    const torso = mesh(geo(`torso${r3(SW)}_${r3(T)}_${taper}_${toddler}`, () => {
      const g = new RoundedBoxGeometry(SW * 2, T * (toddler ? 0.95 : 0.92), SW * (toddler ? 1.35 : 1.0), 3, SW * (toddler ? 0.6 : 0.38));
      const pos = g.attributes.position; const hh = T * (toddler ? 0.95 : 0.92) / 2;
      for (let i = 0; i < pos.count; i++) { const k = taper + (1 - taper) * ((pos.getY(i) + hh) / (2 * hh)); pos.setX(i, pos.getX(i) * k); }
      g.computeVertexNormals(); return g;
    }), torsoM);
    torso.position.y = T * 0.5; J.spine.add(torso);
    if (toddler) { // belly
      const belly = mesh(sphere(SW * 0.85), torsoM); belly.scale.set(1.1, 0.95, 0.75); belly.position.set(0, T * 0.32, SW * 0.38); J.spine.add(belly);
    }
    if (look.outfit === 'jersey' && look.number) {
      const tex = jerseyTexture(look.number, look.shirt, look.accessoryColor ?? '#111');
      const pm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 });
      const front = new THREE.Mesh(new THREE.PlaneGeometry(SW * 1.3, SW * 1.3), pm);
      front.position.set(0, T * 0.55, SW * 0.585); J.spine.add(front);
      const back = front.clone(); back.rotation.y = Math.PI; back.position.z = -SW * 0.585; J.spine.add(back);
    }
    if (look.outfit === 'suit' || look.outfit === 'lab') {
      const tie = mesh(rbox(SW * 0.25, T * 0.55, 0.01, 0.004), mat(look.outfit === 'lab' ? '#3b6e9e' : '#7a1f1f'));
      tie.position.set(0, T * 0.6, SW * 0.585); J.spine.add(tie);
    }

    // neck + head
    const neck = mesh(capsule(R * 0.32, H * 0.02), skin); neck.position.y = H * 0.012; J.neck.add(neck);
    const headM = skin;
    const head = look.headShape === 'box' ? mesh(rbox(R * 1.85, R * 1.9, R * 1.8, R * 0.45), headM) : mesh(sphere(R, 24, 18), headM);
    if (look.headShape !== 'box') head.scale.set(1, 1.02, 0.96);
    head.position.y = R * 0.92; J.head.add(head);
    this.headCenter.position.y = R * 0.92; J.head.add(this.headCenter);
    this.headTop.position.y = R * 1.95; J.head.add(this.headTop);
    // ears + nose
    for (const sx of [-1, 1]) { const ear = mesh(sphere(R * 0.2, 10, 8), skin, false); ear.scale.set(0.6, 1, 0.8); ear.position.set(sx * R * 0.97, R * 0.88, 0); J.head.add(ear); }
    const nose = mesh(sphere(R * (toddler ? 0.11 : 0.13), 10, 8), mat(shade(look.skin, -0.06), { rough: 0.6 }), false); nose.position.set(0, R * 0.78, R * 0.95); J.head.add(nose);

    // face
    const es = R * 0.12 * (look.eyeSize ?? 1);
    const eyes: THREE.Object3D[] = [];
    for (const sx of [-1, 1]) {
      const eg = new THREE.Group(); eg.position.set(sx * R * 0.36, R * 0.98, R * 0.86); eg.rotation.y = sx * 0.35;
      const e = mesh(sphere(es, 12, 10), dark, false); e.scale.set(0.85, 1.15, 0.5); eg.add(e);
      const hl = mesh(sphere(es * 0.32, 8, 6), mat('#ffffff', { rough: 0.2, emissive: '#ffffff', ei: 0.4 }), false); hl.position.set(es * 0.3, es * 0.45, es * 0.42); eg.add(hl);
      J.head.add(eg); eyes.push(eg);
    }
    const browM = mat(look.hairColor === '#f4f1ea' ? '#5a4a3a' : look.hairColor, { rough: 0.9 });
    const mkBrow = (sx: number) => { const b = mesh(rbox(R * 0.36, R * 0.095, R * 0.07, R * 0.04), browM, false); const g = new THREE.Group(); g.position.set(sx * R * 0.36, R * 1.27, R * 0.84); g.rotation.x = -0.35; g.add(b); J.head.add(g); return g; };
    const browL = mkBrow(1), browR = mkBrow(-1);
    const mouthG = new THREE.Group(); mouthG.position.set(0, R * 0.56, R * 0.925); mouthG.rotation.x = 0.42; J.head.add(mouthG);
    const mouthM = mat('#5b1a1a', { rough: 0.5 });
    const mouthOpen = mesh(sphere(R * 0.16, 14, 10), mouthM, false); mouthOpen.scale.set(1, 0.6, 0.35); mouthG.add(mouthOpen);
    const arc = (flip: boolean) => { const m = mesh(geo(`arc${r3(R)}`, () => new THREE.TorusGeometry(R * 0.17, R * 0.045, 6, 16, Math.PI)), mouthM, false); m.rotation.z = flip ? Math.PI : 0; m.position.y = flip ? R * 0.1 : -R * 0.1; m.scale.y = 0.85; mouthG.add(m); return m; };
    const smile = arc(true), frown = arc(false);
    const line = mesh(rbox(R * 0.28, R * 0.06, R * 0.06, R * 0.025), mouthM, false); mouthG.add(line);
    const grin = mesh(geo(`grin${r3(R)}`, () => { const s = new THREE.Shape(); s.absarc(0, 0, R * 0.17, Math.PI, 0, true); s.lineTo(-R * 0.17, 0); return new THREE.ExtrudeGeometry(s, { depth: R * 0.03, bevelEnabled: false }); }), mouthM, false); grin.position.y = R * 0.04; mouthG.add(grin);
    const tearM = mat('#7fc8ff', { rough: 0.1, emissive: '#3b8fd0', ei: 0.3 });
    const tears = [-1, 1].map((sx) => { const t = mesh(capsule(R * 0.035, R * 0.25), tearM, false); t.position.set(sx * R * 0.4, R * 0.7, R * 0.88); J.head.add(t); return t; });
    const blushM = new THREE.MeshBasicMaterial({ color: '#ff6f7d', transparent: true, opacity: 0.0, depthWrite: false });
    const blush = [-1, 1].map((sx) => { const b = new THREE.Mesh(sphere(R * 0.14, 10, 8), blushM); b.scale.set(1, 0.6, 0.3); b.position.set(sx * R * 0.55, R * 0.72, R * 0.8); J.head.add(b); return b; });
    this.face = { eyes, browL, browR, mouthOpen, smile, frown, line, grin, tears, blush };

    // hair
    this.buildHair(look, R, hairM);
    this.buildAccessory(look, R);

    // arms
    const armM = look.outfit === 'jersey' || look.outfit === 'diaper' ? skin : shirt;
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? 1 : -1;
      const sh = J[`sh${side}`]; sh.position.set(sx * (SW + d.armR * 0.6), T * 0.88, 0); J.spine.add(sh);
      const upper = mesh(capsule(d.armR * (toddler ? 1.15 : 1.05), d.up - d.armR), armM); upper.position.y = -d.up / 2; sh.add(upper);
      const el = J[`el${side}`]; el.position.y = -d.up; sh.add(el);
      const fore = mesh(capsule(d.armR * 0.95, d.fore - d.armR), skin); fore.position.y = -d.fore / 2; el.add(fore);
      const hand = mesh(sphere(d.armR * 1.45, 12, 10), skin); hand.position.y = -d.fore - d.armR * 0.4; hand.scale.set(0.9, 1.1, 0.8); el.add(hand);
      const anchor = side === 'L' ? this.handL : this.handR; anchor.position.y = -d.fore - d.armR * 0.9; el.add(anchor);
      if (look.outfit === 'suit' || look.outfit === 'lab' || look.outfit === 'robe') { const cuff = mesh(capsule(d.armR * 1.1, d.fore * 0.6), shirt); cuff.position.y = -d.fore * 0.35; el.add(cuff); }
    }
    // legs
    const legM = look.outfit === 'diaper' || look.outfit === 'onesie' || look.outfit === 'jersey' ? skin : pants;
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? 1 : -1;
      const hp = J[`hip${side}`]; hp.position.set(sx * HW, 0, 0); J.hips.add(hp);
      const th = mesh(capsule(d.legR * 1.05, d.thigh - d.legR), legM); th.position.y = -d.thigh / 2; hp.add(th);
      if (look.outfit === 'jersey') { const shorts = mesh(capsule(d.legR * 1.45, d.thigh * 0.45), pants); shorts.position.y = -d.thigh * 0.25; hp.add(shorts); }
      const kn = J[`kn${side}`]; kn.position.y = -d.thigh; hp.add(kn);
      const sn = mesh(capsule(d.legR * 0.9, d.shin - d.legR), legM); sn.position.y = -d.shin / 2; kn.add(sn);
      if (look.outfit === 'jersey') { const sock = mesh(capsule(d.legR * 0.95, d.shin * 0.3), mat('#f2f2f2')); sock.position.y = -d.shin * 0.8; kn.add(sock); }
      const an = J[`an${side}`]; an.position.y = -d.shin; kn.add(an);
      const foot = mesh(rbox(d.legR * 2.1, d.footH * 1.15, d.legR * (toddler ? 3.4 : 3.9), d.footH * 0.5), toddler && look.shoes === look.skin ? skin : shoes);
      foot.position.set(0, -d.footH * 0.45, d.legR * 0.9); an.add(foot);
    }
    // tag dynamic face parts so they are not merged
    const dyn = new Set<THREE.Object3D>([...eyes, browL, browR, mouthG, ...tears, ...blush]);
    for (const o of dyn) o.traverse((c) => (c.userData.dynamic = true));
    this.faceDetail = [...eyes, browL, browR, mouthG, nose];
    this.mergeStatic();
    this.root.traverse((o) => { (o as any).userData.actor = true; });
  }

  faceDetail: THREE.Object3D[] = [];
  /** Merge static meshes under each joint into a single vertex-coloured mesh (far fewer draw calls). */
  private mergeStatic() {
    const vcMat = getVertexColorMaterial();
    for (const n of JOINTS) {
      const J = this.j[n];
      const parts = J.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh && !c.userData.dynamic && !((c as THREE.Mesh).material as any).map && !((c as THREE.Mesh).material as any).transparent);
      if (parts.length < 2) continue;
      const geos: THREE.BufferGeometry[] = [];
      for (const m of parts) {
        m.updateMatrix();
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(m.matrix);
        const col = ((m.material as THREE.MeshStandardMaterial).color ?? new THREE.Color('#fff')).clone();
        const c = new Float32Array(g.attributes.position.count * 3);
        for (let i = 0; i < c.length; i += 3) { c[i] = col.r; c[i + 1] = col.g; c[i + 2] = col.b; }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
        geos.push(g);
      }
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      for (const m of parts) J.remove(m);
      const mm = new THREE.Mesh(merged, vcMat); mm.castShadow = true; J.add(mm);
    }
  }

  setShadow(cast: boolean) { this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = cast && !o.userData.dynamic; }); }
  setDetail(on: boolean) { for (const o of this.faceDetail) o.visible = on; }

  private buildHair(look: PuppetLook, R: number, m: THREE.Material) {
    const J = this.j;
    const add = (o: THREE.Object3D) => { J.head.add(o); return o; };
    switch (look.hair) {
      case 'buzz': {
        const cap = mesh(geo(`hbuzz${r3(R)}`, () => new THREE.SphereGeometry(R * 1.012, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.36)), m, false);
        cap.position.y = R * 0.93; cap.rotation.x = -0.22; cap.scale.set(1, 1.02, 0.96); add(cap); break;
      }
      case 'short': {
        const cap = mesh(geo(`hshort${r3(R)}`, () => new THREE.SphereGeometry(R * 1.03, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.4)), m, false);
        cap.position.y = R * 0.94; cap.rotation.x = -0.3; cap.scale.set(1, 1.02, 0.97); add(cap);
        const fringe = mesh(rbox(R * 1.2, R * 0.22, R * 0.3, R * 0.1), m, false); fringe.position.set(0, R * 1.62, R * 0.7); fringe.rotation.x = -0.5; add(fringe); break;
      }
      case 'flat': {
        const top = mesh(rbox(R * 1.95, R * 0.5, R * 1.9, R * 0.15), m); top.position.y = R * 1.75; add(top); break;
      }
      case 'tuft': {
        const tuft = mesh(geo(`tuft${r3(R)}`, () => new THREE.ConeGeometry(R * 0.16, R * 0.5, 8)), m, false);
        tuft.position.set(0, R * 1.98, R * 0.1); tuft.rotation.x = 0.5; add(tuft);
        const t2 = tuft.clone(); t2.position.set(R * 0.12, R * 1.95, R * 0.0); t2.rotation.set(0.3, 0, -0.6); add(t2); break;
      }
      case 'curly': {
        for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; const b = mesh(sphere(R * 0.32, 10, 8), m, false); b.position.set(Math.cos(a) * R * 0.62, R * 1.62 + Math.sin(i * 2.1) * R * 0.08, Math.sin(a) * R * 0.62 - R * 0.08); add(b); }
        const top = mesh(sphere(R * 0.45, 12, 10), m, false); top.position.set(0, R * 1.8, -R * 0.05); add(top); break;
      }
      case 'bun': {
        const cap = mesh(geo(`hcap${r3(R)}`, () => new THREE.SphereGeometry(R * 1.04, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.42)), m, false); cap.position.y = R * 0.95; cap.rotation.x = -0.35; add(cap);
        const bun = mesh(sphere(R * 0.38), m, false); bun.position.set(0, R * 1.9, -R * 0.45); add(bun); break;
      }
      case 'spiky': {
        for (let i = 0; i < 7; i++) { const s = mesh(geo(`spk${r3(R)}`, () => new THREE.ConeGeometry(R * 0.2, R * 0.6, 6)), m, false); const a = (i / 7) * Math.PI * 2; s.position.set(Math.cos(a) * R * 0.4, R * 1.75, Math.sin(a) * R * 0.4); s.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); add(s); } break;
      }
      case 'long': {
        const cap = mesh(geo(`hcap${r3(R)}`, () => new THREE.SphereGeometry(R * 1.04, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.42)), m, false); cap.position.y = R * 0.95; cap.rotation.x = -0.35; add(cap);
        const back = mesh(rbox(R * 1.9, R * 1.6, R * 0.4, R * 0.18), m); back.position.set(0, R * 0.55, -R * 0.75); add(back); break;
      }
      case 'bald': default: break;
    }
  }

  private buildAccessory(look: PuppetLook, R: number) {
    const J = this.j; const c = look.accessoryColor ?? '#e63946';
    switch (look.accessory) {
      case 'headband': { const b = mesh(geo(`hb${r3(R)}`, () => new THREE.TorusGeometry(R * 0.955, R * 0.075, 6, 28)), mat(c), false); b.scale.set(1, 0.97, 1); b.rotation.x = Math.PI / 2 - 0.22; b.position.y = R * 1.3; J.head.add(b); break; }
      case 'bow': { for (const sx of [-1, 1]) { const w = mesh(geo(`bow${r3(R)}`, () => new THREE.ConeGeometry(R * 0.2, R * 0.35, 8)), mat(c), false); w.rotation.z = sx * Math.PI / 2; w.position.set(R * 0.55 + sx * R * 0.17, R * 1.72, 0); J.head.add(w); } const k = mesh(sphere(R * 0.09), mat(c), false); k.position.set(R * 0.55, R * 1.72, 0); J.head.add(k); break; }
      case 'cap': { const top = mesh(geo(`ctop${r3(R)}`, () => new THREE.SphereGeometry(R * 1.06, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45)), mat(c), false); top.position.y = R * 1.0; J.head.add(top); const brim = mesh(rbox(R * 1.3, R * 0.06, R * 0.8, R * 0.03), mat(c), false); brim.position.set(0, R * 1.38, R * 0.95); brim.rotation.x = -0.12; J.head.add(brim); break; }
      case 'glasses': { const gm = mat('#1a1a1a', { rough: 0.3 }); for (const sx of [-1, 1]) { const ring = mesh(geo(`gl${r3(R)}`, () => new THREE.TorusGeometry(R * 0.2, R * 0.03, 6, 16)), gm, false); ring.position.set(sx * R * 0.36, R * 0.98, R * 0.98); J.head.add(ring); } break; }
      case 'pacifier': { const p = mesh(geo(`pac${r3(R)}`, () => new THREE.CylinderGeometry(R * 0.2, R * 0.2, R * 0.06, 14)), mat(c), false); p.rotation.x = Math.PI / 2 - 0.45; p.position.set(0, R * 0.52, R * 0.98); J.head.add(p); const ring = mesh(geo(`pacr${r3(R)}`, () => new THREE.TorusGeometry(R * 0.11, R * 0.025, 6, 12)), mat(c), false); ring.position.set(0, R * 0.47, R * 1.06); ring.rotation.x = -0.4; J.head.add(ring); break; }
      case 'whistle': { const w = mesh(sphere(R * 0.12), mat('#c0c0c0', { metal: 0.8, rough: 0.3 }), false); w.position.set(0, this.dims.T * 0.75, this.dims.SW * 0.62); J.spine.add(w); break; }
    }
  }

  applyPose(p: Pose) {
    const J = this.j;
    for (const n of JOINTS) { const r = p[n]; J[n].rotation.set(r[0], r[1], r[2]); }
    J.hips.position.set(p.side, this.hipsBaseY + p.lift, p.fwd);
  }

  private blinkSeed = Math.random();
  applyFace(f: Face, t: number, seed: number) {
    const F = this.face; const R = this.dims.R;
    // blink every ~3.5s (deterministic per actor)
    const period = 2.8 + (seed % 7) * 0.35; const ph = ((t + seed * 0.37) % period) / period;
    const blink = ph > 0.965 ? 0.1 : 1;
    for (const e of F.eyes) { e.scale.set(f.eyeScale, f.eyeScale * (1 - f.eyeSquint * 0.75) * blink, f.eyeScale); }
    F.browL.rotation.z = f.browAngle * 0.6; F.browR.rotation.z = -f.browAngle * 0.6;
    F.browL.position.y = F.browR.position.y = R * (1.27 + f.browRaise * 0.14);
    F.browL.position.x = R * 0.36 - f.browAngle * R * 0.03; F.browR.position.x = -F.browL.position.x;
    F.mouthOpen.visible = f.mouth === 'open';
    F.mouthOpen.scale.set(1 - f.open * 0.25, 0.25 + f.open * 1.0, 0.35);
    F.smile.visible = f.mouth === 'smile'; F.frown.visible = f.mouth === 'frown'; F.line.visible = f.mouth === 'line'; F.grin.visible = f.mouth === 'grin';
    for (const tr of F.tears) { tr.visible = f.tears > 0.05; const k = (t * 1.6 + (tr.position.x > 0 ? 0.5 : 0)) % 1; tr.position.y = R * (0.75 - k * 0.45); tr.scale.setScalar(0.6 + 0.4 * (1 - k)); }
    for (const b of F.blush) { (b.material as THREE.MeshBasicMaterial).opacity = f.blush * 0.55; b.visible = f.blush > 0.02; }
  }
}

export function shade(hex: string, amt: number) {
  const c = new THREE.Color(hex); const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl); c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt))); return '#' + c.getHexString();
}
