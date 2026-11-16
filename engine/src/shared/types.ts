// Compiled (executable) episode format consumed by the renderer.
// The authoring format (what Claude / the user writes) lives in compiler/schema.ts.
// Everything here is a pure function of time: the renderer can evaluate any
// frame independently, which makes previews, scrubbing and re-rendering a
// single shot possible.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** Root transform keyframe for an actor (scene time). */
export interface RootKey {
  t: number;
  x: number;
  y: number; // vertical offset above ground (jumps, standing on things)
  z: number;
  h: number; // heading (yaw, radians). 0 = facing +Z
  d: number; // cumulative distance travelled (drives gait phase so feet don't slide)
}

export type Layer = 'base' | 'upper' | 'face' | 'look' | 'mouth';

/** A pose clip active over a time range. */
export interface PoseSeg {
  t0: number;
  t1: number;
  clip: string;
  layer: Layer;
  p?: Record<string, any>;
  blend?: number; // blend-in seconds
}

export interface AttachSeg {
  t0: number;
  t1: number;
  target: string; // actor id
  offset: Vec3; // in target's local frame (x right, y up, z forward)
  heading: number; // relative heading
}

export interface PhysicsSeg {
  t0: number;
  t1: number;
  bake: string; // bake id
  body: number; // index into bake bodies
}

export interface PuppetLook {
  archetype: string;
  height: number;
  headScale: number;
  bodyWidth: number;
  limb: number;
  skin: string;
  shirt: string;
  pants: string;
  shoes: string;
  hair: string; // style
  hairColor: string;
  outfit: string; // 'tee' | 'jersey' | 'diaper' | 'suit' | 'robe' | 'onesie' | 'lab'
  number?: string; // jersey number
  accessory?: string; // 'headband' | 'bow' | 'cap' | 'glasses' | 'pacifier' | 'none'
  accessoryColor?: string;
  headShape?: 'round' | 'box';
  eyeSize?: number;
}

export interface CompiledActor {
  id: string;
  name: string;
  kind: 'puppet' | 'gltf';
  look?: PuppetLook;
  model?: string; // gltf asset path
  modelScale?: number;
  clipMap?: Record<string, string>; // our clip -> gltf animation name
  root: RootKey[];
  segs: PoseSeg[];
  attach: AttachSeg[];
  physics: PhysicsSeg[];
  hidden?: [number, number][]; // time ranges where actor is not rendered
  shadow?: 'cast' | 'blob';
  seed: number;
}

export type PropMode = 'path' | 'attach' | 'dribble' | 'hidden' | 'bake';

export interface PropSeg {
  t0: number;
  t1: number;
  mode: PropMode;
  actor?: string;
  hand?: 'L' | 'R' | 'both' | 'head';
  path?: string; // id into scene.paths
  bake?: string;
  body?: number;
  freq?: number; // dribble frequency
}

export interface CompiledProp {
  id: string;
  kind: string; // 'ball' | 'crate' | 'chair' | 'phone' | ...
  params: Record<string, any>;
  rest: Vec3; // position when no segment is active
  segs: PropSeg[];
}

/** Dense sampled path (position + optional spin) used for scripted flights. */
export interface SampledPath {
  t0: number;
  dt: number;
  pos: number[]; // flat xyz
  spin?: Vec3; // angular velocity rad/s for visual rotation
}

export interface PhysicsBake {
  id: string;
  t0: number;
  dt: number;
  frames: number; // number of samples
  bodies: { id: string; shape: string; size: Vec3 }[];
  data: number[]; // frames * bodies * 7 (x,y,z,qx,qy,qz,qw)
  contacts: { t: number; a: string; b: string; impulse: number }[];
  seed: number;
  simulated: true; // results emerge from the solver, not from a script
}

export interface WorldEvent {
  t: number;
  kind: string; // 'lights' | 'flash' | 'sway' | 'fx' | ...
  p: Record<string, any>;
}

export interface CompiledScene {
  id: string;
  set: { preset: string; params: Record<string, any> };
  duration: number;
  actors: CompiledActor[];
  props: CompiledProp[];
  paths: Record<string, SampledPath>;
  bakes: Record<string, PhysicsBake>;
  events: WorldEvent[];
  markers: Record<string, number>;
  groups: Record<string, string[]>;
  fog?: { color: string; near: number; far: number };
}

export type CameraSpec = Record<string, any> & { type: string };

export interface CompiledShot {
  id: string;
  index: number;
  start: number; // video time
  end: number;
  scene: string;
  sceneStart: number;
  speed: number; // scene seconds per video second (can ramp)
  ramp?: { at: number; speed: number; dur: number }[]; // speed ramps (video-time offsets inside shot)
  camera: CameraSpec;
  transition?: string;
  purpose?: string;
}

export interface OverlayItem {
  t0: number;
  t1: number;
  kind: string; // 'title' | 'score' | 'choice' | 'label' | 'card' | 'flash' | 'fade' | 'counter' | 'caption'
  p: Record<string, any>;
}

export interface AudioCue {
  t: number; // video time
  kind: 'sfx' | 'voice' | 'music';
  id: string;
  gain?: number;
  pan?: number;
  rate?: number;
  file?: string;
  dur?: number;
  text?: string;
  speaker?: string;
  fx?: string; // 'phone' | 'radio' | 'echo' | 'whisper'
  offset?: number; // seconds to skip into the source (audio bridges across cuts)
}

export interface CompiledVideo {
  episode: string;
  id: string; // 'main' | 'red' | 'blue' | ...
  branch: string;
  title: string;
  fps: number;
  width: number;
  height: number;
  duration: number;
  seed: number;
  scenes: CompiledScene[];
  shots: CompiledShot[];
  overlays: OverlayItem[];
  audio: AudioCue[];
  music?: Record<string, any>;
  grade?: Record<string, any>;
  style?: string;
  coverTime?: number;
}
