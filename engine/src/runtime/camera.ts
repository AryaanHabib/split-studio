// Camera direction vocabulary. Each shot names a camera type + parameters; the
// camera is computed as a pure function of time so any frame can be rendered alone.
import * as THREE from 'three';
import type { CameraSpec } from '../shared/types';
import { noise1, smooth, clamp } from './pose';

export interface CamCtx {
  t: number; // scene time
  lt: number; // seconds since shot start (video)
  u: number; // 0..1 shot progress
  dur: number;
  resolve(target: any, t: number): THREE.Vector3; // precise (current pose)
  approx(target: any, t: number): THREE.Vector3; // root-based (cheap, any time)
  heading(target: any, t: number): number;
  faceYaw?(target: any): number | null;
  heightOf(target: any): number;
}

const D2R = Math.PI / 180;
const ease = (u: number, kind = 'inOut') => kind === 'linear' ? u : kind === 'in' ? u * u : kind === 'out' ? 1 - (1 - u) * (1 - u) : smooth(u);
const v3 = (a: any) => new THREE.Vector3(a[0], a[1], a[2]);

function smoothed(ctx: CamCtx, target: any, lag: number) {
  if (!lag) return ctx.approx(target, ctx.t);
  const acc = new THREE.Vector3(); let wsum = 0;
  for (let i = 0; i < 7; i++) { const w = 1 - i / 7; acc.addScaledVector(ctx.approx(target, ctx.t - (i / 6) * lag), w); wsum += w; }
  return acc.multiplyScalar(1 / wsum);
}

export function evalCamera(spec: CameraSpec, ctx: CamCtx): { pos: THREE.Vector3; look: THREE.Vector3; fov: number; roll: number } {
  let pos = new THREE.Vector3(0, 2, 6), look = new THREE.Vector3(0, 1, 0);
  let fov = spec.fov ?? 50;
  const u = ease(ctx.u, spec.ease);
  switch (spec.type) {
    case 'static': {
      pos = v3(spec.pos); look = Array.isArray(spec.look) ? v3(spec.look) : ctx.resolve(spec.look, ctx.t); break;
    }
    case 'dolly': {
      pos = v3(spec.from).lerp(v3(spec.to), u);
      const la = Array.isArray(spec.look) ? v3(spec.look) : ctx.resolve(spec.look, ctx.t);
      look = spec.lookTo ? la.lerp(Array.isArray(spec.lookTo) ? v3(spec.lookTo) : ctx.resolve(spec.lookTo, ctx.t), u) : la;
      break;
    }
    case 'follow': case 'track': {
      const tgt = smoothed(ctx, spec.target, spec.lag ?? 0.35);
      const h = spec.yaw !== undefined ? spec.yaw * D2R : ctx.heading(spec.target, ctx.t) + (spec.rel ?? (spec.type === 'track' ? 90 : 180)) * D2R;
      const yaw = h + (spec.yawTo !== undefined ? (spec.yawTo - (spec.yaw ?? 0)) * D2R * u : 0);
      const dist = (spec.dist ?? 5) + (spec.distTo !== undefined ? (spec.distTo - (spec.dist ?? 5)) * u : 0);
      pos = tgt.clone().add(new THREE.Vector3(Math.sin(yaw) * dist, spec.height ?? 1.6, Math.cos(yaw) * dist));
      look = (spec.look ? smoothed(ctx, spec.look, spec.lag ?? 0.35) : tgt.clone()).add(new THREE.Vector3(0, spec.lookHeight ?? 0, 0));
      break;
    }
    case 'orbit': {
      const c = spec.target ? smoothed(ctx, spec.target, spec.lag ?? 0.2) : v3(spec.center);
      const a = ((spec.from ?? 0) + ((spec.to ?? 90) - (spec.from ?? 0)) * u) * D2R;
      const rad = spec.radius ?? 5;
      pos = c.clone().add(new THREE.Vector3(Math.sin(a) * rad, spec.height ?? 2, Math.cos(a) * rad));
      look = c.clone().add(new THREE.Vector3(0, spec.lookHeight ?? 0, 0));
      break;
    }
    case 'close': {
      const part = spec.part ?? 'head';
      const tgtName = typeof spec.target === 'string' ? `${spec.target}.${part}` : spec.target;
      const p = ctx.resolve(tgtName, ctx.t);
      const fy = spec.facing === 'body' ? null : ctx.faceYaw?.(spec.target) ?? null;
      const h = (fy ?? ctx.heading(spec.target, ctx.t)) + (spec.rel ?? 0) * D2R;
      const dist = (spec.dist ?? 1.9) + (spec.push ? -spec.push * u : 0);
      pos = p.clone().add(new THREE.Vector3(Math.sin(h) * dist, spec.height ?? 0.05, Math.cos(h) * dist));
      look = p.clone().add(new THREE.Vector3(0, spec.lookHeight ?? -0.14, 0));
      fov = spec.fov ?? 40;
      break;
    }
    case 'ots': {
      const from = ctx.resolve(`${spec.from}.head`, ctx.t), to = ctx.resolve(spec.to.includes?.('.') ? spec.to : `${spec.to}.head`, ctx.t);
      const dir = to.clone().sub(from).setY(0).normalize();
      const right = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(spec.side ?? 0.45);
      pos = from.clone().addScaledVector(dir, -(spec.dist ?? 0.9)).add(right).add(new THREE.Vector3(0, spec.height ?? 0.15, 0));
      look = to.clone().add(new THREE.Vector3(0, spec.lookHeight ?? -0.1, 0)); fov = spec.fov ?? 42;
      break;
    }
    case 'top': {
      const c = smoothed(ctx, spec.target, spec.lag ?? 0.2);
      const hgt = (spec.height ?? 8) + (spec.heightTo !== undefined ? (spec.heightTo - (spec.height ?? 8)) * u : 0);
      pos = c.clone().add(new THREE.Vector3(0.001, hgt, spec.tilt ?? 0.6)); look = c.clone();
      break;
    }
    case 'wide': {
      const pts: THREE.Vector3[] = (spec.targets ?? []).map((tg: any) => ctx.approx(tg, ctx.t));
      const box = new THREE.Box3(); pts.forEach((p) => { box.expandByPoint(p); box.expandByPoint(p.clone().add(new THREE.Vector3(0, 1.8, 0))); });
      const c = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
      const yaw = (spec.yaw ?? 0) * D2R + ((spec.yawTo ?? spec.yaw ?? 0) - (spec.yaw ?? 0)) * D2R * u; const pitch = (spec.pitch ?? 22) * D2R;
      const ext = Math.max(size.x, size.z, 2) * (spec.pad ?? 1.3);
      const dist = ext / 2 / Math.tan((fov * D2R) / 2 * 0.56) * 0.9;
      pos = c.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist));
      look = c;
      break;
    }
    case 'pov': {
      pos = ctx.resolve(`${spec.from}.head`, ctx.t).add(new THREE.Vector3(0, 0.05, 0));
      look = ctx.resolve(spec.to, ctx.t); fov = spec.fov ?? 60; break;
    }
    case 'ground': {
      // low tracking camera at floor level, moving along a line
      pos = v3(spec.from).lerp(v3(spec.to), u); look = Array.isArray(spec.look) ? v3(spec.look) : ctx.resolve(spec.look, ctx.t); fov = spec.fov ?? 60; break;
    }
    default: throw new Error(`Unknown camera type ${spec.type}`);
  }
  // modifiers
  if (spec.offset) pos.add(v3(spec.offset));
  if (spec.lookOffset) look.add(v3(spec.lookOffset));
  if (spec.push) { if (spec.type !== 'close') pos.lerp(look, clamp(spec.push * u, 0, 0.9)); }
  if (spec.zoomTo !== undefined) fov = fov + (spec.zoomTo - fov) * ease(clamp((ctx.lt - (spec.zoomAt ?? 0)) / (spec.zoomDur ?? ctx.dur)), spec.zoomEase ?? 'out');
  let roll = (spec.roll ?? 0) * D2R;
  const hh = spec.handheld === false ? 0 : (spec.handheld ?? 0.6);
  if (hh) {
    const s = ctx.lt + (spec.seed ?? 0) * 10;
    pos.add(new THREE.Vector3(noise1(s * 0.6, 1), noise1(s * 0.5, 2), noise1(s * 0.55, 3)).multiplyScalar(0.025 * hh));
    look.add(new THREE.Vector3(noise1(s * 0.7, 4), noise1(s * 0.6, 5), 0).multiplyScalar(0.02 * hh));
  }
  if (spec.shake) {
    const at = spec.shake.at ?? 0; const d = ctx.lt - at;
    if (d >= 0) {
      const amp = (spec.shake.amp ?? 0.08) * Math.exp(-d * (spec.shake.decay ?? 4));
      const f = spec.shake.freq ?? 22;
      pos.add(new THREE.Vector3(noise1(d * f, 7), noise1(d * f, 8), noise1(d * f, 9)).multiplyScalar(amp));
      roll += noise1(d * f, 10) * amp * 0.5;
    }
  }
  return { pos, look, fov, roll };
}
