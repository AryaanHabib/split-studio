// Authoring format for episodes. This is what the showrunner (Claude Code
// sessions or the user) writes. See docs/EPISODE_SPEC.md for the guide.
import { z } from 'zod';

const Vec2 = z.tuple([z.number(), z.number()]);
const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export const Target = z.union([z.string(), Vec2, Vec3, z.object({ target: z.any(), offset: Vec3.optional() })]);
export const TimeExpr = z.union([z.number(), z.string()]);

export const LookSchema = z.object({
  height: z.number().optional(), headScale: z.number().optional(), bodyWidth: z.number().optional(), limb: z.number().optional(),
  skin: z.string().optional(), shirt: z.string().optional(), pants: z.string().optional(), shoes: z.string().optional(),
  hair: z.string().optional(), hairColor: z.string().optional(), outfit: z.string().optional(), number: z.string().optional(),
  accessory: z.string().optional(), accessoryColor: z.string().optional(), headShape: z.enum(['round', 'box']).optional(), eyeSize: z.number().optional(),
}).strict();

export const CharacterSchema = z.object({
  name: z.string().optional(),
  kind: z.enum(['puppet', 'gltf']).default('puppet'),
  archetype: z.string().default('adult'),
  look: LookSchema.default({}),
  variants: z.record(z.array(z.any())).optional(), // for crowd templates: per-field random choices
  model: z.string().optional(),
  scale: z.number().optional(),
  clipMap: z.record(z.string()).optional(),
  voice: z.string().optional(),
  voicePitch: z.number().optional(), // semitones
  voiceSpeed: z.number().optional(),
  steps: z.string().optional(), // footstep sfx id
  personality: z.string().optional(),
}).strict();

export const ActionSchema = z.object({ do: z.string(), at: TimeExpr.optional(), mark: z.string().optional(), note: z.string().optional() }).passthrough();

export const CastEntry = z.object({ char: z.string().optional(), at: Target.optional(), facing: z.union([Target, z.number()]).optional(), y: z.number().optional(), hiddenUntil: TimeExpr.optional(), hiddenFrom: TimeExpr.optional() }).strict();

export const CrowdSchema = z.object({
  template: z.string(), count: z.number().int().min(1).max(300), formation: z.enum(['grid', 'line', 'blob', 'ring']).default('blob'),
  center: Vec2, spacing: z.number().default(0.8), facing: z.union([Target, z.number()]).optional(), cols: z.number().optional(), radius: z.number().optional(),
  named: z.record(z.object({ char: z.string(), index: z.number().optional() })).optional(),
}).strict();

export const PropSchema = z.object({ kind: z.string(), at: z.union([Vec3, Vec2]).optional(), params: z.record(z.any()).optional(), heldBy: z.string().optional(), hand: z.string().optional() }).strict();

export const SceneSchema = z.object({
  set: z.string(),
  params: z.record(z.any()).optional(),
  duration: z.number().optional(),
  continueFrom: z.object({ scene: z.string(), at: TimeExpr.default('@end') }).optional(),
  cast: z.record(CastEntry).default({}),
  crowds: z.record(CrowdSchema).default({}),
  props: z.record(PropSchema).default({}),
  tracks: z.record(z.array(ActionSchema)).default({}),
  structures: z.record(z.object({
    kind: z.enum(['building', 'stack', 'wall']).default('building'),
    at: Vec2, floors: z.number().int().min(1).max(40).default(6), size: Vec2.default([6, 6]), floorHeight: z.number().default(3),
    split: z.number().int().min(1).max(4).default(2), color: z.string().default('#9aa7b8'), gap: z.number().default(0.04),
  }).strict()).default({}),
  fog: z.object({ color: z.string(), near: z.number(), far: z.number() }).optional(),
  notes: z.string().optional(),
}).strict();

export const OverlaySchema = z.object({ kind: z.string(), at: TimeExpr.optional(), shot: z.union([z.string(), z.number()]).optional(), dur: z.number().optional(), until: TimeExpr.optional() }).passthrough();

export const ShotSchema = z.object({
  id: z.string().optional(),
  scene: z.string(),
  from: TimeExpr,
  to: TimeExpr.optional(),
  dur: z.number().optional(), // video seconds (alternative to `to`)
  speed: z.number().default(1),
  ramp: z.array(z.object({ at: z.number(), speed: z.number(), dur: z.number().default(0.2) })).optional(),
  camera: z.record(z.any()).and(z.object({ type: z.string() })),
  transition: z.enum(['cut', 'flash', 'fadeIn', 'whiteIn']).default('cut'),
  narration: z.union([z.string(), z.object({ text: z.string(), at: z.number().default(0.1), voice: z.string().optional() })]).optional(),
  overlays: z.array(OverlaySchema).optional(),
  sfx: z.array(z.object({ id: z.string(), at: z.number().default(0), gain: z.number().optional(), rate: z.number().optional() })).optional(),
  purpose: z.string().optional(), // 'hook' | 'establish' | 'escalate' | 'reveal' | 'reaction' | 'payoff' | 'choice'
  note: z.string().optional(),
}).strict();

export const VideoSchema = z.object({
  title: z.string(),
  branch: z.enum(['main', 'red', 'blue', 'single']).optional(),
  narrator: z.string().optional(),
  captions: z.enum(['all', 'dialogue', 'none']).default('all'),
  shots: z.array(ShotSchema).min(1),
  overlays: z.array(OverlaySchema).default([]),
  score: z.object({ left: z.object({ name: z.string(), color: z.string().optional() }), right: z.object({ name: z.string(), color: z.string().optional() }), timeline: z.array(z.object({ shot: z.union([z.string(), z.number()]).optional(), at: z.number().default(0), left: z.union([z.number(), z.string()]), right: z.union([z.number(), z.string()]), note: z.string().optional() })), until: TimeExpr.optional() }).optional(),
  music: z.object({ style: z.string(), bpm: z.number().optional(), cues: z.array(z.object({ at: z.number(), intensity: z.number(), shot: z.union([z.string(), z.number()]).optional() })).optional(), stopAt: z.number().optional(), key: z.string().optional(), gain: z.number().optional() }).optional(),
  style: z.string().optional(), // visual style preset (shared/styles.ts)
  grade: z.record(z.any()).optional(),
  cover: z.object({ shot: z.union([z.string(), z.number()]), at: z.number().default(0.5) }).optional(),
}).strict();

export const EpisodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  series: z.string().optional(),
  format: z.enum(['red-blue', 'single']).default('red-blue'),
  seed: z.number().int().default(1),
  logline: z.string().optional(),
  hook: z.string().optional(),
  mandatory: z.array(z.string()).default([]), // director's must-haves (checked in review)
  avoid: z.array(z.string()).default([]),
  choice: z.object({ question: z.string(), red: z.string(), blue: z.string() }).optional(),
  characters: z.record(CharacterSchema),
  scenes: z.record(SceneSchema),
  videos: z.record(VideoSchema),
  covers: z.object({ video: z.string().default('main'), shot: z.union([z.string(), z.number()]), at: z.number().default(0.5), label: z.boolean().default(true) }).optional(),
  fps: z.number().default(30),
  width: z.number().default(1080),
  height: z.number().default(1920),
}).strict();

export type Episode = z.infer<typeof EpisodeSchema>;
export type SceneSpec = z.infer<typeof SceneSchema>;
export type VideoSpec = z.infer<typeof VideoSchema>;
export type ShotSpec = z.infer<typeof ShotSchema>;
export type ActionSpec = z.infer<typeof ActionSchema>;
