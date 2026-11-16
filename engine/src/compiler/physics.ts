// Physics bakes with Rapier (deterministic build). Simulations run once at
// compile time with a fixed timestep and seed; the renderer samples the stored
// transforms. These outcomes are *simulated*, as opposed to scripted events.
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import type { PhysicsBake, Vec3 } from '../shared/types';
import { SETS } from '../shared/sets';

let ready: Promise<void> | null = null;
export function initPhysics() { if (!ready) ready = RAPIER.init(); return ready; }

export interface BodyInit {
  id: string;
  shape: 'ball' | 'box' | 'capsule';
  size: Vec3; // ball [r] | box half extents | capsule [halfHeight, radius]
  pos: Vec3;
  quat?: [number, number, number, number];
  linvel?: Vec3;
  angvel?: Vec3;
  restitution?: number;
  friction?: number;
  density?: number;
  linearDamping?: number;
  angularDamping?: number;
  removeAt?: number; // absolute time: body is removed (pulverized) and hidden from then on
}

export interface BakeRequest {
  id: string;
  set: string;
  t0: number;
  dur: number;
  gravity?: number;
  bodies: BodyInit[];
  obstacles?: { shape: 'box' | 'capsule' | 'ball'; size: Vec3; pos: Vec3; name?: string }[];
  seed: number;
  sampleHz?: number;
}

export function bake(req: BakeRequest): PhysicsBake {
  const world = new RAPIER.World({ x: 0, y: -(req.gravity ?? 9.81), z: 0 });
  world.timestep = 1 / 240;
  const names = new Map<number, string>();
  const setDef = SETS[req.set];
  for (const c of setDef?.colliders ?? []) {
    if (c.kind === 'box') {
      const col = world.createCollider(RAPIER.ColliderDesc.cuboid(c.size[0], c.size[1], c.size[2]).setTranslation(...c.pos).setRestitution(c.restitution ?? 0.4).setFriction(c.friction ?? 0.6));
      names.set(col.handle, c.name ?? 'static');
    } else if (c.kind === 'torus') {
      const R = c.size[0], r = Math.max(0.015, c.size[1]);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const col = world.createCollider(RAPIER.ColliderDesc.ball(r).setTranslation(c.pos[0] + Math.cos(a) * R, c.pos[1], c.pos[2] + Math.sin(a) * R).setRestitution(c.restitution ?? 0.5));
        names.set(col.handle, c.name ?? 'rim');
      }
    } else {
      const col = world.createCollider(RAPIER.ColliderDesc.ball(c.size[0]).setTranslation(...c.pos).setRestitution(c.restitution ?? 0.4));
      names.set(col.handle, c.name ?? 'static');
    }
  }
  for (const o of req.obstacles ?? []) {
    const d = o.shape === 'box' ? RAPIER.ColliderDesc.cuboid(o.size[0], o.size[1], o.size[2]) : o.shape === 'capsule' ? RAPIER.ColliderDesc.capsule(o.size[0], o.size[1]) : RAPIER.ColliderDesc.ball(o.size[0]);
    const col = world.createCollider(d.setTranslation(...o.pos).setRestitution(0.3).setFriction(0.8));
    names.set(col.handle, o.name ?? 'obstacle');
  }
  const bodies = req.bodies.map((b) => {
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(...b.pos).setCcdEnabled(true)
      .setLinearDamping(b.linearDamping ?? 0.05).setAngularDamping(b.angularDamping ?? 0.3);
    if (b.quat) desc.setRotation({ x: b.quat[0], y: b.quat[1], z: b.quat[2], w: b.quat[3] });
    if (b.linvel) desc.setLinvel(...b.linvel);
    if (b.angvel) desc.setAngvel({ x: b.angvel[0], y: b.angvel[1], z: b.angvel[2] });
    const body = world.createRigidBody(desc);
    const cd = b.shape === 'ball' ? RAPIER.ColliderDesc.ball(b.size[0]) : b.shape === 'box' ? RAPIER.ColliderDesc.cuboid(b.size[0], b.size[1], b.size[2]) : RAPIER.ColliderDesc.capsule(b.size[0], b.size[1]);
    cd.setRestitution(b.restitution ?? 0.3).setFriction(b.friction ?? 0.7).setDensity(b.density ?? 1).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    if (b.shape === 'ball') cd.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    const col = world.createCollider(cd, body);
    names.set(col.handle, b.id);
    return body;
  });
  const hz = req.sampleHz ?? 60;
  const frames = Math.ceil(req.dur * hz) + 1;
  const data: number[] = [];
  const contacts: PhysicsBake['contacts'] = [];
  const eq = new RAPIER.EventQueue(true);
  const sub = Math.round(240 / hz);
  const lastContact = new Map<string, number>();
  const removed = new Set<number>();
  const push = () => { bodies.forEach((b, i) => { if (removed.has(i)) { data.push(0, -100, 0, 0, 0, 0, 1); return; } const p = b.translation(), q = b.rotation(); data.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w); }); };
  push();
  for (let f = 1; f < frames; f++) {
    for (let s = 0; s < sub; s++) {
      const tStep = req.t0 + (f - 1) / hz + s / 240;
      req.bodies.forEach((bd, i) => { if (bd.removeAt !== undefined && !removed.has(i) && tStep >= bd.removeAt) { world.removeRigidBody(bodies[i]); removed.add(i); } });
      world.step(eq);
      const tNow = req.t0 + (f - 1) / hz + (s + 1) / 240;
      eq.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const a = names.get(h1) ?? '?', b = names.get(h2) ?? '?';
        const key = [a, b].sort().join('|');
        if (tNow - (lastContact.get(key) ?? -9) < 0.08) return;
        lastContact.set(key, tNow);
        // impact strength from the faster body involved
        let sp = 0; for (const [i, bd] of bodies.entries()) if (req.bodies[i].id === a || req.bodies[i].id === b) { const v = bd.linvel(); sp = Math.max(sp, Math.hypot(v.x, v.y, v.z)); }
        contacts.push({ t: tNow, a, b, impulse: sp });
      });
    }
    push();
  }
  world.free();
  return { id: req.id, t0: req.t0, dt: 1 / hz, frames, bodies: req.bodies.map((b) => ({ id: b.id, shape: b.shape, size: b.size })), data, contacts, seed: req.seed, simulated: true };
}

/** Final transform of a body in a bake. */
export function bakeFinal(b: PhysicsBake, body: number) {
  const nb = b.bodies.length; const o = ((b.frames - 1) * nb + body) * 7; const D = b.data;
  return { pos: [D[o], D[o + 1], D[o + 2]] as Vec3, quat: [D[o + 3], D[o + 4], D[o + 5], D[o + 6]] as [number, number, number, number] };
}
export function bakeAt(b: PhysicsBake, body: number, t: number) {
  const nb = b.bodies.length; const f = Math.max(0, Math.min(b.frames - 1, Math.round((t - b.t0) / b.dt))); const o = (f * nb + body) * 7; const D = b.data;
  return { pos: [D[o], D[o + 1], D[o + 2]] as Vec3, quat: [D[o + 3], D[o + 4], D[o + 5], D[o + 6]] as [number, number, number, number] };
}
