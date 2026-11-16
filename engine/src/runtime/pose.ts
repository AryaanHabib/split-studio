// Pose representation + the reusable animation clip library for puppet characters.
//
// Sign conventions (joint-local Euler XYZ, radians), character faces +Z:
//  spine/chest x>0 lean forward, z side lean, y twist
//  head x>0 look down, y>0 turn to character's left (+X)
//  shL/shR x<0 arm forward/up (-PI/2 horizontal, -PI overhead); shL z>0 / shR z<0 = outward
//  elL/elR x<0 bend
//  hipL/hipR x<0 thigh forward; hipL z>0 / hipR z<0 outward
//  knL/knR x>0 bend
//  hips: whole-body rotation about the hip pivot. lift = vertical hip offset; fwd = forward hip offset.

export type J = [number, number, number];
export const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'hipR', 'knR', 'anL', 'anR'] as const;
export type JointName = (typeof JOINTS)[number];
export type Pose = Record<JointName, J> & { lift: number; fwd: number; side: number };

export interface Face {
  browAngle: number; // + = angry (inner down), - = worried
  browRaise: number; // + = raised
  eyeScale: number; // 1 normal
  eyeSquint: number; // 0..1
  mouth: 'smile' | 'open' | 'line' | 'frown' | 'grin';
  open: number; // 0..1 for 'open'
  tears: number; // 0..1
  blush: number;
}

export const neutralFace = (): Face => ({ browAngle: 0, browRaise: 0, eyeScale: 1, eyeSquint: 0, mouth: 'line', open: 0, tears: 0, blush: 0 });

export function neutralPose(): Pose {
  const p: any = { lift: 0, fwd: 0, side: 0 };
  for (const j of JOINTS) p[j] = [0, 0, 0];
  p.shL = [0, 0, 0.12];
  p.shR = [0, 0, -0.12];
  p.elL = [-0.15, 0, 0];
  p.elR = [-0.15, 0, 0];
  return p as Pose;
}

export function clonePose(p: Pose): Pose {
  const o: any = { lift: p.lift, fwd: p.fwd, side: p.side };
  for (const j of JOINTS) o[j] = [p[j][0], p[j][1], p[j][2]];
  return o;
}

export function lerpPose(a: Pose, b: Pose, w: number, joints: readonly JointName[] = JOINTS, root = true): Pose {
  const o = clonePose(a);
  for (const j of joints) for (let k = 0; k < 3; k++) o[j][k] = a[j][k] + (b[j][k] - a[j][k]) * w;
  if (root) {
    o.lift = a.lift + (b.lift - a.lift) * w;
    o.fwd = a.fwd + (b.fwd - a.fwd) * w;
    o.side = a.side + (b.side - a.side) * w;
  }
  return o;
}

export function lerpFace(a: Face, b: Face, w: number): Face {
  const o = { ...a };
  for (const k of ['browAngle', 'browRaise', 'eyeScale', 'eyeSquint', 'open', 'tears', 'blush'] as const) o[k] = a[k] + (b[k] - a[k]) * w;
  o.mouth = w < 0.5 ? a.mouth : b.mouth;
  return o;
}

export const UPPER: JointName[] = ['chest', 'neck', 'shL', 'elL', 'shR', 'elR'];
export const ARMS: JointName[] = ['shL', 'elL', 'shR', 'elR'];

export interface ClipCtx {
  t: number; // scene time
  lt: number; // local time in segment
  dur: number;
  u: number; // 0..1 progress
  phase: number; // gait cycles (from distance travelled)
  speed: number; // current root speed m/s
  p: Record<string, any>;
  seed: number;
  height: number;
}

const S = Math.sin, C = Math.cos, PI = Math.PI;
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => { x = clamp(x); return x * x * (3 - 2 * x); };
const env = (u: number, a = 0.15, r = 0.15) => smooth(u / a) * smooth((1 - u) / r);
function hash(n: number) { const x = S(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function noise1(t: number, seed: number) {
  const i = Math.floor(t), f = t - i; const a = hash(i + seed * 13.7), b = hash(i + 1 + seed * 13.7);
  return (a + (b - a) * smooth(f)) * 2 - 1;
}

type BaseClip = (c: ClipCtx, p: Pose) => void;
type FaceClip = (c: ClipCtx, f: Face) => void;

function gait(c: ClipCtx, p: Pose, o: { swing: number; knee: number; arm: number; elbow: number; lean: number; bob: number; wide?: number; roll?: number; armOut?: number; hipTwist?: number }) {
  const ph = c.phase * 2 * PI;
  const s = S(ph), s2 = S(ph * 2);
  p.hipL[0] = -o.swing * s; p.hipR[0] = o.swing * s;
  p.knL[0] = o.knee * Math.max(0, -C(ph + 0.6)) + 0.08; p.knR[0] = o.knee * Math.max(0, C(ph + 0.6)) + 0.08;
  p.anL[0] = -0.25 * s * (o.swing / 0.5); p.anR[0] = 0.25 * s * (o.swing / 0.5);
  if (o.wide) { p.hipL[2] = o.wide; p.hipR[2] = -o.wide; }
  p.shL[0] = o.arm * s; p.shR[0] = -o.arm * s;
  p.elL[0] = -o.elbow - 0.2 * Math.max(0, s); p.elR[0] = -o.elbow - 0.2 * Math.max(0, -s);
  if (o.armOut) { p.shL[2] = o.armOut; p.shR[2] = -o.armOut; }
  p.spine[0] = o.lean; p.spine[1] = (o.hipTwist ?? 0.08) * s;
  p.head[0] = -o.lean * 0.6; p.head[1] = -(o.hipTwist ?? 0.08) * s * 0.8;
  p.lift = -o.bob * 0.5 + o.bob * Math.abs(s2) * 0.5 - o.bob * 0.3;
  if (o.roll) { p.hips[2] = o.roll * s; p.spine[2] = -o.roll * s * 1.4; }
}

const breathe = (c: ClipCtx, p: Pose, amt = 1) => {
  const b = S(c.t * 1.7 + c.seed) * 0.02 * amt;
  p.spine[0] += b; p.chest[0] += b * 0.5; p.head[0] -= b;
  p.shL[2] += b * 0.5; p.shR[2] -= b * 0.5;
};

export const BASE: Record<string, BaseClip> = {
  idle(c, p) { breathe(c, p); p.hips[2] = S(c.t * 0.5 + c.seed) * 0.02; p.head[1] = noise1(c.t * 0.3, c.seed) * 0.15; },
  stand(c, p) { breathe(c, p, 0.5); },
  walk(c, p) { gait(c, p, { swing: 0.42, knee: 0.75, arm: 0.35, elbow: 0.25, lean: 0.06, bob: 0.025 * c.height }); },
  sneak(c, p) { gait(c, p, { swing: 0.35, knee: 0.9, arm: 0.15, elbow: 1.2, lean: 0.35, bob: 0.01 * c.height }); p.lift -= 0.08 * c.height; p.shL[0] -= 0.6; p.shR[0] -= 0.6; },
  run(c, p) { gait(c, p, { swing: 0.85, knee: 1.5, arm: 0.8, elbow: 1.35, lean: 0.25, bob: 0.06 * c.height }); },
  sprint(c, p) { gait(c, p, { swing: 1.0, knee: 1.7, arm: 1.0, elbow: 1.45, lean: 0.38, bob: 0.07 * c.height }); },
  waddle(c, p) {
    gait(c, p, { swing: 0.38, knee: 0.5, arm: 0.25, elbow: 0.5, lean: 0.04, bob: 0.03 * c.height, wide: 0.1, roll: 0.13, armOut: 0.5, hipTwist: 0.04 });
  },
  toddlerRun(c, p) {
    gait(c, p, { swing: 0.7, knee: 1.0, arm: 0.5, elbow: 0.6, lean: 0.18, bob: 0.05 * c.height, wide: 0.08, roll: 0.1, armOut: 0.9, hipTwist: 0.05 });
    p.shL[0] -= 0.5; p.shR[0] -= 0.5;
  },
  panicRun(c, p) {
    gait(c, p, { swing: 0.85, knee: 1.4, arm: 0, elbow: 0.3, lean: 0.1, bob: 0.06 * c.height });
    const f = c.t * 14 + c.seed;
    p.shL[0] = -2.6 + S(f) * 0.5; p.shR[0] = -2.6 + S(f + 2) * 0.5; p.shL[2] = 0.5; p.shR[2] = -0.5;
    p.elL[0] = -0.3 + S(f * 1.3) * 0.4; p.elR[0] = -0.3 + S(f * 1.1) * 0.4;
    p.head[1] = S(c.t * 9) * 0.4;
  },
  panic(c, p) {
    const f = c.t * 13 + c.seed;
    p.shL[0] = -2.5 + S(f) * 0.6; p.shR[0] = -2.5 + S(f + 1.7) * 0.6; p.shL[2] = 0.6; p.shR[2] = -0.6;
    p.elL[0] = -0.4 + S(f * 1.2) * 0.5; p.elR[0] = -0.4 + S(f * 0.9) * 0.5;
    p.hipL[0] = -0.4 * Math.max(0, S(f * 0.8)); p.hipR[0] = -0.4 * Math.max(0, -S(f * 0.8));
    p.knL[0] = -p.hipL[0] * 1.5; p.knR[0] = -p.hipR[0] * 1.5;
    p.head[1] = S(c.t * 8) * 0.5; p.lift = Math.abs(S(f * 0.8)) * 0.03 * c.height;
  },
  crouch(c, p) { p.hipL[0] = p.hipR[0] = -0.9; p.knL[0] = p.knR[0] = 1.6; p.anL[0] = p.anR[0] = -0.7; p.spine[0] = 0.5; p.head[0] = -0.4; p.lift = -0.18 * c.height; p.shL[0] = p.shR[0] = -0.5; breathe(c, p); },
  jump(c, p) {
    // root arc is supplied by the compiler; this shapes the body: crouch -> extend -> tuck -> land
    const u = c.u;
    const crouch = smooth(u / 0.15) * (1 - smooth((u - 0.15) / 0.1)) + smooth((u - 0.85) / 0.1) * (1 - smooth((u - 0.95) / 0.05));
    const air = smooth((u - 0.2) / 0.1) * (1 - smooth((u - 0.8) / 0.1));
    p.hipL[0] = p.hipR[0] = -0.8 * crouch - 0.6 * air; p.knL[0] = p.knR[0] = 1.4 * crouch + 1.0 * air;
    p.spine[0] = 0.35 * crouch + 0.1 * air; p.lift = -0.14 * c.height * crouch;
    p.shL[0] = p.shR[0] = 0.4 * crouch - 2.4 * air * (c.p.armsUp === false ? 0.3 : 1); p.shL[2] = 0.3 * air; p.shR[2] = -0.3 * air;
  },
  hop(c, p) { BASE.jump(c, p); },
  fall(c, p) {
    // topple backwards (dir=-1) or forwards (dir=1) from standing to lying
    const dir = c.p.dir ?? -1; const u = c.p.held ? 1 : smooth(clamp(c.lt / Math.min(c.dur, 0.7)));
    const ang = (PI / 2) * u * 0.96 * dir;
    const L = c.height * 0.5;
    p.hips[0] = ang; p.fwd = Math.sin(ang) * L * 0.9; p.lift = -(1 - Math.cos(ang)) * L * 0.9;
    const flail = (1 - u) + 0.15;
    p.shL[0] = -2.2 * flail + S(c.t * 12) * 0.4 * flail; p.shR[0] = -2.0 * flail + S(c.t * 11 + 1) * 0.4 * flail; p.shL[2] = 0.7; p.shR[2] = -0.7;
    p.hipL[0] = -0.6 * u; p.hipR[0] = -0.2 * u; p.knL[0] = 0.4 * u; p.knR[0] = 0.2;
    p.head[0] = dir < 0 ? -0.4 * (1 - u) : 0.3;
  },
  lie(c, p) {
    const dir = c.p.dir ?? -1; const L = c.height * 0.5;
    const ang = (PI / 2) * 0.96 * dir;
    p.hips[0] = ang; p.fwd = Math.sin(ang) * L * 0.9; p.lift = -(1 - Math.cos(ang)) * L * 0.9;
    p.shL[2] = 0.9; p.shR[2] = -0.9; p.shL[0] = -0.4; p.shR[0] = -0.2; p.hipL[0] = -0.3; p.knL[0] = 0.5; p.hipL[2] = 0.15; p.hipR[2] = -0.15;
    p.head[1] = S(c.t * 0.8 + c.seed) * 0.2; breathe(c, p, 2);
  },
  getUp(c, p) {
    const dir = c.p.dir ?? -1; const L = c.height * 0.5; const u = smooth(c.u);
    const ang = (PI / 2) * 0.96 * dir * (1 - u);
    p.hips[0] = ang; p.fwd = Math.sin(ang) * L * 0.9; p.lift = -(1 - Math.cos(ang)) * L * 0.9;
    p.hipL[0] = p.hipR[0] = -0.9 * S(u * PI); p.knL[0] = p.knR[0] = 1.4 * S(u * PI);
  },
  sit(c, p) {
    // sit on the floor, legs forward (toddler style) or on a seat if p.seat
    const H = c.height; const u = c.p.held ? 1 : smooth(clamp(c.lt / 0.5));
    if (c.p.seat) {
      p.hipL[0] = p.hipR[0] = -PI / 2 * u; p.knL[0] = p.knR[0] = PI / 2 * u; p.lift = -0.24 * H * u;
    } else {
      p.hipL[0] = p.hipR[0] = -1.45 * u; p.hipL[2] = 0.25 * u; p.hipR[2] = -0.25 * u; p.knL[0] = p.knR[0] = 0.15 * u;
      p.lift = -0.46 * H * u * (H < 1.2 ? 0.86 : 1); p.spine[0] = -0.05;
    }
    breathe(c, p);
    p.shL[0] = -0.3 * u; p.shR[0] = -0.3 * u; p.elL[0] = p.elR[0] = -0.6;
  },
  cry(c, p) {
    BASE.sit(c, p);
    const sob = Math.max(0, S(c.t * 7 + c.seed)) ** 2;
    p.shL[0] = -1.9; p.shR[0] = -1.9; p.shL[2] = -0.25; p.shR[2] = 0.25; p.elL[0] = p.elR[0] = -2.2;
    p.head[0] = -0.35 + sob * 0.12; p.spine[0] = 0.05 + sob * 0.08; p.lift += sob * 0.006 * c.height;
  },
  wail(c, p) { BASE.idle(c, p); const sob = Math.max(0, S(c.t * 6 + c.seed)); p.head[0] = -0.45; p.shL[0] = p.shR[0] = -0.2; p.shL[2] = 0.35; p.shR[2] = -0.35; p.spine[0] = -0.1 - sob * 0.05; p.lift = sob * 0.01 * c.height; },
  celebrate(c, p) {
    const f = c.t * 2 * PI * 2.2 + c.seed; const hop = Math.max(0, S(f));
    p.lift = hop * 0.12 * c.height; p.shL[0] = -2.7 + S(f * 0.5) * 0.25; p.shR[0] = -2.7 - S(f * 0.5) * 0.25; p.shL[2] = 0.45; p.shR[2] = -0.45;
    p.elL[0] = p.elR[0] = -0.2; p.hipL[0] = p.hipR[0] = -0.35 * (1 - hop); p.knL[0] = p.knR[0] = 0.7 * (1 - hop); p.head[0] = -0.3;
  },
  laugh(c, p) {
    const f = c.t * 16; const sh = S(f) * 0.04;
    p.spine[0] = -0.25 + sh; p.head[0] = -0.4 + sh; p.shL[0] = -0.5; p.shR[0] = -0.5; p.shL[2] = -0.3; p.shR[2] = 0.3; p.elL[0] = p.elR[0] = -1.6; p.lift = Math.abs(S(f * 0.5)) * 0.01 * c.height;
  },
  dance(c, p) {
    const f = c.t * 2 * PI * 1.8; p.hips[2] = S(f) * 0.12; p.spine[2] = -S(f) * 0.2; p.lift = Math.abs(S(f)) * 0.03 * c.height;
    p.shL[0] = -1.5 + S(f) * 0.8; p.shR[0] = -1.5 - S(f) * 0.8; p.elL[0] = p.elR[0] = -1.2; p.head[2] = S(f) * 0.15; p.knL[0] = 0.3 + 0.3 * S(f); p.knR[0] = 0.3 - 0.3 * S(f); p.hipL[0] = -p.knL[0] * 0.5; p.hipR[0] = -p.knR[0] * 0.5;
  },
  shock(c, p) {
    // quick recoil then hold
    const k = smooth(clamp(c.lt / 0.12)); const settle = 1 - 0.3 * smooth(clamp((c.lt - 0.3) / 0.5));
    p.spine[0] = -0.22 * k * settle; p.head[0] = -0.15 * k; p.shL[0] = -0.9 * k * settle; p.shR[0] = -0.9 * k * settle; p.shL[2] = 0.5 * k; p.shR[2] = -0.5 * k;
    p.elL[0] = p.elR[0] = -1.3 * k; p.lift = 0.02 * c.height * S(clamp(c.lt / 0.25) * PI); p.hipL[0] = 0.1 * k;
  },
  scared(c, p) {
    const tr = S(c.t * 30) * 0.015; p.spine[0] = 0.25 + tr; p.lift = -0.07 * c.height; p.hipL[0] = p.hipR[0] = -0.35; p.knL[0] = p.knR[0] = 0.7;
    p.shL[0] = p.shR[0] = -1.4; p.shL[2] = -0.25; p.shR[2] = 0.25; p.elL[0] = p.elR[0] = -1.9; p.head[0] = 0.1 + tr; p.head[1] = noise1(c.t * 3, c.seed) * 0.35;
  },
  shrug(c, p) { BASE.idle(c, p); const k = env(c.u, 0.2, 0.25); p.shL[2] = 0.55 * k; p.shR[2] = -0.55 * k; p.shL[0] = -0.3 * k; p.shR[0] = -0.3 * k; p.elL[0] = p.elR[0] = -1.4 * k; p.head[2] = 0.18 * k; p.chest[0] = -0.05 * k; },
  facepalm(c, p) { BASE.idle(c, p); const k = env(c.u, 0.2, 0.15); p.shR[0] = -2.0 * k; p.shR[2] = 0.35 * k; p.elR[0] = -2.3 * k; p.head[0] = 0.35 * k; p.spine[0] = 0.12 * k; },
  wave(c, p) { BASE.idle(c, p); const k = env(c.u, 0.15, 0.15); p.shR[0] = -0.4 * k; p.shR[2] = -2.6 * k; p.elR[0] = -0.4 * k; p.elR[1] = S(c.t * 14) * 0.6 * k; },
  point(c, p) { BASE.idle(c, p); const k = env(c.u, 0.15, 0.12); p.shR[0] = -1.55 * k; p.shR[1] = (c.p.yaw ?? 0) * k; p.elR[0] = -0.05; p.spine[1] = (c.p.yaw ?? 0) * 0.3 * k; },
  pointUp(c, p) { BASE.idle(c, p); const k = env(c.u, 0.15, 0.12); p.shR[0] = -2.9 * k; p.shR[2] = -0.15 * k; p.elR[0] = -0.05; p.head[0] = -0.4 * k; },
  armsCrossed(c, p) { BASE.idle(c, p); p.shL[0] = p.shR[0] = -0.75; p.shL[2] = -0.35; p.shR[2] = 0.35; p.elL[0] = p.elR[0] = -2.1; p.elL[1] = 0.5; p.elR[1] = -0.5; p.spine[0] = -0.04; },
  handsOnHips(c, p) { BASE.idle(c, p); p.shL[2] = 0.6; p.shR[2] = -0.6; p.elL[0] = p.elR[0] = -1.5; p.elL[1] = -1.2; p.elR[1] = 1.2; },
  reachUp(c, p) { BASE.idle(c, p); const k = smooth(clamp(c.lt / 0.25)); p.shL[0] = p.shR[0] = -3.0 * k; p.shL[2] = 0.12; p.shR[2] = -0.12; p.elL[0] = p.elR[0] = -0.05; p.head[0] = -0.45 * k; p.lift = 0.015 * c.height * k; },
  block(c, p) { BASE.reachUp(c, p); p.shL[2] = 0.4; p.shR[2] = -0.4; p.hipL[2] = 0.15; p.hipR[2] = -0.15; },
  balance(c, p) { const w = S(c.t * 3 + c.seed) * 0.12; p.shL[2] = 1.3 + w; p.shR[2] = -1.3 + w; p.spine[2] = -w * 0.8; p.hips[2] = w * 0.3; p.hipL[2] = 0.12; p.hipR[2] = -0.12; p.knL[0] = p.knR[0] = 0.25; p.hipL[0] = p.hipR[0] = -0.12; },
  hug(c, p) { /* clinging to a leg */ p.shL[0] = p.shR[0] = -1.5; p.shL[2] = -0.5; p.shR[2] = 0.5; p.elL[0] = p.elR[0] = -1.6; p.hipL[0] = -0.9 + S(c.t * 7 + c.seed) * 0.3; p.hipR[0] = -0.7 - S(c.t * 7 + c.seed) * 0.3; p.knL[0] = p.knR[0] = 1.1; p.head[1] = 0.6; p.spine[0] = 0.15; },
  flail(c, p) {
    const f = c.t * 11 + c.seed * 3;
    p.shL[0] = -1.5 + S(f) * 1.3; p.shR[0] = -1.5 + S(f + 2) * 1.3; p.shL[2] = 0.9 + S(f * 0.7) * 0.4; p.shR[2] = -0.9 - S(f * 0.8) * 0.4;
    p.hipL[0] = -0.6 + S(f * 0.9) * 0.6; p.hipR[0] = -0.6 + S(f * 0.9 + 2) * 0.6; p.knL[0] = 0.8 + S(f) * 0.5; p.knR[0] = 0.8 + S(f + 1) * 0.5; p.head[0] = S(f * 0.6) * 0.3;
  },
  tumble(c, p) { BASE.flail(c, p); },
  pileLie(c, p) {
    // a toddler lying in a dogpile, wriggling
    const f = c.t * 5 + c.seed * 7; const dir = c.p.dir ?? 1; const L = c.height * 0.5; const ang = (PI / 2) * 0.9 * dir;
    p.hips[0] = ang; p.hips[2] = (c.p.roll ?? 0); p.fwd = Math.sin(ang) * L * 0.9; p.lift = -(1 - Math.cos(ang)) * L * 0.9;
    p.shL[0] = -2.2 + S(f) * 0.6; p.shR[0] = -2.0 + S(f + 1.3) * 0.6; p.shL[2] = 0.5; p.shR[2] = -0.5; p.hipL[0] = -0.3 + S(f * 1.2) * 0.4; p.hipR[0] = -0.3 + S(f * 1.2 + 2) * 0.4;
  },
  sneeze(c, p) {
    BASE.balance(c, p); const u = c.lt; const back = smooth(clamp(u / 0.7)) * (1 - smooth(clamp((u - 0.75) / 0.06))); const fwd = smooth(clamp((u - 0.75) / 0.06)) * (1 - smooth(clamp((u - 1.0) / 0.4)));
    p.head[0] = -0.55 * back + 0.6 * fwd; p.spine[0] = -0.2 * back + 0.35 * fwd;
  },
  dribble(c, p) {
    // stationary dribble with right hand
    BASE.idle(c, p); const f = c.lt * (c.p.freq ?? 2.2) * 2 * PI;
    p.hipL[0] = p.hipR[0] = -0.3; p.knL[0] = p.knR[0] = 0.55; p.lift = -0.04 * c.height; p.spine[0] = 0.2;
    p.shR[0] = -0.55 - 0.18 * C(f); p.shR[2] = -0.2; p.elR[0] = -0.65 - 0.25 * C(f); p.shL[0] = -0.4; p.shL[2] = 0.35; p.elL[0] = -0.9;
  },
  shoot(c, p) {
    // jump shot: gather (0-0.35) -> rise & release (0.35-0.6) -> follow-through
    const lt = c.lt; const g = smooth(clamp(lt / 0.3)) * (1 - smooth(clamp((lt - 0.3) / 0.12)));
    const rise = smooth(clamp((lt - 0.3) / 0.25)); const air = S(clamp((lt - 0.32) / 0.6) * PI) * (c.p.jump ?? 1);
    p.hipL[0] = p.hipR[0] = -0.7 * g - 0.05; p.knL[0] = p.knR[0] = 1.2 * g + 0.25 * air; p.lift = -0.12 * c.height * g + 0.22 * c.height * air;
    p.spine[0] = 0.25 * g - 0.04 * rise;
    const armUp = -1.4 * g - 2.95 * rise * (1 - g);
    p.shR[0] = armUp; p.shL[0] = armUp * 0.95; p.shL[2] = -0.15; p.shR[2] = 0.15;
    p.elR[0] = -1.9 * g - 0.15 * rise; p.elL[0] = -1.9 * g - 0.4 * rise; p.head[0] = -0.35 * rise;
  },
  dunk(c, p) { BASE.jump(c, p); const air = smooth(clamp((c.u - 0.2) / 0.15)); p.shR[0] = -3.0 * air; p.shR[2] = 0; p.elR[0] = -0.1; p.shL[0] = -1.2 * air; },
  throwUnder(c, p) {
    BASE.idle(c, p); const lt = c.lt; const back = smooth(clamp(lt / 0.35)) * (1 - smooth(clamp((lt - 0.35) / 0.15))); const fw = smooth(clamp((lt - 0.35) / 0.18));
    p.shL[0] = p.shR[0] = 0.7 * back - 1.9 * fw; p.shL[2] = -0.1; p.shR[2] = 0.1; p.elL[0] = p.elR[0] = -0.2;
    p.hipL[0] = p.hipR[0] = -0.5 * back; p.knL[0] = p.knR[0] = 0.9 * back; p.lift = -0.08 * c.height * back + 0.03 * c.height * fw; p.spine[0] = 0.35 * back - 0.1 * fw;
  },
  throw(c, p) {
    BASE.idle(c, p); const lt = c.lt; const back = smooth(clamp(lt / 0.3)) * (1 - smooth(clamp((lt - 0.3) / 0.12))); const fw = smooth(clamp((lt - 0.3) / 0.15));
    p.shR[0] = -2.6 * back - 1.4 * fw; p.shR[2] = -0.4 * back; p.elR[0] = -1.6 * back - 0.1; p.spine[1] = 0.4 * back - 0.4 * fw; p.spine[0] = 0.2 * fw;
  },
  push(c, p) { BASE.idle(c, p); const k = smooth(clamp(c.lt / 0.15)) * (1 - smooth(clamp((c.lt - 0.5) / 0.3))); p.shL[0] = p.shR[0] = -1.5 * k; p.elL[0] = p.elR[0] = -0.1; p.spine[0] = 0.3 * k; p.hipL[0] = -0.4 * k; p.knL[0] = 0.3 * k; },
  stumble(c, p) {
    const u = c.u; const wob = S(c.lt * 9) * (1 - u);
    p.spine[0] = 0.15 + wob * 0.2; p.spine[2] = wob * 0.25; p.shL[2] = 0.9 + wob * 0.5; p.shR[2] = -0.9 + wob * 0.5;
    p.hipL[0] = -0.4 * Math.max(0, S(c.lt * 6)); p.hipR[0] = -0.4 * Math.max(0, -S(c.lt * 6)); p.knL[0] = -p.hipL[0]; p.knR[0] = -p.hipR[0];
  },
  heavyWalk(c, p) {
    // walking while weighed down (toddlers clinging): slow, wide, struggling
    gait(c, p, { swing: 0.3, knee: 0.5, arm: 0.5, elbow: 0.2, lean: 0.12, bob: 0.03 * c.height, wide: 0.16, roll: 0.12 });
    p.shL[2] = 0.6; p.shR[2] = -0.6; p.head[1] = noise1(c.t * 2, c.seed) * 0.5;
  },
  thumbsUpLying(c, p) { BASE.lie(c, p); const k = env(c.u, 0.2, 0.1); p.shR[0] = -0.4 - 1.2 * k; p.shR[2] = -0.6; p.elR[0] = -1.5 * k; },
  talkGesture(c, p) { BASE.idle(c, p); const f = c.t * 3.1 + c.seed; p.shR[0] = -0.6 + S(f) * 0.25; p.elR[0] = -1.3 + S(f * 1.3) * 0.3; p.shL[0] = -0.4 + S(f * 0.8 + 1) * 0.2; p.elL[0] = -1.0; },
  phoneToEar(c, p) { BASE.idle(c, p); const k = smooth(clamp(c.lt / 0.4)); p.shR[0] = -1.0 * k; p.shR[2] = 0.55 * k; p.elR[0] = -2.5 * k; p.head[2] = -0.12 * k; },
  sitPhone(c, p) { BASE.sit({ ...c, p: { seat: true } } as ClipCtx, p); const k = smooth(clamp(c.lt / 0.4)); p.shR[0] = -1.0 * k; p.shR[2] = 0.55 * k; p.elR[0] = -2.5 * k; p.head[2] = -0.12 * k; },
  freeze(c, p) { p.shL[0] = -0.35; p.shR[0] = -0.6; p.elR[0] = -0.9; p.hipL[0] = -0.3; p.knL[0] = 0.4; p.spine[0] = 0.1; },
  float(c, p) { const f = c.t * 1.3 + c.seed; p.shL[2] = 1.0 + S(f) * 0.3; p.shR[2] = -1.0 - S(f + 1) * 0.3; p.hipL[0] = -0.3 + S(f * 0.8) * 0.2; p.hipR[0] = 0.1 + S(f * 0.8 + 2) * 0.2; p.knL[0] = 0.5; p.knR[0] = 0.3; p.spine[0] = S(f * 0.5) * 0.15; },
  crawl(c, p) {
    const ph = c.phase * 2 * PI; const s = S(ph); const L = c.height * 0.5;
    p.hips[0] = 1.25; p.fwd = Math.sin(1.25) * L * 0.55; p.lift = -(1 - Math.cos(1.25)) * L * 1.05;
    p.shL[0] = -1.35 + s * 0.4; p.shR[0] = -1.35 - s * 0.4; p.hipL[0] = -1.3 - s * 0.35; p.hipR[0] = -1.3 + s * 0.35; p.knL[0] = p.knR[0] = 1.5; p.head[0] = -0.9;
  },
};

// Upper-body overlays (replace arm/chest joints of the base pose)
export const UPPER_CLIPS: Record<string, BaseClip> = {
  dribble(c, p) {
    const f = c.lt * (c.p.freq ?? 2.2) * 2 * PI;
    p.shR[0] = -0.5 - 0.2 * C(f); p.shR[2] = -0.25; p.elR[0] = -0.6 - 0.3 * C(f); p.shL[0] = -0.3; p.shL[2] = 0.3; p.elL[0] = -0.8;
  },
  holdBall(c, p) { p.shL[0] = p.shR[0] = -0.8; p.shL[2] = -0.32; p.shR[2] = 0.32; p.elL[0] = p.elR[0] = -1.15; },
  raiseBall(c, p) { const k = smooth(clamp(c.lt / 0.25)); p.shL[0] = p.shR[0] = -0.8 - 2.2 * k; p.shL[2] = -0.25 + 0.2 * k; p.shR[2] = 0.25 - 0.2 * k; p.elL[0] = p.elR[0] = -1.1 + 0.8 * k; },
  wave: (c, p) => { const k = env(c.u, 0.15, 0.15); p.shR[0] = -0.4 * k; p.shR[2] = -2.6 * k; p.elR[0] = -0.4 * k; p.elR[1] = S(c.t * 14) * 0.6 * k; },
  pointUp: (c, p) => { const k = env(c.u, 0.12, 0.12); p.shR[0] = -2.9 * k; p.shR[2] = -0.15 * k; p.elR[0] = -0.05; },
  point: (c, p) => { const k = env(c.u, 0.12, 0.12); p.shR[0] = -1.55 * k; p.shR[1] = (c.p.yaw ?? 0) * k; p.elR[0] = -0.05; },
  armsUp: (c, p) => { const k = smooth(clamp(c.lt / 0.2)); p.shL[0] = p.shR[0] = -2.8 * k; p.shL[2] = 0.35; p.shR[2] = -0.35; p.elL[0] = p.elR[0] = -0.15; },
  flailArms: (c, p) => { const f = c.t * 13 + c.seed; p.shL[0] = -2.5 + S(f) * 0.6; p.shR[0] = -2.5 + S(f + 1.7) * 0.6; p.shL[2] = 0.6; p.shR[2] = -0.6; p.elL[0] = -0.4 + S(f * 1.2) * 0.5; p.elR[0] = -0.4 + S(f * 0.9) * 0.5; },
  phoneToEar: (c, p) => { const k = smooth(clamp(c.lt / 0.4)); p.shR[0] = -1.0 * k; p.shR[2] = 0.55 * k; p.elR[0] = -2.5 * k; },
  hug: (c, p) => { p.shL[0] = p.shR[0] = -1.5; p.shL[2] = -0.5; p.shR[2] = 0.5; p.elL[0] = p.elR[0] = -1.6; },
  talkGesture: (c, p) => { const f = c.t * 3.1 + c.seed; p.shR[0] = -0.6 + S(f) * 0.25; p.elR[0] = -1.3 + S(f * 1.3) * 0.3; },
  armsOut: (c, p) => { p.shL[2] = 1.3; p.shR[2] = -1.3; p.elL[0] = p.elR[0] = -0.1; },
};

export const FACES: Record<string, FaceClip> = {
  neutral() {},
  happy(c, f) { f.mouth = 'smile'; f.browRaise = 0.15; f.eyeSquint = 0.2; },
  grin(c, f) { f.mouth = 'grin'; f.open = 0.5; f.browRaise = 0.2; f.eyeSquint = 0.3; },
  laugh(c, f) { f.mouth = 'open'; f.open = 0.55 + 0.3 * Math.abs(S(c.t * 16)); f.eyeSquint = 0.85; f.browRaise = 0.3; },
  smug(c, f) { f.mouth = 'smile'; f.browAngle = 0.25; f.eyeSquint = 0.45; f.browRaise = -0.1; },
  shock(c, f) { f.mouth = 'open'; f.open = 0.8; f.browRaise = 1; f.eyeScale = 1.35; },
  scared(c, f) { f.mouth = 'open'; f.open = 0.45 + 0.1 * S(c.t * 25); f.browRaise = 0.7; f.browAngle = -0.5; f.eyeScale = 1.3; },
  terrified(c, f) { FACES.scared(c, f); f.open = 0.9; f.eyeScale = 1.45; },
  angry(c, f) { f.mouth = 'frown'; f.browAngle = 0.6; f.browRaise = -0.3; f.eyeSquint = 0.3; },
  determined(c, f) { f.mouth = 'line'; f.browAngle = 0.55; f.browRaise = -0.2; f.eyeSquint = 0.35; },
  sad(c, f) { f.mouth = 'frown'; f.browAngle = -0.6; f.browRaise = 0.25; },
  cry(c, f) { f.mouth = 'open'; f.open = 0.5 + 0.35 * Math.max(0, S(c.t * 7 + c.seed)); f.browAngle = -0.7; f.browRaise = 0.3; f.eyeSquint = 0.9; f.tears = 1; },
  confused(c, f) { f.mouth = 'line'; f.browAngle = 0; f.browRaise = 0.4; f.eyeScale = 1.1; },
  worried(c, f) { f.mouth = 'line'; f.browAngle = -0.5; f.browRaise = 0.35; },
  sleepy(c, f) { f.eyeSquint = 0.9; f.mouth = 'line'; },
  guilty(c, f) { f.mouth = 'frown'; f.browAngle = -0.45; f.browRaise = 0.2; f.eyeScale = 0.9; f.blush = 0.6; },
  dazed(c, f) { f.mouth = 'open'; f.open = 0.25; f.eyeSquint = 0.5; f.browRaise = 0.3; },
};

export { clamp, smooth, noise1, hash };
