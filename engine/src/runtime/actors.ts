// Evaluates a compiled actor at an arbitrary scene time: root transform, pose layers, face, gltf clips.
import * as THREE from 'three';
import type { CompiledActor, RootKey, PoseSeg, PhysicsBake } from '../shared/types';
import { Puppet } from './puppet';
import { BASE, UPPER_CLIPS, FACES, UPPER, neutralPose, neutralFace, lerpPose, lerpFace, clamp, smooth, type Pose, type Face, type ClipCtx } from './pose';

export function evalRoot(keys: RootKey[], t: number): RootKey {
  if (!keys.length) return { t, x: 0, y: 0, z: 0, h: 0, d: 0 };
  if (t <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (t >= last.t) return last;
  let lo = 0, hi = keys.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (keys[m].t <= t) lo = m; else hi = m; }
  const a = keys[lo], b = keys[hi];
  const w = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  let dh = b.h - a.h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
  return { t, x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w, h: a.h + dh * w, d: a.d + (b.d - a.d) * w };
}

function activeSeg(segs: PoseSeg[], layer: string, t: number): { cur?: PoseSeg; prev?: PoseSeg } {
  let cur: PoseSeg | undefined, prev: PoseSeg | undefined;
  for (const s of segs) {
    if (s.layer !== layer) continue;
    if (s.t0 <= t && t < s.t1) { if (!cur || s.t0 >= cur.t0) { prev = cur ?? prev; cur = s; } }
    else if (s.t1 <= t && (!prev || s.t1 > prev.t1)) prev = s;
  }
  return { cur, prev };
}

export interface Resolver { (target: any, t: number): THREE.Vector3 | null }

const GLTF_DEFAULT_MAP: Record<string, string> = {
  idle: 'Idle', stand: 'Idle', walk: 'Walking', sneak: 'Walking', run: 'Running', sprint: 'Running', panicRun: 'Running', jump: 'Jump', hop: 'Jump',
  wave: 'Wave', celebrate: 'Dance', dance: 'Dance', shrug: 'No', no: 'No', yes: 'Yes', thumbsUp: 'ThumbsUp', fall: 'Death', lie: 'Death', sit: 'Sitting', getUp: 'Standing', punch: 'Punch', push: 'Punch', point: 'ThumbsUp', shock: 'Jump', talkGesture: 'Yes',
};

export class ActorRuntime {
  def: CompiledActor;
  obj: THREE.Object3D;
  puppet?: Puppet;
  height: number;
  private mixer?: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private morphMeshes: THREE.Mesh[] = [];
  bakes: Record<string, PhysicsBake>;
  lastRoot: RootKey = { t: 0, x: 0, y: 0, z: 0, h: 0, d: 0 };
  blob?: THREE.Mesh;

  constructor(def: CompiledActor, bakes: Record<string, PhysicsBake>, gltf?: { scene: THREE.Object3D; animations: THREE.AnimationClip[]; height?: number }) {
    this.def = def; this.bakes = bakes;
    if (def.kind === 'puppet') {
      this.puppet = new Puppet(def.look!);
      this.obj = this.puppet.root; this.height = def.look!.height;
    } else {
      const s = def.modelScale ?? 1;
      this.obj = new THREE.Group();
      const inner = gltf!.scene; inner.scale.setScalar(s); this.obj.add(inner);
      inner.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; const m = o as THREE.Mesh; if (m.morphTargetDictionary) this.morphMeshes.push(m); } });
      this.mixer = new THREE.AnimationMixer(inner);
      for (const clip of gltf!.animations) { const a = this.mixer.clipAction(clip); a.enabled = true; a.setEffectiveWeight(0); a.play(); this.actions[clip.name] = a; }
      this.height = (gltf!.height ?? 1.8) * s;
    }
  }

  isHidden(t: number) { return (this.def.hidden ?? []).some(([a, b]) => t >= a && t < b); }

  /** Root transform at time t (without pose). Used by cameras and attachments. */
  rootAt(t: number, resolveActor: (id: string) => ActorRuntime | undefined, depth = 0): { pos: THREE.Vector3; quat: THREE.Quaternion; h: number; k: RootKey } {
    const ph = this.def.physics.find((s) => t >= s.t0 && t < s.t1);
    if (ph) {
      const b = this.bakes[ph.bake];
      const f = clamp((t - b.t0) / b.dt, 0, b.frames - 1); const i0 = Math.floor(f), i1 = Math.min(b.frames - 1, i0 + 1), w = f - i0;
      const nb = b.bodies.length; const o0 = (i0 * nb + ph.body) * 7, o1 = (i1 * nb + ph.body) * 7; const D = b.data;
      const pos = new THREE.Vector3(D[o0] + (D[o1] - D[o0]) * w, D[o0 + 1] + (D[o1 + 1] - D[o0 + 1]) * w, D[o0 + 2] + (D[o1 + 2] - D[o0 + 2]) * w);
      const q0 = new THREE.Quaternion(D[o0 + 3], D[o0 + 4], D[o0 + 5], D[o0 + 6]); const q1 = new THREE.Quaternion(D[o1 + 3], D[o1 + 4], D[o1 + 5], D[o1 + 6]);
      const quat = q0.slerp(q1, w);
      pos.add(new THREE.Vector3(0, -this.height / 2, 0).applyQuaternion(quat));
      const k = evalRoot(this.def.root, t);
      return { pos, quat, h: k.h, k };
    }
    const at = this.def.attach.find((s) => t >= s.t0 && t < s.t1);
    if (at && depth < 4) {
      const tgt = resolveActor(at.target);
      if (tgt) {
        const tr = tgt.rootAt(t, resolveActor, depth + 1);
        const off = new THREE.Vector3(...at.offset).applyQuaternion(tr.quat);
        const pos = tr.pos.clone().add(off);
        const quat = tr.quat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), at.heading));
        const k = evalRoot(this.def.root, t);
        return { pos, quat, h: tr.h + at.heading, k };
      }
    }
    const k = evalRoot(this.def.root, t);
    return { pos: new THREE.Vector3(k.x, k.y, k.z), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), k.h), h: k.h, k };
  }

  update(t: number, resolveActor: (id: string) => ActorRuntime | undefined, resolve: Resolver) {
    const hidden = this.isHidden(t);
    this.obj.visible = !hidden;
    if (hidden) return;
    const r = this.rootAt(t, resolveActor);
    this.obj.position.copy(r.pos); this.obj.quaternion.copy(r.quat);
    this.lastRoot = r.k;
    const k0 = evalRoot(this.def.root, t - 0.05), k1 = evalRoot(this.def.root, t + 0.05);
    const speed = Math.hypot(k1.x - k0.x, k1.z - k0.z) / 0.1;
    const stride = this.height * 0.75;
    const phase = r.k.d / stride;
    const seed = this.def.seed;
    const ctxFor = (s: PoseSeg): ClipCtx => ({ t, lt: t - s.t0, dur: s.t1 - s.t0, u: clamp((t - s.t0) / Math.max(1e-3, s.t1 - s.t0)), phase, speed, p: s.p ?? {}, seed, height: this.height });

    if (this.puppet) {
      // ---- base layer
      const { cur, prev } = activeSeg(this.def.segs, 'base', t);
      const evalBase = (s?: PoseSeg) => { const p = neutralPose(); const fn = s ? BASE[s.clip] : BASE.idle; (fn ?? BASE.idle)(s ? ctxFor(s) : ({ t, lt: t, dur: 1, u: 0, phase, speed, p: {}, seed, height: this.height } as ClipCtx), p); return p; };
      let pose: Pose = evalBase(cur);
      const blend = cur?.blend ?? 0.18;
      if (cur && t - cur.t0 < blend) {
        const prevSeg = prev && prev.t1 >= cur.t0 - 0.05 ? prev : undefined;
        const pp = prevSeg ? evalBase({ ...prevSeg, t1: Math.max(prevSeg.t1, t + 0.01) }) : evalBase(undefined);
        pose = lerpPose(pp, pose, smooth((t - cur.t0) / blend));
      }
      // ---- upper layer
      const up = activeSeg(this.def.segs, 'upper', t).cur;
      if (up && UPPER_CLIPS[up.clip]) {
        const p2 = neutralPose(); UPPER_CLIPS[up.clip](ctxFor(up), p2);
        const w = smooth(Math.min((t - up.t0) / 0.15, (up.t1 - t) / 0.15, 1));
        pose = lerpPose(pose, p2, w, UPPER, false);
      }
      // ---- look-at layer
      const lk = activeSeg(this.def.segs, 'look', t).cur;
      if (lk) {
        const tp = resolve(lk.p?.target, t);
        if (tp) {
          const head = new THREE.Vector3(r.pos.x, r.pos.y + this.height * 0.92, r.pos.z);
          const d = tp.clone().sub(head);
          let yaw = Math.atan2(d.x, d.z) - r.h; while (yaw > Math.PI) yaw -= 2 * Math.PI; while (yaw < -Math.PI) yaw += 2 * Math.PI;
          const pitch = -Math.atan2(d.y, Math.hypot(d.x, d.z));
          const w = smooth(Math.min((t - lk.t0) / (lk.p?.snap ? 0.06 : 0.3), (lk.t1 - t) / 0.3, 1));
          const hy = clamp(yaw, -1.3, 1.3), sy = clamp(yaw - hy, -0.8, 0.8);
          pose.head[1] += hy * w * 0.85; pose.spine[1] += (sy + hy * 0.15) * w; pose.head[0] += clamp(pitch, -0.8, 0.9) * w * 0.9;
        }
      }
      this.puppet.applyPose(pose);
      // ---- face
      const fc = activeSeg(this.def.segs, 'face', t);
      const evalFace = (s?: PoseSeg) => { const f = neutralFace(); if (s) (FACES[s.clip] ?? FACES.neutral)(ctxFor(s), f); return f; };
      let face: Face = evalFace(fc.cur);
      if (fc.cur && t - fc.cur.t0 < 0.12) face = lerpFace(evalFace(fc.prev && fc.prev.t1 >= fc.cur.t0 - 0.05 ? fc.prev : undefined), face, (t - fc.cur.t0) / 0.12);
      // ---- mouth (speech)
      const mo = activeSeg(this.def.segs, 'mouth', t).cur;
      if (mo) {
        let open: number;
        const env = mo.p?.env as number[] | undefined;
        if (env && env.length) { const i = Math.floor((t - mo.t0) * 30); open = env[Math.max(0, Math.min(env.length - 1, i))]; }
        else { const x = (t - mo.t0) * 11; open = Math.abs(Math.sin(x)) * (0.5 + 0.5 * Math.abs(Math.sin(x * 0.37 + 1))); }
        if (face.mouth !== 'open') { face.mouth = 'open'; face.open = 0; }
        face.open = Math.max(face.open * 0.6, clamp(open * (mo.p?.gain ?? 1.0)));
      }
      this.puppet.applyFace(face, t, seed);
    } else if (this.mixer) {
      const { cur, prev } = activeSeg(this.def.segs, 'base', t);
      const map = { ...GLTF_DEFAULT_MAP, ...(this.def.clipMap ?? {}) };
      for (const a of Object.values(this.actions)) a.setEffectiveWeight(0);
      const setClip = (s: PoseSeg | undefined, w: number) => {
        const name = s ? map[s.clip] ?? 'Idle' : 'Idle'; const a = this.actions[name] ?? this.actions['Idle']; if (!a) return;
        const dur = a.getClip().duration; const lt = s ? t - s.t0 : t;
        const loop = !['Death', 'Jump', 'Sitting', 'Standing', 'ThumbsUp', 'Wave', 'No', 'Yes', 'Punch'].includes(name) || (s?.p?.loop ?? false);
        const gait = ['Walking', 'Running'].includes(name);
        a.time = gait ? (phase * dur) % dur : loop ? lt % dur : Math.min(lt * (s?.p?.rate ?? 1), dur - 0.001);
        a.setEffectiveWeight(a.getEffectiveWeight() + w);
      };
      const blend = 0.25;
      if (cur && prev && t - cur.t0 < blend && prev.t1 >= cur.t0 - 0.05) { const w = smooth((t - cur.t0) / blend); setClip(prev, 1 - w); setClip(cur, w); }
      else setClip(cur, 1);
      this.mixer.update(0);
      const fc = activeSeg(this.def.segs, 'face', t).cur; const fname = fc?.clip ?? 'neutral';
      for (const m of this.morphMeshes) {
        const dict = m.morphTargetDictionary!; const inf = m.morphTargetInfluences!;
        for (const key of Object.keys(dict)) inf[dict[key]] = 0;
        const set = (k: string, v: number) => { if (dict[k] !== undefined) inf[dict[k]] = v; };
        if (['angry', 'determined', 'smug'].includes(fname)) set('Angry', 1);
        if (['shock', 'scared', 'terrified', 'confused'].includes(fname)) set('Surprised', 1);
        if (['sad', 'cry', 'guilty', 'worried'].includes(fname)) set('Sad', 1);
      }
    }
  }

  /** World-space positions of useful body parts (after update). */
  part(name: string): THREE.Vector3 {
    const v = new THREE.Vector3();
    if (this.puppet) {
      const P = this.puppet;
      const o = name === 'head' ? P.headCenter : name === 'headTop' ? P.headTop : name === 'handL' ? P.handL : name === 'handR' ? P.handR : name === 'chest' ? P.j.chest : name === 'hips' ? P.j.hips : name === 'feet' ? P.root : P.j.chest;
      o.updateWorldMatrix(true, false); o.getWorldPosition(v);
      return v;
    }
    this.obj.updateWorldMatrix(true, true);
    this.obj.getWorldPosition(v);
    const f = name === 'head' ? 0.88 : name === 'headTop' ? 1.0 : name === 'feet' ? 0 : name.startsWith('hand') ? 0.5 : 0.6;
    v.y += this.height * f;
    return v;
  }
}
