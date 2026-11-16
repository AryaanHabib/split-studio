// Browser entry point. Exposes window.studio for the headless renderer and the
// website's live shot preview. Every frame is a pure function of video time.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CompiledVideo, CompiledScene, CompiledShot, CompiledProp } from '../shared/types';
import { buildSet, type BuiltSet } from './sets';
import { ActorRuntime } from './actors';
import { buildProp } from './props';
import { evalCamera, type CamCtx } from './camera';
import { drawOverlays, drawGrade } from './overlay';
import { SETS } from '../shared/sets';

interface SceneRT {
  def: CompiledScene;
  scene: THREE.Scene;
  set: BuiltSet;
  actors: Map<string, ActorRuntime>;
  props: Map<string, { def: CompiledProp; obj: THREE.Object3D }>;
}

let video: CompiledVideo;
let renderer: THREE.WebGLRenderer;
let camera: THREE.PerspectiveCamera;
let comp: HTMLCanvasElement, g2: CanvasRenderingContext2D;
const scenes = new Map<string, SceneRT>();
let assetBase = '';

async function loadFonts() {
  const faces = [['Inter', 'Inter-SemiBold.otf', '600'], ['Inter', 'Inter-Bold.otf', '700'], ['Inter', 'Inter-ExtraBold.otf', '800'], ['Inter', 'Inter-Black.otf', '900']];
  for (const [fam, file, weight] of faces) {
    const f = new FontFace(fam, `url(${assetBase}/fonts/${file})`, { weight });
    await f.load(); (document as any).fonts.add(f);
  }
}

const gltfCache = new Map<string, any>();
async function loadGltf(path: string) {
  if (!gltfCache.has(path)) gltfCache.set(path, await new GLTFLoader().loadAsync(`${assetBase}/${path}`));
  const g = gltfCache.get(path);
  if (g.userData.h === undefined) { const b = new THREE.Box3().setFromObject(g.scene); g.userData.h = b.max.y - b.min.y; }
  return { scene: SkeletonUtils.clone(g.scene), animations: g.animations, height: g.userData.h as number };
}

async function buildScene(def: CompiledScene): Promise<SceneRT> {
  const scene = new THREE.Scene();
  const set = buildSet(def.set.preset, def.set.params ?? {}, video.seed);
  scene.add(set.group); scene.background = set.background;
  if (def.fog) scene.fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);
  const actors = new Map<string, ActorRuntime>();
  for (const a of def.actors) {
    const rt = new ActorRuntime(a, def.bakes, a.kind === 'gltf' ? await loadGltf(a.model!) : undefined);
    actors.set(a.id, rt); scene.add(rt.obj);
    if (a.shadow === 'blob' && rt.puppet) {
      rt.puppet.setShadow(false);
      const blob = new THREE.Mesh(blobGeo, blobMat); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.012; blob.scale.setScalar(rt.height * 0.42); blob.renderOrder = 1;
      scene.add(blob); rt.blob = blob;
    }
  }
  const props = new Map<string, { def: CompiledProp; obj: THREE.Object3D }>();
  for (const p of def.props) { const obj = buildProp(p.kind, p.params); scene.add(obj); props.set(p.id, { def: p, obj }); }
  applyMaterialStyle(scene, video.grade?.materials);
  if (!scene.fog && video.grade?.fog) scene.fog = new THREE.Fog(video.grade.fog.color, video.grade.fog.near, video.grade.fog.far);
  return { def, scene, set, actors, props };
}

const toonRamp = (() => { const d = new Uint8Array([60, 140, 255]); const t = new THREE.DataTexture(d, 3, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
function applyMaterialStyle(scene: THREE.Scene, mode?: string) {
  if (!mode || mode === 'standard') return;
  const cache = new Map<THREE.Material, THREE.Material>();
  scene.traverse((o: any) => {
    if (!o.isMesh || !o.material || o.isInstancedMesh) return;
    const conv = (m: any) => {
      if (!m.isMeshStandardMaterial) return m;
      if (!cache.has(m)) cache.set(m, mode === 'toon' ? new THREE.MeshToonMaterial({ color: m.color, vertexColors: m.vertexColors, map: m.map, gradientMap: toonRamp, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity, transparent: m.transparent, opacity: m.opacity }) : new THREE.MeshBasicMaterial({ color: m.color, vertexColors: m.vertexColors, map: m.map, transparent: m.transparent, opacity: m.opacity }));
      return cache.get(m)!;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}

const blobGeo = new THREE.CircleGeometry(1, 20);
const blobMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.32, depthWrite: false });

function makeResolvers(s: SceneRT) {
  const actorOf = (id: string) => s.actors.get(id);
  const anchors = SETS[s.def.set.preset]?.anchors ?? {};
  const approx = (target: any, t: number): THREE.Vector3 => {
    if (Array.isArray(target)) return target.length === 2 ? new THREE.Vector3(target[0], 0, target[1]) : new THREE.Vector3(target[0], target[1], target[2]);
    if (target && typeof target === 'object') { const b = approx(target.target, t); if (target.offset) b.add(new THREE.Vector3(...target.offset)); return b; }
    const [id, part] = String(target).split('.');
    const a = s.actors.get(id);
    if (a) { const r = a.rootAt(t, actorOf); const f = part === 'head' ? 0.9 : part === 'feet' ? 0.02 : part === 'headTop' ? 1 : 0.55; return r.pos.clone().add(new THREE.Vector3(0, a.height * f, 0)); }
    const grp = s.def.groups[id];
    if (grp) {
      const c = new THREE.Vector3(); let n = 0;
      for (const m of grp) { const ma = s.actors.get(m); if (!ma || ma.isHidden(t)) continue; c.add(ma.rootAt(t, actorOf).pos); n++; }
      if (n) c.multiplyScalar(1 / n); c.y += 0.45; return c;
    }
    const pr = s.props.get(id); if (pr) return propPos(s, pr.def, t);
    const an = anchors[id]; if (an) return new THREE.Vector3(...an);
    return new THREE.Vector3();
  };
  const precise = (target: any, t: number): THREE.Vector3 => {
    if (typeof target === 'string') {
      const [id, part] = target.split('.');
      const a = s.actors.get(id);
      if (a) return a.part(part ?? 'chest');
      const pr = s.props.get(id); if (pr) return pr.obj.position.clone();
    }
    return approx(target, t);
  };
  const heading = (target: any, t: number) => { const a = s.actors.get(String(target).split('.')[0]); return a ? a.rootAt(t, actorOf).h : 0; };
  // yaw of the head's forward direction (after look-at turns); null if the face points up/down (lying)
  const faceYaw = (target: any) => {
    const a = s.actors.get(String(target).split('.')[0]); if (!a?.puppet) return null;
    const hd = a.puppet.j.head; hd.updateWorldMatrix(true, false);
    const f = new THREE.Vector3(0, 0, 1).transformDirection(hd.matrixWorld);
    return Math.hypot(f.x, f.z) > 0.55 ? Math.atan2(f.x, f.z) : null;
  };
  const heightOf = (target: any) => s.actors.get(String(target).split('.')[0])?.height ?? 1.7;
  return { actorOf, approx, precise, heading, heightOf, faceYaw };
}

function sampleArr(arr: number[], t0: number, dt: number, t: number, stride: number, off: number) {
  const n = arr.length / stride; const f = Math.max(0, Math.min(n - 1, (t - t0) / dt)); const i = Math.floor(f), j = Math.min(n - 1, i + 1), w = f - i;
  return [0, 1, 2].map((k) => arr[i * stride + off + k] * (1 - w) + arr[j * stride + off + k] * w);
}

function propPos(s: SceneRT, def: CompiledProp, t: number): THREE.Vector3 {
  let seg = def.segs.find((g) => t >= g.t0 && t < g.t1);
  let tt = t;
  if (!seg) { let last; for (const g of def.segs) if (g.t1 <= t && (!last || g.t1 > last.t1)) last = g; if (last) { seg = last; tt = last.t1 - 1e-4; } }
  if (!seg) return new THREE.Vector3(...def.rest);
  const actorOf = (id: string) => s.actors.get(id);
  switch (seg.mode) {
    case 'path': { const P = s.def.paths[seg.path!]; const v = sampleArr(P.pos, P.t0, P.dt, tt, 3, 0); return new THREE.Vector3(v[0], v[1], v[2]); }
    case 'bake': {
      const b = s.def.bakes[seg.bake!]; const nb = b.bodies.length; const f = Math.max(0, Math.min(b.frames - 1, (tt - b.t0) / b.dt)); const i = Math.floor(f), j = Math.min(b.frames - 1, i + 1), w = f - i;
      const o0 = (i * nb + seg.body!) * 7, o1 = (j * nb + seg.body!) * 7; const D = b.data;
      return new THREE.Vector3(D[o0] + (D[o1] - D[o0]) * w, D[o0 + 1] + (D[o1 + 1] - D[o0 + 1]) * w, D[o0 + 2] + (D[o1 + 2] - D[o0 + 2]) * w);
    }
    case 'attach': case 'dribble': {
      const a = actorOf(seg.actor!); if (!a) return new THREE.Vector3(...def.rest);
      const r = def.params.radius ?? 0.12;
      const root = a.rootAt(tt, actorOf);
      const fwd = new THREE.Vector3(Math.sin(root.h), 0, Math.cos(root.h));
      let p: THREE.Vector3;
      if (seg.hand === 'both') {
        p = a.part('handL').add(a.part('handR')).multiplyScalar(0.5);
        const head = a.part('head');
        if (p.y > head.y) p.add(new THREE.Vector3(0, r * 1.15, 0)).addScaledVector(fwd, r * 0.2); // held overhead: rest on top of the hands
        else p.addScaledVector(fwd, r * 0.9);
      }
      else if (seg.hand === 'head') p = a.part('headTop').add(new THREE.Vector3(0, r, 0));
      else p = a.part(seg.hand === 'L' ? 'handL' : 'handR').addScaledVector(fwd, r * 0.4).add(new THREE.Vector3(0, -r * 0.6, 0));
      if (seg.mode === 'dribble') {
        const ph = (((tt - seg.t0) * (seg.freq ?? 2.2)) % 1 + 1) % 1;
        const k = (2 * ph - 1) ** 2; p.y = r + (p.y - r) * k; p.addScaledVector(fwd, 0.08 * (1 - k));
      }
      return p;
    }
    case 'hidden': return new THREE.Vector3(0, -50, 0);
  }
  return new THREE.Vector3(...def.rest);
}

/** Map video time inside a shot to scene time, honouring speed ramps. */
function sceneTimeFor(shot: CompiledShot, T: number) {
  const lt = T - shot.start;
  if (!shot.ramp?.length) return shot.sceneStart + lt * shot.speed;
  const speedAt = (x: number) => { let s = shot.speed; for (const r of shot.ramp!) { if (x >= r.at) { const k = Math.min(1, (x - r.at) / Math.max(1e-3, r.dur)); s = s + (r.speed - s) * k; } } return s; };
  let acc = 0; const step = 1 / 240;
  for (let x = 0; x < lt; x += step) acc += speedAt(x) * Math.min(step, lt - x);
  return shot.sceneStart + acc;
}

function shotAt(T: number) {
  for (const s of video.shots) if (T >= s.start && T < s.end) return s;
  return video.shots[video.shots.length - 1];
}

function renderAt(T: number, opts: { overlays?: boolean; frame?: number } = {}) {
  const shot = shotAt(T);
  const s = scenes.get(shot.scene)!;
  const t = sceneTimeFor(shot, Math.min(T, shot.end - 1e-6));
  const R = makeResolvers(s);
  // actors (attachments resolve recursively through rootAt)
  for (const a of s.actors.values()) a.update(t, R.actorOf, R.precise);
  for (const a of s.actors.values()) if (a.blob) { a.blob.visible = a.obj.visible; a.blob.position.x = a.obj.position.x; a.blob.position.z = a.obj.position.z; const hgt = Math.max(0, a.obj.position.y); a.blob.material = blobMat; a.blob.scale.setScalar(a.height * 0.42 * (1 + hgt * 0.3)); }
  for (const p of s.props.values()) {
    const pos = propPos(s, p.def, t); p.obj.position.copy(pos);
    const seg = p.def.segs.find((g) => t >= g.t0 && t < g.t1);
    if (seg?.mode === 'bake') {
      const b = s.def.bakes[seg.bake!]; const nb = b.bodies.length; const i = Math.max(0, Math.min(b.frames - 1, Math.round((t - b.t0) / b.dt))); const o = (i * nb + seg.body!) * 7;
      p.obj.quaternion.set(b.data[o + 3], b.data[o + 4], b.data[o + 5], b.data[o + 6]);
    } else if (seg?.mode === 'path') {
      const P = s.def.paths[seg.path!]; const sp = P.spin ?? [0, 0, 0]; const dt = t - P.t0; p.obj.rotation.set(sp[0] * dt, sp[1] * dt, sp[2] * dt);
    } else if (seg?.mode === 'dribble') p.obj.rotation.set((t - seg.t0) * 9, 0, 0);
  }
  s.set.update(t, s.def.events);
  // camera
  const ctx: CamCtx = { t, lt: T - shot.start, u: (T - shot.start) / Math.max(1e-3, shot.end - shot.start), dur: shot.end - shot.start, resolve: R.precise, approx: R.approx, heading: R.heading, heightOf: R.heightOf, faceYaw: R.faceYaw };
  const cam = evalCamera({ seed: shot.index, ...shot.camera }, ctx);
  camera.fov = cam.fov; camera.position.copy(cam.pos); camera.up.set(0, 1, 0); camera.lookAt(cam.look);
  if (cam.roll) camera.rotateZ(cam.roll);
  camera.updateProjectionMatrix();
  // level of detail: tiny face parts are invisible from far away
  for (const a of s.actors.values()) if (a.puppet) a.puppet.setDetail(a.obj.position.distanceTo(camera.position) < 9 + a.height * 3);
  // cinematographer's cheat: in close framings, hide bystanders blocking the eyeline
  const clearView = shot.camera.clearView ?? ['close', 'ots', 'pov', 'follow', 'track'].includes(shot.camera.type);
  const hiddenNow: THREE.Object3D[] = [];
  {
    const subj = String(shot.camera.target ?? shot.camera.to ?? '').split('.')[0];
    const keep = new Set([subj, String(shot.camera.from ?? '').split('.')[0], ...(shot.camera.keep ?? [])]);
    const A = cam.pos, B = cam.look; const AB = B.clone().sub(A); const L2 = AB.lengthSq();
    for (const a of s.actors.values()) {
      if (keep.has(a.def.id) || !a.obj.visible) continue;
      let hide = false;
      for (const f of [0.5, 0.9]) {
        const c = a.obj.position.clone(); c.y += a.height * f;
        const u = c.clone().sub(A).dot(AB) / L2;
        const nearLens = c.distanceTo(A) < a.height * 0.75 + (clearView ? 0.6 : 0.3);
        if (nearLens) { hide = true; break; }
        if (!clearView || u < 0 || u > 0.9) continue;
        const d = A.clone().addScaledVector(AB, u).distanceTo(c);
        if (d < Math.max(0.35, a.height * 0.42)) { hide = true; break; }
      }
      if (hide) { a.obj.visible = false; hiddenNow.push(a.obj); }
    }
  }
  renderer.render(s.scene, camera);
  for (const o of hiddenNow) o.visible = true;
  // composite
  const W = comp.width, H = comp.height;
  const st = video.grade ?? {};
  g2.filter = (st.saturate !== undefined && st.saturate !== 1) || (st.contrast !== undefined && st.contrast !== 1) || st.brightness ? `saturate(${st.saturate ?? 1}) contrast(${st.contrast ?? 1}) brightness(${st.brightness ?? 1})` : 'none';
  g2.drawImage(renderer.domElement, 0, 0, W, H);
  g2.filter = 'none';
  if (st.letterbox) { const h = H * st.letterbox; g2.fillStyle = '#000'; g2.fillRect(0, 0, W, h); g2.fillRect(0, H - h, W, h); }
  drawGrade(g2, W, H, { ...(video.grade ?? {}), frame: opts.frame ?? 0 });
  if (opts.overlays !== false) {
    const project = (target: any) => {
      const p = R.precise(target, t).project(camera);
      return { x: (p.x * 0.5 + 0.5) * W, y: (1 - (p.y * 0.5 + 0.5)) * H, visible: p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 };
    };
    drawOverlays(g2, W, H, T, video.overlays, project);
  }
  return { shot: shot.id, sceneTime: t };
}

(window as any).studio = {
  async load(v: CompiledVideo, base: string, scale = 1) {
    video = v; assetBase = base;
    await loadFonts();
    const W = Math.round(v.width * scale), H = Math.round(v.height * scale);
    const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
    renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = v.grade?.exposure ?? 1.0;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    camera = new THREE.PerspectiveCamera(50, W / H, 0.05, 200);
    comp = document.createElement('canvas'); comp.width = W; comp.height = H; g2 = comp.getContext('2d')!;
    document.body.appendChild(comp);
    for (const sc of v.scenes) scenes.set(sc.id, await buildScene(sc));
    return { width: W, height: H, frames: Math.round(v.duration * v.fps), renderer: renderer.getContext().getParameter(renderer.getContext().VERSION) };
  },
  profile(i: number) {
    const t0 = performance.now(); renderAt(i / video.fps, { frame: i }); const gl = renderer.getContext(); const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t1 = performance.now(); const d = comp.toDataURL('image/jpeg', 0.92); const t2 = performance.now();
    renderer.shadowMap.enabled = false; renderer.shadowMap.needsUpdate = true; s0(); renderAt(i / video.fps, { frame: i }); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t3 = performance.now(); renderer.shadowMap.enabled = true;
    function s0() { scenes.forEach((sc) => sc.scene.traverse((o: any) => { if (o.material) o.material.needsUpdate = true; })); }
    s0(); return { render: t1 - t0, encode: t2 - t1, noShadow: t3 - t2, bytes: d.length };
  },
  frame(i: number, quality = 0.92) {
    const info = renderAt(i / video.fps, { frame: i });
    return { data: comp.toDataURL('image/jpeg', quality), ...info };
  },
  debug(T: number) {
    const info = renderAt(T, { overlays: false });
    const s = scenes.get(shotAt(T).scene)!;
    return { ...info, camera: camera.position.toArray(), fov: camera.fov, actors: [...s.actors.values()].filter((a) => !a.def.id.includes('_')).map((a) => ({ id: a.def.id, pos: a.obj.position.toArray(), visible: a.obj.visible, height: a.height })) };
  },
  draw(T: number) { return renderAt(T, { frame: Math.round(T * video.fps) }); },
  canvas() { return comp; },
  still(T: number, overlays = false) {
    renderAt(T, { overlays });
    return comp.toDataURL('image/png');
  },
};
