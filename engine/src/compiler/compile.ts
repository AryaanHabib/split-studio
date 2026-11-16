// Story-to-animation compiler: episode spec (authoring) -> CompiledVideo (executable).
// Responsibilities: resolve timing/markers, plan locomotion, expand crowd actions,
// generate prop trajectories, run physics bakes, map scene events to the edit,
// and report anything that cannot be produced (never silently dropped).
import type { CompiledActor, CompiledScene, CompiledVideo, CompiledShot, CompiledProp, PoseSeg, RootKey, OverlayItem, AudioCue, Vec3, PuppetLook, PhysicsBake, WorldEvent, SampledPath, PropSeg } from '../shared/types';
import { SETS } from '../shared/sets';
import { ACTION_MAP, CAMERA_TYPES, SFX_IDS } from '../shared/vocabulary';
import type { Episode, SceneSpec, ActionSpec, VideoSpec } from './schema';
import { bake, bakeFinal, initPhysics, type BodyInit } from './physics';
import { ARCHETYPE_DEFAULTS, dimsFor } from './looks';
import { resolveStyle, STYLES } from '../shared/styles';

export interface Issue { level: 'error' | 'warning' | 'info'; where: string; msg: string; fix?: string }
export interface TtsLine { key: string; text: string; voice: string; speed: number }
export interface TtsResult { file: string; dur: number; env: number[] }
export type TtsProvider = (lines: TtsLine[]) => Promise<Record<string, TtsResult>>;

const GRAV = 9.81;
const INF = 1e9;
const BODY_CLIPS = new Set(['idle', 'stand', 'crouch', 'celebrate', 'laugh', 'dance', 'panic', 'shock', 'scared', 'shrug', 'facepalm', 'wave', 'pointUp', 'armsCrossed', 'handsOnHips', 'reachUp', 'block', 'balance', 'cry', 'wail', 'sit', 'lie', 'getUp', 'flail', 'stumble', 'sneeze', 'dribble', 'freeze', 'float', 'talkGesture', 'phoneToEar', 'sitPhone', 'thumbsUpLying', 'push', 'hug', 'fall', 'point', 'pileLie']);
const DEFAULT_DUR: Record<string, number> = { shock: 0.9, celebrate: 2, laugh: 1.5, shrug: 1.2, facepalm: 1.4, wave: 1.2, point: 1.2, pointUp: 1.2, sneeze: 1.4, fall: 0.8, getUp: 0.9, push: 0.8, jump: 0.7, crouch: 0.8 };
const PERSIST: Record<string, string> = { fall: 'lie', lie: 'lie', sit: 'sit', cry: 'cry', pileLie: 'pileLie', thumbsUpLying: 'lie', crawl: 'idle' };

export function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const wrapAng = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const D2R = Math.PI / 180;

export function ttsKey(text: string, voice: string, speed: number) { return `${voice}_${hashStr(`${text}|${voice}|${speed}`).toString(16)}`; }

/** Collect every line that needs speech synthesis (pre-pass). */
export function collectTts(ep: Episode): TtsLine[] {
  const out = new Map<string, TtsLine>();
  const charOf = (sceneId: string, actor: string, depth = 0): string | undefined => {
    const sc = ep.scenes[sceneId]; if (!sc || depth > 8) return undefined;
    if (sc.cast[actor]?.char) return sc.cast[actor].char;
    for (const [gid, cr] of Object.entries(sc.crowds)) { const nm = cr.named?.[actor]; if (nm) return nm.char; if (new RegExp(`^${gid}_\\d+$`).test(actor)) return cr.template; }
    if (sc.continueFrom) return charOf(sc.continueFrom.scene, actor, depth + 1);
    return ep.characters[actor] ? actor : undefined;
  };
  for (const [sid, sc] of Object.entries(ep.scenes)) for (const [actor, track] of Object.entries(sc.tracks)) for (const e of track) {
    if (e.do !== 'say') continue;
    const ch = ep.characters[charOf(sid, actor) ?? actor];
    const voice = (e as any).voice ?? ch?.voice ?? 'am_michael'; const speed = (e as any).speed ?? ch?.voiceSpeed ?? 1;
    const key = ttsKey(String((e as any).text), voice, speed); out.set(key, { key, text: String((e as any).text), voice, speed });
  }
  for (const [, v] of Object.entries(ep.videos)) for (const s of v.shots) if (s.narration) {
    const n = typeof s.narration === 'string' ? { text: s.narration } : s.narration as any;
    const voice = n.voice ?? v.narrator ?? 'bm_george'; const key = ttsKey(n.text, voice, 1); out.set(key, { key, text: n.text, voice, speed: 1 });
  }
  return [...out.values()];
}

interface ActorState {
  id: string; name: string; char: string; kind: 'puppet' | 'gltf'; look?: PuppetLook; height: number; model?: string; scale?: number; clipMap?: Record<string, string>;
  x: number; z: number; y: number; h: number; cursor: number;
  keys: RootKey[]; segs: PoseSeg[]; attach: CompiledActor['attach']; physics: CompiledActor['physics']; hidden: [number, number][];
  steps?: string; crowd?: string; seed: number; voice?: string; voicePitch?: number; voiceSpeed?: number; archetype: string; lieDir?: number;
}

interface SceneEvent { t: number; kind: 'sfx' | 'voice'; id: string; fx?: string; gain?: number; rate?: number; file?: string; dur?: number; text?: string; speaker?: string; caption?: boolean; pitch?: number; actor?: string }

class SceneBuilder {
  id: string; spec: SceneSpec; ep: Episode; issues: Issue[]; tts: Record<string, TtsResult>;
  actors = new Map<string, ActorState>();
  groups: Record<string, string[]> = {};
  named = new Set<string>();
  props = new Map<string, CompiledProp & { holder?: string; hand?: string }>();
  paths: Record<string, SampledPath> = {};
  bakes: Record<string, PhysicsBake> = {};
  events: WorldEvent[] = [];
  sounds: SceneEvent[] = [];
  markers: Record<string, number> = {};
  structures: Record<string, string[]> = {};
  gravityEvents: { t: number; g: number }[] = [];
  groupCursor: Record<string, number> = {};
  worldCursor = 0;
  seed: number; r: () => number;
  pathN = 0; bakeN = 0;
  duration = 0;

  constructor(id: string, spec: SceneSpec, ep: Episode, issues: Issue[], tts: Record<string, TtsResult>, private prior: Map<string, SceneBuilder>) {
    this.id = id; this.spec = spec; this.ep = ep; this.issues = issues; this.tts = tts;
    this.seed = (ep.seed * 7919 + hashStr(id)) >>> 0; this.r = rng(this.seed);
  }
  err(where: string, msg: string, fix?: string) { this.issues.push({ level: 'error', where: `${this.id}/${where}`, msg, fix }); }
  warn(where: string, msg: string, fix?: string) { this.issues.push({ level: 'warning', where: `${this.id}/${where}`, msg, fix }); }

  get set() { return SETS[this.spec.set]; }
  gravityAt(t: number) { let g = 1; for (const e of this.gravityEvents) if (e.t <= t + 1e-6) g = e.g; return g * GRAV; }

  // ------------------------------------------------------------ cast
  makeActor(id: string, charId: string, lookOverride: Record<string, any> = {}, crowd?: string): ActorState | null {
    const ch = this.ep.characters[charId];
    if (!ch) { this.err(`cast/${id}`, `Unknown character "${charId}"`, 'Define it under characters.'); return null; }
    const seed = hashStr(`${this.ep.seed}:${id}`);
    let look: PuppetLook | undefined; let height = 1.8;
    if (ch.kind === 'puppet') {
      const arch = ARCHETYPE_DEFAULTS[ch.archetype];
      if (!arch) this.err(`cast/${id}`, `Unknown archetype "${ch.archetype}"`, `Use one of: ${Object.keys(ARCHETYPE_DEFAULTS).join(', ')}`);
      look = { ...(arch ?? ARCHETYPE_DEFAULTS.adult), archetype: ch.archetype, ...ch.look, ...lookOverride } as PuppetLook;
      height = look.height;
    } else {
      if (!ch.model) this.err(`cast/${id}`, 'glTF character without a model path');
      height = 1.7 * (ch.scale ?? 1);
    }
    const a: ActorState = {
      id, name: ch.name ?? id, char: charId, kind: ch.kind, look, height, model: ch.model, scale: ch.scale, clipMap: ch.clipMap,
      x: 0, z: 0, y: 0, h: 0, cursor: 0, keys: [], segs: [], attach: [], physics: [], hidden: [], steps: ch.steps ?? (crowd ? undefined : 'footstep'), crowd, seed: seed % 1000,
      voice: ch.voice, voicePitch: ch.voicePitch, voiceSpeed: ch.voiceSpeed, archetype: ch.archetype,
    };
    this.actors.set(id, a);
    return a;
  }

  place(a: ActorState, x: number, z: number, h: number, y = 0) { a.x = x; a.z = z; a.h = h; a.y = y; a.keys = [{ t: 0, x, y, z, h, d: 0 }]; }

  buildCast() {
    const src = this.spec.continueFrom ? this.prior.get(this.spec.continueFrom.scene) : undefined;
    let tSrc = 0;
    if (this.spec.continueFrom && !src) this.err('continueFrom', `Scene "${this.spec.continueFrom.scene}" must be defined (and compiled) before this one`);
    if (src) {
      tSrc = this.spec.continueFrom!.at === '@end' ? src.duration : (src.time(this.spec.continueFrom!.at, 0) ?? src.duration);
      // inherit everyone from the source scene at tSrc
      for (const [id, sa] of src.actors) {
        const lookOverride = sa.look ? { ...sa.look } : {};
        const a = this.makeActor(id, sa.char, lookOverride, sa.crowd); if (!a) continue;
        const st = src.stateAt(sa, tSrc);
        this.place(a, st.x, st.z, st.h, 0);
        if (st.lying !== undefined) { a.lieDir = st.lying; a.segs.push({ t0: 0, t1: INF, clip: 'lie', layer: 'base', p: { dir: st.lying, held: true }, blend: 0 }); }
        if (sa.hidden.some(([h0, h1]) => tSrc >= h0 && tSrc < h1)) a.hidden.push([0, INF]);
      }
      for (const [g, m] of Object.entries(src.groups)) this.groups[g] = [...m];
      src.named.forEach((n) => this.named.add(n));
      for (const [pid, p] of src.props) {
        const pos = src.propPosAt(pid, tSrc);
        const np: any = { id: pid, kind: p.kind, params: p.params, rest: pos, segs: [] };
        const holder = src.propHolderAt(pid, tSrc);
        if (holder) { np.segs.push({ t0: 0, t1: INF, mode: 'attach', actor: holder.actor, hand: holder.hand }); np.holder = holder.actor; np.hand = holder.hand; }
        this.props.set(pid, np);
      }
    }
    for (const [id, c] of Object.entries(this.spec.cast)) {
      let a = this.actors.get(id);
      if (!a) a = this.makeActor(id, c.char ?? id) ?? undefined; if (!a) continue;
      if (c.at !== undefined || !src) {
        const p = this.target(c.at ?? [0, 0], 0, `cast/${id}`) ?? [0, 0, 0];
        let h = a.h;
        if (typeof c.facing === 'number') h = c.facing * D2R; else if (c.facing !== undefined) { const f = this.target(c.facing, 0, `cast/${id}.facing`); if (f) h = Math.atan2(f[0] - p[0], f[2] - p[2]); }
        this.place(a, p[0], p[2], h, c.y ?? 0);
      }
      if (c.hiddenUntil !== undefined) { const t = this.time(c.hiddenUntil, 0); if (t !== null) a.hidden.push([-1, t]); }
      if (c.hiddenFrom !== undefined) { const t = this.time(c.hiddenFrom, 0); if (t !== null) a.hidden.push([t, INF]); }
    }
    for (const [gid, cr] of Object.entries(this.spec.crowds)) {
      const tmpl = this.ep.characters[cr.template];
      if (!tmpl) { this.err(`crowds/${gid}`, `Unknown template "${cr.template}"`); continue; }
      const members: string[] = [];
      const namedByIndex = new Map<number, [string, string]>();
      for (const [nid, n] of Object.entries(cr.named ?? {})) namedByIndex.set(n.index ?? namedByIndex.size, [nid, n.char]);
      const rr = rng(hashStr(`${this.ep.seed}:${gid}`));
      const cols = cr.cols ?? Math.ceil(Math.sqrt(cr.count * 1.6));
      for (let i = 0; i < cr.count; i++) {
        let x = cr.center[0], z = cr.center[1];
        if (cr.formation === 'grid') { const row = Math.floor(i / cols), col = i % cols; x += (col - (cols - 1) / 2) * cr.spacing + (rr() - 0.5) * 0.12; z += (row - (Math.ceil(cr.count / cols) - 1) / 2) * cr.spacing + (rr() - 0.5) * 0.12; }
        else if (cr.formation === 'line') { x += (i - (cr.count - 1) / 2) * cr.spacing; }
        else if (cr.formation === 'ring') { const a = (i / cr.count) * Math.PI * 2; const rad = cr.radius ?? (cr.count * cr.spacing) / (2 * Math.PI); x += Math.cos(a) * rad; z += Math.sin(a) * rad; }
        else { const a = i * 2.39996; const rad = Math.sqrt(i + 0.5) * cr.spacing * 0.55; x += Math.cos(a) * rad + (rr() - 0.5) * 0.15; z += Math.sin(a) * rad * 0.8 + (rr() - 0.5) * 0.15; }
        const nm = namedByIndex.get(i);
        let a: ActorState | null;
        if (nm) { a = this.actors.get(nm[0]) ?? this.makeActor(nm[0], nm[1], {}, gid); this.named.add(nm[0]); if (a) a.crowd = gid; }
        else {
          const ov: Record<string, any> = {};
          for (const [k, opts] of Object.entries(tmpl.variants ?? {})) ov[k] = opts[Math.floor(rr() * opts.length)];
          if (tmpl.kind === 'puppet') ov.height = ((tmpl.look.height ?? ARCHETYPE_DEFAULTS[tmpl.archetype]?.height ?? 1) as number) * (0.93 + rr() * 0.14);
          a = this.makeActor(`${gid}_${i}`, cr.template, ov, gid);
        }
        if (!a) continue;
        let h = 0; if (typeof cr.facing === 'number') h = cr.facing * D2R; else if (cr.facing) { const f = this.target(cr.facing, 0, `crowds/${gid}`); if (f) h = Math.atan2(f[0] - x, f[2] - z); }
        h += (rr() - 0.5) * 0.4;
        this.place(a, x, z, h);
        members.push(a.id);
      }
      this.groups[gid] = members;
    }
    for (const [sid, st] of Object.entries(this.spec.structures)) {
      const ids: string[] = []; const n = st.split; const bw = st.size[0] / n, bd = st.size[1] / n;
      for (let f = 0; f < st.floors; f++) for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
        const id = `${sid}_${f}_${i}${k}`; const pos: Vec3 = [st.at[0] - st.size[0] / 2 + bw * (i + 0.5), st.floorHeight * (f + 0.5) + 0.001 * f, st.at[1] - st.size[1] / 2 + bd * (k + 0.5)];
        this.props.set(id, { id, kind: 'block', params: { size: [bw - st.gap, st.floorHeight - st.gap * 0.5, bd - st.gap], color: st.color, seed: hashStr(sid) % 997, structure: sid }, rest: pos, segs: [] } as any);
        ids.push(id);
      }
      this.structures[sid] = ids;
    }
    for (const [pid, p] of Object.entries(this.spec.props)) {
      const at = p.at ? (p.at.length === 2 ? [p.at[0], (p.params?.radius ?? 0.12), p.at[1]] : p.at) as Vec3 : [0, 0.12, 0] as Vec3;
      const prop: any = { id: pid, kind: p.kind, params: { radius: 0.12, ...(p.params ?? {}) }, rest: at, segs: [] };
      if (p.heldBy) { prop.segs.push({ t0: 0, t1: INF, mode: 'attach', actor: p.heldBy, hand: p.hand ?? 'both' }); prop.holder = p.heldBy; prop.hand = p.hand ?? 'both'; }
      this.props.set(pid, prop);
    }
  }

  // ------------------------------------------------------------ queries
  time(expr: any, cursor: number): number | null {
    if (expr === undefined) return cursor;
    if (typeof expr === 'number') return expr;
    const s = String(expr).trim();
    if (s.startsWith('+')) return cursor + parseFloat(s.slice(1));
    const m = s.match(/^@([A-Za-z0-9_.]+?)(?:([+-])([0-9.]+))?$/);
    if (!m) { this.err('time', `Bad time expression "${s}"`, 'Use a number, "+0.5", or "@marker(+/-n)"'); return cursor; }
    if (m[1] === 'end') return this.duration || null;
    const base = this.markers[m[1]]; if (base === undefined) return null;
    return base + (m[2] ? (m[2] === '+' ? 1 : -1) * parseFloat(m[3]) : 0);
  }

  stateAt(a: ActorState, t: number): { x: number; z: number; h: number; y: number; lying?: number } {
    const ph = a.physics.find((p) => t >= p.t0);
    if (ph && a.physics.length) { const last = a.physics[a.physics.length - 1]; if (t >= last.t0) { /* use keys (updated to final) */ } }
    const k = evalKeys(a.keys, t);
    let lying: number | undefined;
    const seg = [...a.segs].filter((s) => s.layer === 'base' && s.t0 <= t).sort((p, q) => p.t0 - q.t0).pop();
    if (seg && ['fall', 'lie', 'pileLie', 'thumbsUpLying'].includes(seg.clip) && t < seg.t1 + 0.01) lying = seg.p?.dir ?? -1;
    else if (seg && seg.t1 <= t && PERSIST[seg.clip] === 'lie') lying = seg.p?.dir ?? -1;
    return { x: k.x, z: k.z, h: k.h, y: k.y, lying };
  }

  target(tg: any, t: number, where: string): Vec3 | null {
    if (tg === undefined || tg === null) { this.err(where, 'Missing target'); return null; }
    if (Array.isArray(tg)) return tg.length === 2 ? [tg[0], 0, tg[1]] : [tg[0], tg[1], tg[2]];
    if (typeof tg === 'object') { const b = this.target(tg.target, t, where); if (!b) return null; const o = tg.offset ?? [0, 0, 0]; return [b[0] + o[0], b[1] + o[1], b[2] + o[2]]; }
    const [id, part] = String(tg).split('.');
    const a = this.actors.get(id);
    if (a) {
      const s = this.stateAt(a, t); const f = part === 'head' ? 0.9 : part === 'headTop' ? 1.0 : part === 'feet' ? 0 : part ? 0.55 : 0;
      if (s.lying !== undefined && part) { const fx = Math.sin(s.h), fz = Math.cos(s.h); const along = s.lying * a.height * f * 0.92; return [s.x + fx * along, s.y + a.height * 0.11, s.z + fz * along]; }
      return [s.x, s.y + a.height * f, s.z];
    }
    if (this.groups[id]) { let x = 0, z = 0, n = 0; for (const m of this.groups[id]) { const ma = this.actors.get(m)!; const s = this.stateAt(ma, t); x += s.x; z += s.z; n++; } return [x / n, 0, z / n]; }
    if (this.props.has(id)) return this.propPosAt(id, t);
    const an = this.set?.anchors[id]; if (an) return [...an];
    this.err(where, `Unknown target "${tg}"`, `Use an actor id, crowd name, prop id, [x,z], or a ${this.spec.set} anchor (${Object.keys(this.set?.anchors ?? {}).join(', ')})`);
    return null;
  }

  propPosAt(pid: string, t: number): Vec3 {
    const p = this.props.get(pid)!;
    const seg = [...p.segs].filter((s) => s.t0 <= t).sort((a, b) => a.t0 - b.t0).pop();
    if (!seg) return [...p.rest];
    const tt = Math.min(t, seg.t1);
    if (seg.mode === 'attach' || seg.mode === 'dribble') { const a = this.actors.get(seg.actor!); if (a) { const s = this.stateAt(a, tt); const f = [Math.sin(s.h), Math.cos(s.h)]; const y = seg.hand === 'head' ? a.height + 0.12 : a.height * 0.55; return [s.x + f[0] * 0.3, y, s.z + f[1] * 0.3]; } }
    if (seg.mode === 'path') { const P = this.paths[seg.path!]; const n = P.pos.length / 3; const i = Math.max(0, Math.min(n - 1, Math.round((tt - P.t0) / P.dt))); return [P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2]]; }
    if (seg.mode === 'bake') { const b = this.bakes[seg.bake!]; const nb = b.bodies.length; const f = Math.max(0, Math.min(b.frames - 1, Math.round((tt - b.t0) / b.dt))); const o = (f * nb + seg.body!) * 7; return [b.data[o], b.data[o + 1], b.data[o + 2]]; }
    return [...p.rest];
  }
  propHolderAt(pid: string, t: number) { const p = this.props.get(pid)!; const seg = p.segs.find((s) => t >= s.t0 && t <= s.t1 && (s.mode === 'attach' || s.mode === 'dribble')); return seg ? { actor: seg.actor!, hand: seg.hand ?? 'both' } : null; }

  // ------------------------------------------------------------ timeline primitives
  addKey(a: ActorState, t: number, x: number, y: number, z: number, h: number) {
    const last = a.keys[a.keys.length - 1];
    if (last && t < last.t - 1e-6) this.truncateKeys(a, t);
    const l2 = a.keys[a.keys.length - 1];
    const d = l2 ? l2.d + Math.hypot(x - l2.x, z - l2.z) : 0;
    if (l2 && Math.abs(l2.t - t) < 1e-6) { l2.x = x; l2.y = y; l2.z = z; l2.h = h; l2.d = d; }
    else a.keys.push({ t, x, y, z, h, d });
    a.x = x; a.y = y; a.z = z; a.h = h;
  }
  truncateKeys(a: ActorState, t: number) {
    const k = evalKeys(a.keys, t);
    a.keys = a.keys.filter((q) => q.t < t - 1e-6); a.keys.push({ ...k, t });
    a.x = k.x; a.z = k.z; a.y = k.y; a.h = k.h;
  }
  /** Bring actor to time t. Interrupts in-progress base actions if t < cursor. */
  sync(a: ActorState, t: number) {
    if (t < a.cursor - 1e-6) {
      this.truncateKeys(a, t);
      for (const s of a.segs) if (s.layer === 'base' && s.t1 > t) s.t1 = Math.max(s.t0, t);
      a.segs = a.segs.filter((s) => !(s.layer === 'base' && s.t1 - s.t0 < 1e-4 && s.t0 >= t));
      this.detachAt(a, t);
    } else {
      this.detachAt(a, t);
      const k = evalKeys(a.keys, t); this.addKey(a, t, k.x, k.y, k.z, k.h);
    }
    a.cursor = t;
    const s = this.stateAt(a, t); a.x = s.x; a.z = s.z; a.h = s.h; a.y = s.y;
  }
  /** End any attachment active at t, leaving the actor where it was being carried. */
  detachAt(a: ActorState, t: number) {
    for (const at of a.attach) {
      if (at.t0 <= t && at.t1 > t) {
        const tgt = this.actors.get(at.target);
        if (tgt) {
          const s = this.stateAt(tgt, t); const c = Math.cos(s.h), sn = Math.sin(s.h);
          const x = s.x + c * at.offset[0] + sn * at.offset[2], z = s.z - sn * at.offset[0] + c * at.offset[2];
          a.keys = a.keys.filter((k) => k.t < t - 1e-6); const last = a.keys[a.keys.length - 1];
          a.keys.push({ t, x, y: 0, z, h: s.h + at.heading, d: last ? last.d + Math.hypot(x - last.x, z - last.z) : 0 });
          a.x = x; a.z = z; a.h = s.h + at.heading; a.y = 0;
        }
        at.t1 = Math.max(at.t0, t);
        for (const sg of a.segs) if (sg.layer === 'base' && sg.clip === 'hug' && sg.t1 > t) sg.t1 = Math.max(sg.t0, t);
      }
    }
  }
  seg(a: ActorState, t0: number, t1: number, clip: string, layer: PoseSeg['layer'] = 'base', p?: Record<string, any>, blend?: number) {
    const s: PoseSeg = { t0, t1, clip, layer }; if (p) s.p = p; if (blend !== undefined) s.blend = blend; a.segs.push(s); return s;
  }
  sound(t: number, id: string, gain = 0, extra: Partial<SceneEvent> = {}) { this.sounds.push({ t, kind: 'sfx', id, gain, ...extra }); }

  gaitFor(a: ActorState, kind: 'walk' | 'run') { if (a.archetype === 'toddler') return kind === 'walk' ? 'waddle' : 'toddlerRun'; return kind; }

  /** Trapezoidal-velocity move with heading turn. Returns end time. */
  moveTo(a: ActorState, t0: number, dest: Vec3, speed: number, gait: string, opts: { dur?: number; stopShort?: number; faceEnd?: number; backward?: boolean } = {}) {
    this.sync(a, t0);
    let dx = dest[0] - a.x, dz = dest[2] - a.z; let dist = Math.hypot(dx, dz);
    if (opts.stopShort && dist > opts.stopShort) { const k = (dist - opts.stopShort) / dist; dx *= k; dz *= k; dist -= opts.stopShort; }
    if (dist < 0.03) return t0;
    const ta = Math.min(0.3, dist / speed / 2);
    let T = dist / speed + ta;
    if (opts.dur) { T = opts.dur; }
    const vmax = dist / (T - ta);
    const h0 = a.h, h1 = Math.atan2(dx, dz) + (opts.backward ? Math.PI : 0); const dh = wrapAng(h1 - h0); const turnT = Math.min(T, 0.25 + Math.abs(dh) * 0.12);
    const x0 = a.x, z0 = a.z, y0 = a.y;
    const sAt = (tau: number) => { // distance along path at local time tau
      if (tau <= ta) return 0.5 * (vmax / ta) * tau * tau;
      if (tau >= T - ta) { const r = T - tau; return dist - 0.5 * (vmax / ta) * r * r; }
      return 0.5 * vmax * ta + vmax * (tau - ta);
    };
    const step = 0.1;
    for (let tau = step; tau < T + 1e-6; tau += step) {
      const tt = Math.min(T, tau); const s = Math.min(dist, sAt(tt)) / dist;
      const h = h0 + dh * smooth(tt / turnT);
      this.addKey(a, t0 + tt, x0 + dx * s, y0, z0 + dz * s, h);
    }
    if (opts.faceEnd !== undefined) this.addKey(a, t0 + T + 0.3, a.x, a.y, a.z, opts.faceEnd);
    this.seg(a, t0, t0 + T, gait, 'base', undefined, 0.2);
    if (a.steps) { const stride = a.height * 0.75; let nextD = stride / 2; for (let tau = 0; tau < T; tau += 1 / 60) { if (sAt(tau) >= nextD) { this.sound(t0 + tau, gait.includes('un') || gait === 'sprint' ? (a.steps === 'squeak' ? 'squeak' : a.steps) : a.steps, gait === 'run' || gait === 'sprint' ? -6 : -10, { actor: a.id }); nextD += stride / 2; } } }
    a.cursor = t0 + T + (opts.faceEnd !== undefined ? 0.3 : 0);
    return a.cursor;
  }

  jumpTo(a: ActorState, t0: number, dest: Vec3, apex: number, landY: number, dur?: number, clip = 'jump', p?: Record<string, any>) {
    this.sync(a, t0);
    const x0 = a.x, z0 = a.z, y0 = a.y; const dx = dest[0] - x0, dz = dest[2] - z0; const dist = Math.hypot(dx, dz);
    const T = dur ?? Math.max(0.55, 0.45 + Math.sqrt(Math.max(apex, 0.1)) * 0.35 + dist * 0.06);
    const h = dist > 0.05 ? Math.atan2(dx, dz) : a.h;
    // body crouches for the first 20% then takes off; root arc spans 20%..85%
    const n = Math.ceil(T * 30);
    for (let i = 1; i <= n; i++) {
      const u = i / n; const tt = t0 + u * T;
      const w = Math.max(0, Math.min(1, (u - 0.2) / 0.65));
      const y = y0 + (landY - y0) * w + 4 * apex * w * (1 - w);
      this.addKey(a, tt, x0 + dx * w, y, z0 + dz * w, a.h + wrapAng(h - a.h) * Math.min(1, u * 4));
    }
    this.seg(a, t0, t0 + T, clip, 'base', p, 0.12);
    a.cursor = t0 + T;
    return a.cursor;
  }

  // ------------------------------------------------------------ props
  newPath(points: Vec3[], t0: number, dt: number, spin?: Vec3) { const id = `p${this.pathN++}`; this.paths[id] = { t0, dt, pos: points.flat(), spin }; return id; }
  propSeg(pid: string, seg: PropSeg) {
    const p = this.props.get(pid); if (!p) { this.err(`prop/${pid}`, `Unknown prop "${pid}"`); return; }
    for (const s of p.segs) if (s.t1 > seg.t0) s.t1 = seg.t0; // later segments override
    p.segs = p.segs.filter((s) => s.t1 > s.t0);
    p.segs.push(seg);
    p.holder = seg.mode === 'attach' || seg.mode === 'dribble' ? seg.actor : undefined; p.hand = seg.hand;
  }
  /** Ballistic arc through a list of points. Returns {end time, end velocity}. */
  arc(points: Vec3[], apexes: number[], t0: number) {
    const pts: Vec3[] = []; let t = t0; let vEnd: Vec3 = [0, 0, 0];
    for (let i = 0; i < points.length - 1; i++) {
      const P0 = points[i], P1 = points[i + 1];
      const top = Math.max(P0[1], P1[1]) + (apexes[i] ?? 1);
      const vy0 = Math.sqrt(2 * GRAV * (top - P0[1])); const tu = vy0 / GRAV; const td = Math.sqrt(2 * (top - P1[1]) / GRAV); const T = tu + td;
      const vx = (P1[0] - P0[0]) / T, vz = (P1[2] - P0[2]) / T;
      const n = Math.max(2, Math.ceil(T * 60));
      for (let k = (i === 0 ? 0 : 1); k <= n; k++) { const tau = (k / n) * T; pts.push([P0[0] + vx * tau, P0[1] + vy0 * tau - 0.5 * GRAV * tau * tau, P0[2] + vz * tau]); }
      vEnd = [vx, vy0 - GRAV * T, vz]; t += T;
    }
    return { pts, t1: t, vEnd };
  }
  flight(pid: string, t0: number, points: Vec3[], apexes: number[]) {
    const { pts, t1, vEnd } = this.arc(points, apexes, t0);
    const dir = [vEnd[0], vEnd[2]]; const spinAxis: Vec3 = [-dir[1] * 6, 0, dir[0] * 6];
    const path = this.newPath(pts, t0, (t1 - t0) / (pts.length - 1), spinAxis);
    this.propSeg(pid, { t0, t1, mode: 'path', path });
    return { t1, vEnd };
  }
  simulateProp(pid: string, t0: number, pos: Vec3, vel: Vec3, dur = 3.5, extraObstacles: any[] = []) {
    const p = this.props.get(pid)!; const r = p.params.radius ?? 0.12;
    const id = `${this.id}_b${this.bakeN++}`;
    const b = bake({ id, set: this.spec.set, t0, dur, gravity: this.gravityAt(t0), seed: this.seed, bodies: [{ id: pid, shape: 'ball', size: [r, 0, 0], pos, linvel: vel, restitution: p.kind === 'ball' ? 0.72 : 0.25, friction: 0.5, density: p.kind === 'ball' ? 0.6 : 1, angularDamping: 0.8, linearDamping: 0.08 }], obstacles: extraObstacles });
    this.bakes[id] = b;
    this.propSeg(pid, { t0, t1: t0 + dur, mode: 'bake', bake: id, body: 0 });
    p.rest = bakeFinal(b, 0).pos;
    for (const c of b.contacts) {
      if (c.impulse < 0.6) continue;
      const other = c.a === pid ? c.b : c.a;
      const g = Math.max(-26, Math.min(0, 20 * Math.log10(c.impulse / 6)));
      this.sound(c.t, other === 'rim' ? 'rim' : other === 'backboard' ? 'rim' : p.kind === 'ball' ? 'bounce' : 'thud', g + (other === 'rim' ? 0 : -2), { rate: other === 'backboard' ? 0.7 : 1 });
    }
    return b;
  }

  // ------------------------------------------------------------ physics bodies for actors
  actorBody(a: ActorState, t: number, idx: number, linvel: Vec3 = [0, 0, 0], angvel: Vec3 = [0, 0, 0]): BodyInit {
    const s = this.stateAt(a, t); const d = dimsFor(a.look, a.height);
    const q = quatY(s.h);
    return { id: a.id, shape: 'box', size: [d.halfW, a.height / 2, d.halfD], pos: [s.x, s.y + a.height / 2, s.z], quat: q, linvel, angvel, restitution: 0.15, friction: 0.9, density: 1, angularDamping: 0.6, linearDamping: 0.1 };
  }
  applyBake(members: ActorState[], b: PhysicsBake, t0: number, dur: number) {
    members.forEach((a, i) => {
      this.sync(a, t0);
      a.physics.push({ t0, t1: INF, bake: b.id, body: i });
      this.seg(a, t0, t0 + Math.min(dur, 1.6), 'flail', 'base', undefined, 0.1);
      this.seg(a, t0 + Math.min(dur, 1.6), t0 + dur, 'stand', 'base', undefined, 0.5);
      const f = bakeFinal(b, i);
      // resting orientation -> heading + whether face up
      const up = rotate(f.quat, [0, 1, 0]), fwd = rotate(f.quat, [0, 0, 1]);
      const faceUp = fwd[1] > 0; const dir = faceUp ? -1 : 1;
      const headDir = [up[0], up[2]]; const h = faceUp ? Math.atan2(-headDir[0], -headDir[1]) : Math.atan2(headDir[0], headDir[1]);
      // feet position: body center - up * H/2 projected
      const fx = f.pos[0] - up[0] * a.height * 0.45 * 0, fz = f.pos[2] - up[2] * a.height * 0.45 * 0;
      a.keys.push({ t: t0 + dur, x: fx, y: 0, z: fz, h, d: (a.keys[a.keys.length - 1]?.d ?? 0) });
      a.x = fx; a.z = fz; a.h = h; a.y = 0; a.lieDir = dir; a.cursor = t0 + dur;
    });
  }

  // ------------------------------------------------------------ tracks
  compileTracks() {
    const tracks = Object.entries(this.spec.tracks);
    const pos: Record<string, number> = {}; tracks.forEach(([k]) => (pos[k] = 0));
    let progress = true; let guard = 0;
    while (progress && guard++ < 500) {
      progress = false;
      for (const [key, list] of tracks) {
        while (pos[key] < list.length) {
          const e = list[pos[key]];
          const ok = this.runEntry(key, e, `tracks/${key}[${pos[key]}]`);
          if (!ok) break; pos[key]++; progress = true;
        }
      }
    }
    for (const [key, list] of tracks) if (pos[key] < list.length) this.err(`tracks/${key}[${pos[key]}]`, `Could not resolve timing "${(list[pos[key]] as any).at}" (unknown or circular marker)`, `Markers defined: ${Object.keys(this.markers).join(', ') || 'none'}`);
  }

  cursorOf(key: string) { if (key === 'world') return this.worldCursor; if (this.groups[key]) return this.groupCursor[key] ?? 0; return this.actors.get(key)?.cursor ?? 0; }

  /** returns false if timing can't be resolved yet */
  runEntry(key: string, e: ActionSpec, where: string): boolean {
    const cursor = this.cursorOf(key);
    const t0 = this.time(e.at, cursor);
    if (t0 === null) return false;
    const def = ACTION_MAP.get(e.do);
    if (!def) { this.err(where, `Unknown action "${e.do}"`, 'See docs/VOCABULARY.md. If this is needed, it must be added to the engine (new clip or behaviour).'); return true; }
    const P = e as any;
    let tEnd: number | null = null; const marks: Record<string, number> = {};
    if (key === 'world') {
      tEnd = this.world(e, t0, where);
      this.worldCursor = Math.max(this.worldCursor, tEnd ?? t0);
    } else if (this.groups[key]) {
      if (def.kind !== 'group' && !e.do.startsWith('group:') && e.do !== 'group:collapse') {
        // apply a single-actor action to every member (convenience)
        tEnd = this.groupAction({ ...P, do: 'group:do', action: e.do }, key, t0, where, marks);
      } else tEnd = this.groupAction(P, key, t0, where, marks);
      if (tEnd !== null) this.groupCursor[key] = Math.max(this.groupCursor[key] ?? 0, tEnd);
    } else {
      const a = this.actors.get(key);
      if (!a) { this.err(where, `Track "${key}" is not an actor, crowd or "world"`); return true; }
      if (a.kind === 'gltf' && def.kind === 'body' && !def.gltf) this.err(where, `"${e.do}" is not available for imported model "${a.char}"`, `glTF actors support: ${[...ACTION_MAP.values()].filter((d) => d.gltf).map((d) => d.name).join(', ')}`);
      tEnd = this.actorAction(a, P, t0, where, marks);
    }
    if (e.mark) { this.markers[e.mark] = t0; this.markers[`${e.mark}.end`] = tEnd ?? t0; for (const [k, v] of Object.entries(marks)) this.markers[`${e.mark}.${k}`] = v; }
    return true;
  }

  world(e: any, t: number, where: string): number {
    switch (e.do) {
      case 'sound': if (!SFX_IDS.includes(e.id)) this.err(where, `Unknown sound "${e.id}"`, `Available: ${SFX_IDS.join(', ')}`); this.sound(t, e.id, e.gain ?? 0, { rate: e.rate, dur: e.dur }); break;
      case 'lights': case 'crowd': case 'swish': case 'door': case 'phoneRing': case 'flicker': case 'gravityDial': case 'spotTarget': {
        const p = { ...e }; delete p.do; delete p.at; delete p.mark; this.events.push({ t, kind: e.do, p }); break;
      }
      case 'gravity': {
        this.gravityEvents.push({ t, g: e.value ?? 1 }); this.gravityEvents.sort((a, b) => a.t - b.t);
        this.events.push({ t, kind: 'gravity', p: { value: e.value ?? 1 } }); this.events.push({ t, kind: 'gravityDial', p: { value: e.value ?? 1 } });
        break;
      }
      case 'collapse': {
        // structural failure: trigger is scripted, the collapse itself is simulated by the solver
        const ids: string[] = []; for (const sid of e.structures ?? []) { if (!this.structures[sid]) this.err(where, `Unknown structure "${sid}"`, `Known: ${Object.keys(this.structures).join(', ') || 'none'}`); else ids.push(...this.structures[sid]); }
        if (!ids.length) return t;
        const dur = e.dur ?? 5; const jit = e.jitter ?? 1.2; const rr = rng(hashStr(`${where}:${t}`));
        const kick: Vec3 = e.kick ?? [0, 0, 0];
        const bodies: BodyInit[] = ids.map((pid) => {
          const p = this.props.get(pid)! as any; const pos = this.propPosAt(pid, t); const sz = p.params.size; const floor = parseInt(pid.split('_').slice(-2)[0]);
          const st = this.spec.structures[p.params.structure]; const rel = floor / Math.max(1, st.floors - 1);
          // failed joints: blocks move apart (outward from the core, stronger higher up) and slide freely
          const dx = pos[0] - st.at[0], dz = pos[2] - st.at[1], L = Math.hypot(dx, dz) || 1;
          const out = jit * (0.6 + rel * 2.4);
          let v: Vec3 = [dx / L * out + (rr() - 0.5) * jit, -rel * jit * 0.5, dz / L * out + (rr() - 0.5) * jit];
          let removeAt: number | undefined;
          if ((e.mode ?? 'crumble') === 'crumble') {
            // progressive failure: the lower floors give way one after another
            const failFloors = Math.max(1, Math.round(st.floors * (e.failFraction ?? 0.45)));
            if (floor < failFloors) removeAt = t + floor * (e.interval ?? 0.16) + rr() * 0.05;
            v = [dx / L * out * 0.25 + (rr() - 0.5) * jit * 0.4, 0, dz / L * out * 0.25 + (rr() - 0.5) * jit * 0.4];
          }
          if (e.mode === 'topple') v = [kick[0] * rel + (rr() - 0.5) * 0.3, kick[1], kick[2] * rel + (rr() - 0.5) * 0.3];
          return { id: pid, shape: 'box', size: [sz[0] / 2 * 0.97, sz[1] / 2 * 0.97, sz[2] / 2 * 0.97], pos, linvel: v, angvel: [(rr() - 0.5) * 1.6, (rr() - 0.5) * 0.6, (rr() - 0.5) * 1.6], restitution: 0.05, friction: e.friction ?? 0.35, density: 2, angularDamping: 0.3, linearDamping: e.damping ?? 0.1, removeAt } as BodyInit;
        });
        const id = `${this.id}_b${this.bakeN++}`; const b = bake({ id, set: this.spec.set, t0: t, dur, gravity: e.gravity !== undefined ? e.gravity * GRAV : this.gravityAt(t), seed: this.seed, bodies, sampleHz: 60 });
        this.bakes[id] = b; ids.forEach((pid, i) => { const ra = bodies[i].removeAt; this.propSeg(pid, { t0: t, t1: INF, mode: 'bake', bake: id, body: i }); if (ra !== undefined) { this.propSeg(pid, { t0: ra, t1: INF, mode: 'hidden' }); this.sound(ra, 'impact', -10 - rr() * 6); } this.props.get(pid)!.rest = ra !== undefined ? [0, -100, 0] : bakeFinal(b, i).pos; });
        let last = -1; for (const c of b.contacts) { if (c.impulse < 2 || c.t - last < 0.07) continue; last = c.t; this.sound(c.t, c.impulse > 12 ? 'impact' : 'thud', Math.max(-20, 20 * Math.log10(c.impulse / 20))); }
        this.sound(t, 'rumble', -2, { dur: Math.min(dur, 4) });
        return t + dur;
      }
      case 'dropProps': {
        const ids: string[] = e.props ?? []; const bodies: BodyInit[] = ids.map((pid) => { const p = this.props.get(pid)!; const pos = this.propPosAt(pid, t); const s = p.params.size ?? 0.4; return { id: pid, shape: p.kind === 'ball' || p.kind === 'sphere' ? 'ball' : 'box', size: p.kind === 'ball' || p.kind === 'sphere' ? [p.params.radius ?? 0.2, 0, 0] : (Array.isArray(s) ? [s[0] / 2, s[1] / 2, s[2] / 2] : [s / 2, s / 2, s / 2]), pos, linvel: [(this.r() - 0.5) * 0.5, 0, (this.r() - 0.5) * 0.5], restitution: 0.3, density: 1 } as BodyInit; });
        const id = `${this.id}_b${this.bakeN++}`; const b = bake({ id, set: this.spec.set, t0: t, dur: e.dur ?? 3, gravity: e.gravity !== undefined ? e.gravity * GRAV : this.gravityAt(t), seed: this.seed, bodies });
        this.bakes[id] = b; ids.forEach((pid, i) => { this.propSeg(pid, { t0: t, t1: t + (e.dur ?? 3), mode: 'bake', bake: id, body: i }); this.props.get(pid)!.rest = bakeFinal(b, i).pos; });
        for (const c of b.contacts) if (c.impulse > 1) this.sound(c.t, 'thud', Math.max(-24, 20 * Math.log10(c.impulse / 8)));
        return t + (e.dur ?? 3);
      }
      default: this.err(where, `"${e.do}" is not a world action`);
    }
    return t;
  }

  actorAction(a: ActorState, e: any, t0: number, where: string, marks: Record<string, number>): number | null {
    const tg = (x: any) => this.target(x, t0, where);
    switch (e.do) {
      case 'walkTo': case 'runTo': {
        const d = tg(e.to); if (!d) return t0;
        const gait = e.gait ?? this.gaitFor(a, e.do === 'walkTo' ? 'walk' : 'run');
        const speed = e.speed ?? (e.do === 'walkTo' ? (a.archetype === 'toddler' ? 0.9 : 1.4) : (a.archetype === 'toddler' ? 2.4 : 4.5));
        const faceEnd = e.faceEnd !== undefined ? this.faceHeading(a, e.faceEnd, t0, where) : undefined;
        return this.moveTo(a, t0, d, speed, gait, { dur: e.dur, stopShort: e.stopShort, faceEnd, backward: e.backward });
      }
      case 'moveAlong': {
        let t = t0; const gait = e.gait ?? this.gaitFor(a, 'walk');
        for (const wp of e.path ?? []) { const d = tg(wp); if (d) t = this.moveTo(a, t, d, e.speed ?? 1.4, gait); }
        return t;
      }
      case 'chase': {
        const tgt = this.actors.get(e.target); if (!tgt) { this.err(where, `chase target "${e.target}" is not an actor`); return t0; }
        const dur = e.dur ?? 2; const s = this.stateAt(tgt, t0 + dur); const gap = e.gap ?? 0.8;
        const dx = s.x - a.x, dz = s.z - a.z, L = Math.hypot(dx, dz) || 1;
        return this.moveTo(a, t0, [s.x - (dx / L) * gap, 0, s.z - (dz / L) * gap], 4, e.gait ?? this.gaitFor(a, 'run'), { dur });
      }
      case 'flee': {
        const f = tg(e.from); if (!f) return t0; this.sync(a, t0); const dx = a.x - f[0], dz = a.z - f[2], L = Math.hypot(dx, dz) || 1; const dist = e.distance ?? 5;
        return this.moveTo(a, t0, [a.x + (dx / L) * dist, 0, a.z + (dz / L) * dist], e.speed ?? 4.5, e.gait ?? (a.archetype === 'toddler' ? 'toddlerRun' : 'panicRun'));
      }
      case 'turnTo': {
        this.sync(a, t0); const h1 = this.faceHeading(a, e.target ?? e.heading, t0, where); const dur = e.dur ?? 0.4;
        const n = 6; const h0 = a.h; const dh = wrapAng(h1 - h0);
        for (let i = 1; i <= n; i++) this.addKey(a, t0 + (i / n) * dur, a.x, a.y, a.z, h0 + dh * smooth(i / n));
        this.seg(a, t0, t0 + dur, 'idle'); a.cursor = t0 + dur; return a.cursor;
      }
      case 'jumpTo': { const d = tg(e.to); if (!d) return t0; return this.jumpTo(a, t0, d, e.height ?? 0.5, e.landY ?? 0, e.dur, e.clip ?? 'jump'); }
      case 'jump': { this.sync(a, t0); return this.jumpTo(a, t0, [a.x, 0, a.z], e.height ?? 0.5, a.y, e.dur); }
      case 'teleport': {
        // takes effect exactly at t0 (old position held until t0-0.5ms) so others can reference it at the same marker
        const d = tg(e.to); if (!d) return t0;
        this.sync(a, Math.max(0, t0 - 0.0005));
        const tmp = { ...a, x: d[0], z: d[2] } as ActorState;
        const h = e.heading !== undefined ? e.heading * D2R : e.facing !== undefined ? this.faceHeading(tmp, e.facing, t0, where) : a.h;
        this.addKey(a, t0, d[0], e.y ?? d[1] ?? 0, d[2], h); a.cursor = t0; return a.cursor;
      }
      case 'attachTo': {
        this.sync(a, t0); const dur = e.dur ?? INF;
        a.attach.push({ t0, t1: t0 + dur, target: e.target, offset: e.offset ?? [0, 0, 0.3], heading: (e.heading ?? 0) * D2R });
        this.seg(a, t0, t0 + dur, e.pose ?? 'hug', 'base', undefined, 0.1); a.cursor = t0 + (dur >= INF ? 0.01 : dur); return a.cursor;
      }
      case 'ragdoll': {
        this.sync(a, t0); const dur = e.dur ?? 2.5;
        const id = `${this.id}_b${this.bakeN++}`;
        const b = bake({ id, set: this.spec.set, t0, dur, gravity: this.gravityAt(t0), seed: this.seed, bodies: [this.actorBody(a, t0, 0, e.impulse ?? [0, 2, -2], e.spin ?? [3, 0, 0])], obstacles: this.obstaclesExcept([a.id], t0) });
        this.bakes[id] = b; this.applyBake([a], b, t0, dur); this.contactSounds(b, 'thud');
        return t0 + dur;
      }
      case 'say': {
        const ch = this.ep.characters[a.char]; const voice = e.voice ?? ch?.voice ?? 'am_michael'; const speed = e.speed ?? ch?.voiceSpeed ?? 1;
        const key = ttsKey(String(e.text), voice, speed); const r = this.tts[key];
        if (!r) { this.err(where, `No synthesized audio for line "${e.text}"`, 'Run the TTS step (studio produce runs it automatically).'); return null; }
        const pitch = e.pitch ?? ch?.voicePitch ?? 0;
        this.sounds.push({ t: t0, kind: 'voice', id: key, file: r.file, dur: r.dur, text: e.text, speaker: e.speaker ?? a.name, caption: e.caption ?? true, pitch, actor: a.id, fx: e.fx, gain: e.gain });
        this.seg(a, t0, t0 + r.dur, 'talk', 'mouth', { env: r.env });
        marks.done = t0 + r.dur;
        if (e.wait) { this.sync(a, Math.max(a.cursor, t0)); this.seg(a, a.cursor, t0 + r.dur, e.gesture ?? 'idle'); a.cursor = t0 + r.dur; return a.cursor; }
        return null;
      }
      case 'face': { this.seg(a, t0, e.dur ? t0 + e.dur : INF, e.expr ?? 'neutral', 'face'); return null; }
      case 'lookAt': { this.seg(a, t0, e.dur === 'hold' ? INF : t0 + (e.dur ?? 1.5), 'look', 'look', { target: e.target, snap: e.snap }); return null; }
      case 'hold': { this.propSeg(e.prop, { t0, t1: INF, mode: 'attach', actor: a.id, hand: e.hand ?? 'both' }); return null; }
      case 'release': {
        const pos = this.propPosAt(e.prop, t0); this.simulateProp(e.prop, t0, [pos[0], Math.max(pos[1], 0.6), pos[2]], e.vel ?? [0, 0, 0]); return null;
      }
      case 'pickUp': {
        const pp = this.propPosAt(e.prop, t0); this.sync(a, t0); let t = t0;
        if (Math.hypot(pp[0] - a.x, pp[2] - a.z) > 0.7) t = this.moveTo(a, t0, pp, a.archetype === 'toddler' ? 1.0 : 1.6, this.gaitFor(a, 'walk'), { stopShort: 0.45 });
        this.seg(a, t, t + 0.8, 'crouch', 'base', undefined, 0.15);
        this.propSeg(e.prop, { t0: t + 0.4, t1: INF, mode: 'attach', actor: a.id, hand: e.hand ?? 'both' });
        this.seg(a, t + 0.4, t + 3.0, 'holdBall', 'upper');
        a.cursor = t + 0.8; return a.cursor;
      }
      case 'grab': {
        this.sync(a, t0); const pid = e.prop ?? 'ball'; const from = this.propPosAt(pid, t0);
        const f = [Math.sin(a.h), Math.cos(a.h)]; const to: Vec3 = [a.x + f[0] * 0.25, a.height * 0.55, a.z + f[1] * 0.25];
        const fl = this.flight(pid, t0, [from, to], [e.apex ?? 0.25]);
        this.propSeg(pid, { t0: fl.t1, t1: INF, mode: 'attach', actor: a.id, hand: e.hand ?? 'both' });
        this.seg(a, t0, fl.t1 + 0.4, 'push', 'base', undefined, 0.08); this.seg(a, fl.t1, fl.t1 + (e.hold ?? 2), 'holdBall', 'upper');
        this.sound(fl.t1, 'pop', -6); marks.arrive = fl.t1;
        a.cursor = fl.t1 + 0.4; return a.cursor;
      }
      case 'dribbleTo': {
        const d = tg(e.to); if (!d) return t0; const gait = e.gait ?? 'run'; const speed = e.speed ?? (gait === 'run' ? 4.2 : 1.6);
        const t1 = this.moveTo(a, t0, d, speed, gait, { stopShort: e.stopShort });
        const freq = gait === 'run' ? 2.6 : 2.0;
        this.seg(a, t0, t1, 'dribble', 'upper', { freq });
        this.propSeg(e.prop, { t0, t1, mode: 'dribble', actor: a.id, hand: 'R', freq });
        for (let k = 0; (k + 0.5) / freq < t1 - t0; k++) this.sound(t0 + (k + 0.5) / freq, 'bounce', -8);
        this.propSeg(e.prop, { t0: t1, t1: INF, mode: 'attach', actor: a.id, hand: 'both' });
        this.seg(a, t1, t1 + 0.6, 'holdBall', 'upper');
        return t1;
      }
      case 'dribble': {
        this.sync(a, t0); const dur = e.dur ?? 2; const freq = e.freq ?? 2.2;
        this.seg(a, t0, t0 + dur, 'dribble', 'base', { freq });
        const pid = e.prop ?? [...this.props.values()].find((p) => p.holder === a.id)?.id;
        if (pid) { this.propSeg(pid, { t0, t1: t0 + dur, mode: 'dribble', actor: a.id, hand: 'R', freq }); for (let k = 0; (k + 0.5) / freq < dur; k++) this.sound(t0 + (k + 0.5) / freq, 'bounce', -8); this.propSeg(pid, { t0: t0 + dur, t1: INF, mode: 'attach', actor: a.id, hand: 'both' }); }
        a.cursor = t0 + dur; return a.cursor;
      }
      case 'shoot': {
        this.sync(a, t0); const pid = e.prop ?? 'ball'; const outcome = e.outcome ?? 'make'; const jump = e.jump ?? 1;
        const hoop = this.target(e.target ?? 'hoop', t0, where) ?? [0, 3.05, -12.6];
        // face the hoop first
        const hh = Math.atan2(hoop[0] - a.x, hoop[2] - a.z);
        if (Math.abs(wrapAng(hh - a.h)) > 0.2) { const n = 5; const h0 = a.h; const dh = wrapAng(hh - h0); for (let i = 1; i <= n; i++) this.addKey(a, t0 + i * 0.05, a.x, a.y, a.z, h0 + dh * (i / n)); }
        const dur = 1.25; const rel = t0 + 0.55;
        this.seg(a, t0, t0 + dur, 'shoot', 'base', { jump }, 0.12);
        if (this.props.get(pid)?.holder !== a.id) this.propSeg(pid, { t0, t1: rel, mode: 'attach', actor: a.id, hand: 'both' });
        else { const p = this.props.get(pid)!; for (const s of p.segs) if (s.t1 > rel) s.t1 = rel; }
        const f = [Math.sin(hh), Math.cos(hh)];
        const P0: Vec3 = [a.x + f[0] * 0.3, a.height * 1.18 + a.height * 0.2 * jump * 0.9, a.z + f[1] * 0.3];
        const toShooter = [-f[0], -f[1]];
        const apex = e.apex ?? 1.1;
        let arrive = rel;
        if (outcome === 'make' || outcome === 'swish') {
          const fl = this.flight(pid, rel, [P0, [hoop[0], hoop[1] + 0.06, hoop[2]]], [apex]);
          arrive = fl.t1; this.throughNet(pid, hoop, arrive, fl.vEnd);
        } else if (outcome === 'miss') {
          const side = e.side ?? 'front';
          const off = side === 'back' ? -0.2 : 0.2; const P1: Vec3 = [hoop[0] + toShooter[0] * off + (e.lateral ?? 0.05), hoop[1] + 0.06, hoop[2] + toShooter[1] * off];
          const fl = this.flight(pid, rel, [P0, P1], [apex]); arrive = fl.t1;
          this.simulateProp(pid, arrive, P1, fl.vEnd, e.simDur ?? 4);
        } else { // airball / short
          const short = e.short ?? 1.6; const P1: Vec3 = [hoop[0] + toShooter[0] * short, hoop[1] - 0.6, hoop[2] + toShooter[1] * short];
          const fl = this.flight(pid, rel, [P0, P1], [apex * 0.7]); arrive = fl.t1; this.simulateProp(pid, arrive, P1, fl.vEnd, e.simDur ?? 3);
        }
        this.sound(rel, 'whoosh', -16, { rate: 1.4 });
        marks.release = rel; marks.arrive = arrive;
        a.cursor = t0 + dur; return a.cursor;
      }
      case 'dunk': {
        const pid = e.prop ?? 'ball'; const hoop = this.target(e.target ?? 'hoop', t0, where) ?? [0, 3.05, -12.6];
        this.sync(a, t0); const dx = a.x - hoop[0], dz = a.z - hoop[2]; const L = Math.hypot(dx, dz) || 1; const ux = dx / L, uz = dz / L;
        let t = t0;
        if (L > 2.2) t = this.moveTo(a, t0, [hoop[0] + ux * 2.0, 0, hoop[2] + uz * 2.0], 4.5, 'run');
        if (this.props.get(pid)?.holder !== a.id) this.propSeg(pid, { t0: t0, t1: INF, mode: 'attach', actor: a.id, hand: 'both' });
        const reach = a.height * 1.28; const apexH = Math.max(0.4, hoop[1] + 0.25 - reach);
        const tj = this.jumpTo(a, t, [hoop[0] + ux * 0.55, 0, hoop[2] + uz * 0.55], apexH, 0, 1.15, 'dunk');
        const peak = t + 1.15 * 0.52;
        const pPeak: Vec3 = [hoop[0] + ux * 0.25, hoop[1] + 0.3, hoop[2] + uz * 0.25];
        const path = this.newPath([pPeak, [hoop[0], hoop[1] + 0.1, hoop[2]]], peak, 0.12);
        this.propSeg(pid, { t0: peak, t1: peak + 0.12, mode: 'path', path });
        this.throughNet(pid, hoop, peak + 0.12, [0, -6, 0]);
        this.sound(peak + 0.12, 'rim', -2, { rate: 0.8 }); this.sound(peak + 0.1, 'hit', -6);
        marks.release = peak; marks.arrive = peak + 0.12;
        return tj;
      }
      case 'throw': {
        this.sync(a, t0); const pid = e.prop ?? 'ball'; const under = e.style === 'under';
        const dest = tg(e.to); if (!dest) return t0;
        const hh = Math.atan2(dest[0] - a.x, dest[2] - a.z);
        { const n = 4; const h0 = a.h; const dh = wrapAng(hh - h0); for (let i = 1; i <= n; i++) this.addKey(a, t0 + i * 0.05, a.x, a.y, a.z, h0 + dh * (i / n)); }
        const dur = 0.95; const rel = t0 + (under ? 0.5 : 0.42);
        this.seg(a, t0, t0 + dur, under ? 'throwUnder' : 'throw', 'base', undefined, 0.1);
        if (this.props.get(pid)?.holder !== a.id) this.propSeg(pid, { t0, t1: rel, mode: 'attach', actor: a.id, hand: under ? 'both' : 'R' });
        const f = [Math.sin(hh), Math.cos(hh)];
        const P0: Vec3 = [a.x + f[0] * 0.4, a.height * (under ? 0.6 : 0.95), a.z + f[1] * 0.4];
        const pts: Vec3[] = [P0]; const apexes: number[] = [];
        for (const v of e.via ?? []) { const vp = tg(v); if (vp) { pts.push(vp); apexes.push(e.viaApex ?? 0.8); } }
        let finalP = dest; if (e.to === 'hoop' || e.to === 'rim') finalP = [dest[0], dest[1] + 0.06, dest[2]];
        pts.push(finalP); apexes.unshift(e.apex ?? 1.0); while (apexes.length < pts.length - 1) apexes.push(e.viaApex ?? 0.8);
        const fl = this.flight(pid, rel, pts, apexes.slice(0, pts.length - 1));
        // via-point contact sounds
        { let tt = rel; for (let i = 0; i < pts.length - 2; i++) { const seg = this.arc([pts[i], pts[i + 1]], [apexes[i]], tt); tt = seg.t1; this.sound(tt, e.viaSound ?? 'boing', -3); marks[`via${i}`] = tt; } }
        marks.release = rel; marks.arrive = fl.t1;
        const then = e.then ?? ((e.to === 'hoop' || e.to === 'rim') ? 'make' : 'simulate');
        if (then === 'make') this.throughNet(pid, dest, fl.t1, fl.vEnd);
        else if (then === 'catch' && this.actors.get(e.to)) this.propSeg(pid, { t0: fl.t1, t1: INF, mode: 'attach', actor: e.to, hand: 'both' });
        else if (then === 'simulate') this.simulateProp(pid, fl.t1, finalP, fl.vEnd);
        this.sound(rel, 'whoosh', -18, { rate: 1.3 });
        a.cursor = t0 + dur; return a.cursor;
      }
      case 'point': {
        this.sync(a, t0); const d = tg(e.target); const dur = e.dur ?? 1.2; let yaw = 0;
        if (d) yaw = wrapAng(Math.atan2(d[0] - a.x, d[2] - a.z) - a.h);
        this.seg(a, t0, t0 + dur, 'point', 'base', { yaw: Math.max(-1.2, Math.min(1.2, yaw)) }); a.cursor = t0 + dur; return a.cursor;
      }
      case 'fall': {
        this.sync(a, t0); const dur = e.dur ?? 0.8; const dir = e.dir ?? -1;
        this.seg(a, t0, t0 + dur, 'fall', 'base', { dir }, 0.05); a.lieDir = dir;
        this.sound(t0 + Math.min(0.62, dur * 0.8), a.height > 1.5 ? 'bigThud' : 'thud', a.height > 1.5 ? 0 : -8);
        a.cursor = t0 + dur; return a.cursor;
      }
      default: {
        if (e.do.startsWith('upper:')) { const clip = e.do.slice(6); this.seg(a, t0, t0 + (e.dur ?? 1.0), clip, 'upper', { freq: e.freq, yaw: e.yaw }); if (clip === 'dribble' && e.prop) this.propSeg(e.prop, { t0, t1: t0 + (e.dur ?? 1), mode: 'dribble', actor: a.id, hand: 'R', freq: e.freq ?? 2.2 }); return null; }
        if (BODY_CLIPS.has(e.do)) {
          this.sync(a, t0); const dur = e.dur ?? DEFAULT_DUR[e.do] ?? 1.5;
          const p: Record<string, any> = {}; if (e.dir !== undefined) p.dir = e.dir; else if ((e.do === 'lie' || e.do === 'getUp' || e.do === 'thumbsUpLying') && a.lieDir !== undefined) p.dir = a.lieDir; if (e.seat) p.seat = true; if (e.held) p.held = true; if (e.roll !== undefined) p.roll = e.roll;
          this.seg(a, t0, t0 + dur, e.do, 'base', Object.keys(p).length ? p : undefined, e.blend);
          if (e.do === 'getUp') a.lieDir = undefined;
          if (e.do === 'sneeze') this.sound(t0 + 0.75, 'sneeze', -2);
          a.cursor = t0 + dur; return a.cursor;
        }
        this.err(where, `Action "${e.do}" is not supported on a single actor`);
        return t0;
      }
    }
  }

  throughNet(pid: string, hoop: Vec3, t: number, vIn: Vec3) {
    const pts: Vec3[] = []; const n = 15; for (let i = 0; i <= n; i++) { const u = i / n; pts.push([hoop[0] + vIn[0] * 0.01 * u, hoop[1] + 0.06 - 0.6 * u * u, hoop[2] + vIn[2] * 0.01 * u]); }
    const path = this.newPath(pts, t, 0.3 / n); this.propSeg(pid, { t0: t, t1: t + 0.3, mode: 'path', path });
    this.events.push({ t: t + 0.05, kind: 'swish', p: {} }); this.sound(t + 0.04, 'swish', 0);
    this.simulateProp(pid, t + 0.3, [hoop[0], hoop[1] - 0.54, hoop[2]], [vIn[0] * 0.08, -3.2, vIn[2] * 0.08 + 0.15], 3.5);
  }

  faceHeading(a: ActorState, f: any, t: number, where: string) {
    if (typeof f === 'number') return f * D2R;
    const p = this.target(f, t, where); if (!p) return a.h; return Math.atan2(p[0] - a.x, p[2] - a.z);
  }

  obstaclesExcept(ids: string[], t: number) {
    const out: any[] = [];
    for (const a of this.actors.values()) { if (ids.includes(a.id) || a.crowd) continue; const s = this.stateAt(a, t); if (s.lying !== undefined) continue; out.push({ shape: 'capsule', size: [a.height * 0.32, a.height * 0.15], pos: [s.x, a.height * 0.5, s.z], name: a.id }); }
    return out;
  }
  contactSounds(b: PhysicsBake, id: string) { let last = -1; for (const c of b.contacts) { if (c.impulse < 1.2 || c.t - last < 0.05) continue; last = c.t; this.sound(c.t, id, Math.max(-22, 20 * Math.log10(c.impulse / 7)) - 4); } }

  members(key: string, e: any): ActorState[] {
    let ids = e.fromGroup ? [...(this.groups[e.fromGroup] ?? [])] : this.groups[key].filter((m) => !this.named.has(m));
    if (e.fromGroup && !this.groups[e.fromGroup]) this.err('members', `Unknown sub-group "${e.fromGroup}"`, `Known: ${Object.keys(this.groups).join(', ')}`);
    if (e.excludeGroup) { const ex = new Set(this.groups[e.excludeGroup] ?? []); ids = ids.filter((m) => !ex.has(m)); }
    if (!e.fromGroup && e.skipAttached !== false) ids = ids.filter((m) => !(this.actors.get(m)?.attach.some((at) => at.t1 >= INF)));
    if (e.include) ids = [...ids, ...e.include];
    if (e.exclude) ids = ids.filter((m) => !e.exclude.includes(m));
    if (e.only) ids = e.only;
    let ms = ids.map((m) => this.actors.get(m)!).filter(Boolean);
    if (e.count !== undefined && e.count < ms.length) {
      if (e.nearest) { const p = this.target(e.nearest, 0, 'members') ?? [0, 0, 0]; ms = [...ms].sort((a, b) => Math.hypot(a.x - p[0], a.z - p[2]) - Math.hypot(b.x - p[0], b.z - p[2])).slice(0, e.count); }
      else { const rr = rng(hashStr(`${key}:${e.do}:${e.count}:${this.seed}`)); ms = [...ms].sort(() => rr() - 0.5).slice(0, e.count); }
    }
    return ms;
  }

  groupAction(e: any, key: string, t0: number, where: string, marks: Record<string, number>): number | null {
    const ms = this.members(key, e); const rr = rng(hashStr(`${key}:${t0}:${e.do}`));
    const stag = (i: number) => (e.stagger ?? 0.25) * rr();
    let tEnd = t0;
    switch (e.do) {
      case 'group:runTo': case 'group:walkTo': {
        const d = this.target(e.to, t0, where); if (!d) return t0;
        let cx = 0, cz = 0; for (const m of ms) { this.sync(m, Math.max(t0, 0)); cx += m.x; cz += m.z; } cx /= ms.length; cz /= ms.length;
        const sp = e.spread ?? 1;
        ms.forEach((m, i) => {
          const dest: Vec3 = [d[0] + (m.x - cx) * sp, 0, d[2] + (m.z - cz) * sp];
          const run = e.do === 'group:runTo';
          const gait = e.gait ?? this.gaitFor(m, run ? 'run' : 'walk');
          const speed = (e.speed ?? (run ? (m.archetype === 'toddler' ? 2.3 : 4.2) : (m.archetype === 'toddler' ? 0.9 : 1.3))) * (0.85 + rr() * 0.3);
          tEnd = Math.max(tEnd, this.moveTo(m, t0 + stag(i), dest, speed, gait, { faceEnd: e.face ? this.faceHeading({ ...m, x: dest[0], z: dest[2] } as any, e.face, t0, where) : undefined }));
        });
        this.sound(t0, 'tinyStep', -6, { dur: tEnd - t0, rate: e.do === 'group:runTo' ? 1.5 : 1 });
        return tEnd;
      }
      case 'group:formUp': {
        // regroup instantly into a formation (use across a cut)
        const c = this.target(e.center, t0, where); if (!c) return t0; const sp = e.spacing ?? 0.62; const cols = e.cols ?? Math.ceil(Math.sqrt(ms.length * 1.5));
        const facing = e.facing !== undefined ? this.faceHeading({ x: c[0], z: c[2], h: 0 } as any, e.facing, t0, where) : 0;
        const right = [Math.cos(facing), -Math.sin(facing)], back = [-Math.sin(facing), -Math.cos(facing)];
        const rowsN = Math.ceil(ms.length / cols);
        ms.forEach((m, i) => {
          const row = Math.floor(i / cols), col = i % cols; const ox = (col - (cols - 1) / 2) * sp + (rr() - 0.5) * 0.1, oz = row * sp + (e.gap ?? 0) + (rr() - 0.5) * 0.1;
          this.sync(m, Math.max(0, t0 - 0.0005)); this.addKey(m, t0, c[0] + right[0] * ox + back[0] * oz, 0, c[2] + right[1] * ox + back[1] * oz, facing + (rr() - 0.5) * 0.25); m.cursor = t0;
          for (const at of m.attach) if (at.t1 > t0) at.t1 = t0; m.lieDir = undefined;
        });
        void rowsN; return t0;
      }
      case 'group:swarm': {
        const d = this.target(e.target, t0, where); if (!d) return t0; const R0 = e.radius ?? 0.9; const sp = e.spacing ?? 0.42;
        const slots: Vec3[] = []; let ring = 0; while (slots.length < ms.length) { const R = R0 + ring * sp; const n = Math.max(6, Math.floor((2 * Math.PI * R) / sp)); for (let k = 0; k < n && slots.length < ms.length; k++) { const a = (k / n) * Math.PI * 2 + ring * 0.3; slots.push([d[0] + Math.cos(a) * R, 0, d[2] + Math.sin(a) * R]); } ring++; }
        const used = new Set<number>();
        const order = [...ms].sort((a, b) => Math.hypot(a.x - d[0], a.z - d[2]) - Math.hypot(b.x - d[0], b.z - d[2]));
        order.forEach((m, i) => {
          this.sync(m, t0); let best = -1, bd = 1e9; slots.forEach((s, k) => { if (used.has(k)) return; const dd = Math.hypot(s[0] - m.x, s[2] - m.z) + Math.hypot(s[0] - d[0], s[2] - d[2]) * 0.5; if (dd < bd) { bd = dd; best = k; } }); used.add(best);
          const s = slots[best]; const face = Math.atan2(d[0] - s[0], d[2] - s[2]);
          tEnd = Math.max(tEnd, this.moveTo(m, t0 + stag(i), s, (e.speed ?? 2.2) * (0.85 + rr() * 0.3), e.gait ?? this.gaitFor(m, 'run'), { faceEnd: face }));
        });
        this.sound(t0, 'tinyStep', -6, { dur: tEnd - t0, rate: 1.4 });
        return tEnd;
      }
      case 'group:scatter': {
        const f = this.target(e.from, t0, where); if (!f) return t0;
        ms.forEach((m, i) => { this.sync(m, t0); const dx = m.x - f[0], dz = m.z - f[2], L = Math.hypot(dx, dz) || 1; const dist = (e.distance ?? 4) * (0.7 + rr() * 0.6); tEnd = Math.max(tEnd, this.moveTo(m, t0 + stag(i), [m.x + (dx / L) * dist, 0, m.z + (dz / L) * dist], (e.speed ?? 2.4) * (0.8 + rr() * 0.4), e.gait ?? (m.archetype === 'toddler' ? 'toddlerRun' : 'panicRun'))); });
        return tEnd;
      }
      case 'group:do': {
        ms.forEach((m, i) => { const r = this.actorAction(m, { ...e, do: e.action }, t0 + stag(i), where, {}); if (r !== null) tEnd = Math.max(tEnd, r); });
        return tEnd;
      }
      case 'group:face': { ms.forEach((m, i) => this.seg(m, t0 + stag(i), e.dur ? t0 + stag(i) + e.dur : INF, e.expr, 'face')); return null; }
      case 'group:lookAt': { ms.forEach((m, i) => { const s = (e.stagger ?? 0) * rr(); this.seg(m, t0 + s, e.dur === 'hold' || e.dur === undefined ? INF : t0 + s + e.dur, 'look', 'look', { target: e.target, snap: e.snap }); }); return null; }
      case 'group:turnTo': { ms.forEach((m, i) => { const r = this.actorAction(m, { do: 'turnTo', target: e.target, dur: e.dur ?? 0.35 }, t0 + (e.stagger ?? 0) * rr(), where, {}); if (r !== null) tEnd = Math.max(tEnd, r); }); return tEnd; }
      case 'group:cling': {
        const tgt = this.actors.get(e.target); if (!tgt) { this.err(where, `cling target "${e.target}" is not an actor`); return t0; }
        const n = Math.min(e.count ?? 6, ms.length); const s = this.stateAt(tgt, t0);
        const chosen = [...ms].sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z)).slice(0, n);
        const hd = dimsFor(tgt.look, tgt.height);
        chosen.forEach((m, i) => {
          const side = i % 2 ? -1 : 1; const ring = Math.floor(i / 2);
          const ang = side * (0.6 + ring * 0.9); const R = hd.halfW + 0.12;
          const off: Vec3 = [Math.sin(ang) * R + side * 0.05, Math.min(tgt.height * 0.32, ring * 0.22) + 0.02, Math.cos(ang) * R];
          const world: Vec3 = [s.x + Math.cos(s.h) * off[0] + Math.sin(s.h) * off[2], 0, s.z - Math.sin(s.h) * off[0] + Math.cos(s.h) * off[2]];
          const tArr = this.moveTo(m, t0 + stag(i) * 0.5, world, 2.4, this.gaitFor(m, 'run'), { dur: e.dur ? e.dur * (0.7 + rr() * 0.3) : undefined });
          m.attach.push({ t0: tArr, t1: INF, target: tgt.id, offset: off, heading: Math.PI + ang });
          this.seg(m, tArr, INF, 'hug', 'base', undefined, 0.1); m.cursor = tArr + 0.01;
          tEnd = Math.max(tEnd, tArr);
        });
        this.groups[`${key}_cling`] = [...(this.groups[`${key}_cling`] ?? []), ...chosen.map((m) => m.id)];
        return tEnd;
      }
      case 'group:pileOn': {
        const c = this.target(e.target, t0, where); if (!c) return t0;
        const tgtA = this.actors.get(String(e.target)); const ts = tgtA ? this.stateAt(tgtA, t0) : null;
        // heap slots: centered on the target body, layered
        const L = tgtA ? tgtA.height : 1; const axis = ts ? [Math.sin(ts.h), Math.cos(ts.h)] : [0, 1]; const headSign = ts?.lying === -1 ? -1 : 1;
        const slots: Vec3[] = [];
        for (let layer = 0; slots.length < ms.length; layer++) {
          const n = Math.max(1, 9 - layer * 3); for (let k = 0; k < n && slots.length < ms.length; k++) {
            const along = ((k / Math.max(1, n - 1)) - 0.5) * L * (0.9 - layer * 0.25) * headSign; const across = (rr() - 0.5) * (0.6 - layer * 0.15);
            slots.push([c[0] + axis[0] * (along + L * 0.35 * headSign) + axis[1] * across, 0.12 + layer * 0.22, c[2] + axis[1] * (along + L * 0.35 * headSign) - axis[0] * across]);
          }
        }
        const order = [...ms].sort((a, b) => Math.hypot(a.x - c[0], a.z - c[2]) - Math.hypot(b.x - c[0], b.z - c[2]));
        order.forEach((m, i) => {
          const s = slots[i]; const dx = m.x - s[0], dz = m.z - s[2], LL = Math.hypot(dx, dz) || 1;
          const launch: Vec3 = [s[0] + (dx / LL) * 1.0, 0, s[2] + (dz / LL) * 1.0];
          const ta = this.moveTo(m, t0 + (e.stagger ?? 0.06) * i, launch, 2.6, this.gaitFor(m, 'run'));
          const tl = this.jumpTo(m, ta, s, 0.45 + s[1] * 0.4, s[1], 0.55, 'jump', { armsUp: true });
          this.seg(m, tl, INF, 'pileLie', 'base', { dir: rr() < 0.5 ? 1 : -1, roll: (rr() - 0.5) * 0.8 }, 0.1);
          this.addKey(m, tl + 0.01, m.x, m.y, m.z, m.h + (rr() - 0.5) * 2);
          this.sound(tl, 'thud', -12 - rr() * 6);
          m.cursor = tl + 0.01; tEnd = Math.max(tEnd, tl);
        });
        this.groups[`${key}_pile`] = order.map((m) => m.id);
        return tEnd;
      }
      case 'group:tower': {
        const c = this.target(e.spot, t0, where); if (!c) return t0;
        const rows: number[] = e.rows ?? [4, 3, 2, 1];
        const topId: string | undefined = e.top;
        const sample = ms[0]; const H = sample?.height ?? 0.86; const step = H * 0.66; const w = e.width ?? 0.36;
        const facing = e.facing !== undefined ? this.faceHeading({ x: c[0], z: c[2], h: 0 } as any, e.facing, t0, where) : 0;
        const right = [Math.cos(facing), -Math.sin(facing)];
        const slots: { p: Vec3; row: number }[] = [];
        rows.forEach((n, row) => { for (let k = 0; k < n; k++) { const off = (k - (n - 1) / 2) * w; slots.push({ p: [c[0] + right[0] * off, row * step, c[2] + right[1] * off], row }); } });
        const climbers = [...ms]; let topActor: ActorState | undefined;
        if (topId) { topActor = this.actors.get(topId); const tIdx = slots.length - 1; if (topActor) slots[tIdx] = { ...slots[tIdx], p: slots[tIdx].p }; }
        const nSlots = topActor ? slots.length - 1 : slots.length;
        const used = climbers.sort((a, b) => Math.hypot(a.x - c[0], a.z - c[2]) - Math.hypot(b.x - c[0], b.z - c[2])).slice(0, nSlots);
        if (used.length < nSlots) this.warn(where, `Tower needs ${nSlots} members, only ${used.length} available`);
        const fwd = [Math.sin(facing), Math.cos(facing)];
        const rowDelay = e.rowDelay ?? 1.1; let towerMembers: string[] = [];
        const climb = (m: ActorState, slot: { p: Vec3; row: number }, tStart: number) => {
          const base: Vec3 = [slot.p[0] - fwd[0] * 0.55, 0, slot.p[2] - fwd[1] * 0.55];
          let t = this.moveTo(m, tStart, base, 2.2, this.gaitFor(m, 'run'));
          if (slot.row === 0) { t = this.moveTo(m, t, slot.p, 1.0, this.gaitFor(m, 'walk')); }
          else { t = this.jumpTo(m, t, slot.p, 0.35, slot.p[1], 0.6 + slot.row * 0.08, 'jump', { armsUp: true }); this.sound(t, 'tinyStep', -10, { dur: 0.15 }); }
          this.addKey(m, t + 0.25, m.x, m.y, m.z, facing);
          this.seg(m, t, INF, 'balance', 'base', undefined, 0.15); m.cursor = t + 0.25; towerMembers.push(m.id);
          return t + 0.25;
        };
        let si = 0;
        used.forEach((m, i) => { const slot = slots[si++]; tEnd = Math.max(tEnd, climb(m, slot, t0 + slot.row * rowDelay + (e.stagger ?? 0.15) * rr())); });
        if (topActor) { tEnd = Math.max(tEnd, climb(topActor, slots[slots.length - 1], Math.max(tEnd - 0.4, t0 + rows.length * rowDelay))); }
        this.groups[`${key}_tower`] = towerMembers;
        this.markers[`${key}.tower`] = tEnd; marks.done = tEnd;
        return tEnd;
      }
      case 'group:sway': {
        const ids = this.groups[e.of ?? `${key}_tower`] ?? ms.map((m) => m.id); const dur = e.dur ?? 2; const amp = e.amp ?? 0.08; const f = e.freq ?? 1.3;
        for (const id of ids) {
          const m = this.actors.get(id)!; this.sync(m, t0); const x0 = m.x, z0 = m.z, y0 = m.y, h = m.h; const k = (y0 + 0.3) * amp * 1.6;
          for (let tt = 0.05; tt <= dur; tt += 0.05) { const s = Math.sin(tt * f * Math.PI * 2) * k * Math.min(1, tt / 0.6) * (1 + tt / dur); this.addKey(m, t0 + tt, x0 + Math.cos(h) * s, y0, z0 - Math.sin(h) * s, h); }
          m.cursor = t0 + dur;
        }
        return t0 + dur;
      }
      case 'group:collapse': case 'group:pileTumble': {
        const ids = e.do === 'group:collapse' ? (this.groups[e.of ?? `${key}_tower`] ?? []) : ms.map((m) => m.id);
        const extra = (e.include ?? []).filter((id: string) => !ids.includes(id));
        const all = [...ids, ...extra].map((id) => this.actors.get(id)!).filter(Boolean);
        if (!all.length) { this.err(where, 'Nothing to collapse (build a group:tower first or pass include)'); return t0; }
        const dur = e.dur ?? 3.5; const push: Vec3 = e.push ?? [0, 0, 1.5];
        const toward = e.toward ? this.target(e.toward, t0, where) : null;
        const maxY = Math.max(...all.map((m) => this.stateAt(m, t0).y));
        const bodies = all.map((m, i) => {
          const s = this.stateAt(m, t0); const k = (s.y + 0.2) / (maxY + 0.2);
          let v: Vec3 = [push[0] * k, push[1] * k, push[2] * k];
          if (toward) { const dx = toward[0] - s.x, dz = toward[2] - s.z, L = Math.hypot(dx, dz) || 1; const mag = Math.hypot(push[0], push[2]) || 1.5; v = [dx / L * mag * k, push[1] * k, dz / L * mag * k]; }
          if (e.do === 'group:pileTumble') { const f = this.target(e.from ?? key, t0, where) ?? [0, 0, 0]; const dx = s.x - f[0], dz = s.z - f[2], L = Math.hypot(dx, dz) || 1; const pw = e.power ?? 3; v = [dx / L * pw, pw * 0.8, dz / L * pw]; }
          return this.actorBody(m, t0, i, [v[0] + (rr() - 0.5) * 0.4, v[1], v[2] + (rr() - 0.5) * 0.4], [(rr() - 0.5) * 4, (rr() - 0.5) * 2, (rr() - 0.5) * 4]);
        });
        const id = `${this.id}_b${this.bakeN++}`;
        const b = bake({ id, set: this.spec.set, t0, dur, gravity: this.gravityAt(t0), seed: this.seed, bodies, obstacles: this.obstaclesExcept(all.map((m) => m.id), t0) });
        this.bakes[id] = b; this.applyBake(all, b, t0, dur); this.contactSounds(b, 'thud');
        return t0 + dur;
      }
      default:
        this.err(where, `"${e.do}" is not a group action`); return t0;
    }
  }

  // ------------------------------------------------------------ finalize
  finalize(): CompiledScene {
    let end = this.spec.duration ?? 0;
    for (const a of this.actors.values()) { end = Math.max(end, a.cursor); for (const s of a.segs) if (s.t1 < INF) end = Math.max(end, s.t1); }
    for (const s of this.sounds) end = Math.max(end, s.t + (s.dur ?? 0));
    for (const p of this.props.values()) for (const s of p.segs) if (s.t1 < INF) end = Math.max(end, s.t1);
    end = this.spec.duration ?? end + 0.5; this.duration = end;
    const actors: CompiledActor[] = [];
    for (const a of this.actors.values()) {
      // base layer: sort, clip infinities, fill gaps
      const base = a.segs.filter((s) => s.layer === 'base').sort((p, q) => p.t0 - q.t0);
      const filled: PoseSeg[] = []; let t = 0;
      for (let i = 0; i < base.length; i++) {
        const s = base[i]; const next = base[i + 1];
        if (next && s.t1 > next.t0) s.t1 = next.t0;
        if (s.t1 >= INF) s.t1 = next ? next.t0 : end;
        if (s.t0 > t + 1e-3) filled.push(this.gapSeg(filled[filled.length - 1], t, s.t0));
        if (s.t1 - s.t0 > 1e-4) filled.push(s); t = Math.max(t, s.t1);
      }
      if (t < end) filled.push(this.gapSeg(filled[filled.length - 1], t, end));
      const others = a.segs.filter((s) => s.layer !== 'base');
      for (const layer of ['face', 'look', 'upper', 'mouth'] as const) {
        const L = others.filter((s) => s.layer === layer).sort((p, q) => p.t0 - q.t0);
        for (let i = 0; i < L.length; i++) { const nx = L[i + 1]; if (nx && L[i].t1 > nx.t0) L[i].t1 = nx.t0; if (L[i].t1 >= INF) L[i].t1 = end; }
      }
      const keys = a.keys.length ? a.keys : [{ t: 0, x: a.x, y: 0, z: a.z, h: a.h, d: 0 }];
      const lastK = keys[keys.length - 1]; if (lastK.t < end) keys.push({ ...lastK, t: end });
      for (const at of a.attach) if (at.t1 >= INF) at.t1 = end;
      for (const ph of a.physics) if (ph.t1 >= INF) { const nb = filled.find((s) => s.t0 > ph.t0 + 0.01 && !['flail', 'stand', 'idle', 'lie', 'pileLie'].includes(s.clip)); ph.t1 = nb ? nb.t0 : end; }
      a.hidden = a.hidden.map(([h0, h1]) => [h0, Math.min(h1, end + 1)] as [number, number]);
      actors.push({ id: a.id, name: a.name, kind: a.kind, look: a.look, model: a.model, modelScale: a.scale, clipMap: a.clipMap, root: keys, segs: [...filled, ...others.filter((s) => s.t1 > s.t0)], attach: a.attach, physics: a.physics, hidden: a.hidden.length ? a.hidden : undefined, seed: a.seed, shadow: a.crowd && (this.groups[a.crowd]?.length ?? 0) > 24 ? 'blob' : 'cast' });
    }
    const props: CompiledProp[] = [...this.props.values()].map((p) => ({ id: p.id, kind: p.kind, params: p.params, rest: p.rest, segs: p.segs.map((s) => ({ ...s, t1: s.t1 >= INF ? end : s.t1 })) }));
    return { id: this.id, set: { preset: this.spec.set, params: this.spec.params ?? {} }, duration: end, actors, props, paths: this.paths, bakes: this.bakes, events: this.events.sort((a, b) => a.t - b.t), markers: this.markers, groups: this.groups, fog: this.spec.fog };
  }
  gapSeg(prev: PoseSeg | undefined, t0: number, t1: number): PoseSeg {
    const persist = prev ? PERSIST[prev.clip] : undefined;
    if (persist && persist !== 'idle') return { t0, t1, clip: persist, layer: 'base', p: { ...(prev!.p ?? {}), held: true }, blend: 0.05 };
    if (prev?.clip === 'balance' || prev?.clip === 'hug') return { t0, t1, clip: prev.clip, layer: 'base', blend: 0.05 };
    return { t0, t1, clip: 'idle', layer: 'base' };
  }
}

function evalKeys(keys: RootKey[], t: number): RootKey {
  if (!keys.length) return { t, x: 0, y: 0, z: 0, h: 0, d: 0 };
  if (t <= keys[0].t) return { ...keys[0], t };
  const last = keys[keys.length - 1]; if (t >= last.t) return { ...last, t };
  let lo = 0, hi = keys.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (keys[m].t <= t) lo = m; else hi = m; }
  const a = keys[lo], b = keys[hi]; const w = (t - a.t) / (b.t - a.t || 1);
  return { t, x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w, h: a.h + wrapAng(b.h - a.h) * w, d: a.d + (b.d - a.d) * w };
}
function quatY(h: number): [number, number, number, number] { return [0, Math.sin(h / 2), 0, Math.cos(h / 2)]; }
function rotate(q: [number, number, number, number], v: Vec3): Vec3 {
  const [x, y, z, w] = q; const [vx, vy, vz] = v;
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

// ================================================================ videos
function inverseSceneTime(shot: CompiledShot, ts: number): number | null {
  // video time at which scene time ts is shown in this shot (null if not shown)
  if (!shot.ramp?.length) { const lt = (ts - shot.sceneStart) / shot.speed; return lt >= -1e-6 && shot.start + lt < shot.end + 1e-6 ? shot.start + lt : null; }
  const speedAt = (x: number) => { let s = shot.speed; for (const r of shot.ramp!) if (x >= r.at) { const k = Math.min(1, (x - r.at) / Math.max(1e-3, r.dur)); s = s + (r.speed - s) * k; } return s; };
  let acc = shot.sceneStart; const step = 1 / 240;
  for (let x = 0; x < shot.end - shot.start; x += step) { const nx = acc + speedAt(x) * step; if (ts >= acc && ts < nx) return shot.start + x + ((ts - acc) / (nx - acc)) * step; acc = nx; }
  return null;
}
function shotVideoDur(from: number, to: number, speed: number, ramp?: { at: number; speed: number; dur: number }[]) {
  if (!ramp?.length) return (to - from) / speed;
  const speedAt = (x: number) => { let s = speed; for (const r of ramp) if (x >= r.at) { const k = Math.min(1, (x - r.at) / Math.max(1e-3, r.dur)); s = s + (r.speed - s) * k; } return s; };
  let acc = 0, x = 0; const step = 1 / 240; while (acc < to - from && x < 120) { acc += speedAt(x) * step; x += step; } return x;
}

function captionChunks(text: string, t0: number, dur: number): { text: string; t0: number; t1: number }[] {
  const words = text.split(/\s+/); const chunks: string[] = []; let cur: string[] = [];
  for (const w of words) { cur.push(w); const s = cur.join(' '); if (cur.length >= 7 || (/[.!?,;:—]$/.test(w) && cur.length >= 3) || s.length > 34) { chunks.push(s); cur = []; } }
  if (cur.length) chunks.push(cur.join(' '));
  const total = chunks.reduce((n, c) => n + c.length, 0); let t = t0;
  return chunks.map((c) => { const d = Math.max(0.6, dur * (c.length / total)); const o = { text: c, t0: t, t1: t + d }; t += d; return o; });
}

export async function compileEpisode(ep: Episode, tts: Record<string, TtsResult>): Promise<{ videos: Record<string, CompiledVideo>; issues: Issue[]; scenes: Record<string, CompiledScene> }> {
  await initPhysics();
  const issues: Issue[] = [];
  const builders = new Map<string, SceneBuilder>();
  const compiledScenes: Record<string, CompiledScene> = {};
  // compile scenes in dependency order (continueFrom)
  const order: string[] = []; const visit = (id: string, stack: string[] = []) => { if (order.includes(id)) return; if (stack.includes(id)) { issues.push({ level: 'error', where: id, msg: 'circular continueFrom' }); return; } const s = ep.scenes[id]; if (!s) return; if (s.continueFrom) visit(s.continueFrom.scene, [...stack, id]); order.push(id); };
  Object.keys(ep.scenes).forEach((id) => visit(id));
  for (const id of order) {
    const spec = ep.scenes[id];
    if (!SETS[spec.set]) { issues.push({ level: 'error', where: `${id}`, msg: `Unknown set "${spec.set}"`, fix: `Available sets: ${Object.keys(SETS).join(', ')}. New environments must be built in runtime/sets.ts or imported as glTF.` }); continue; }
    const b = new SceneBuilder(id, spec, ep, issues, tts, builders);
    b.buildCast(); b.compileTracks();
    compiledScenes[id] = b.finalize(); builders.set(id, b);
  }
  const videos: Record<string, CompiledVideo> = {};
  for (const [vid, v] of Object.entries(ep.videos)) videos[vid] = compileVideo(ep, vid, v, builders, compiledScenes, tts, issues);
  return { videos, issues, scenes: compiledScenes };
}

function compileVideo(ep: Episode, vid: string, v: VideoSpec, builders: Map<string, SceneBuilder>, scenes: Record<string, CompiledScene>, tts: Record<string, TtsResult>, issues: Issue[]): CompiledVideo {
  const shots: CompiledShot[] = []; let T = 0;
  const used = new Set<string>();
  const overlays: OverlayItem[] = []; const audio: AudioCue[] = [];
  v.shots.forEach((s, i) => {
    const where = `${vid}/shots[${i}]${s.id ? `(${s.id})` : ''}`;
    const b = builders.get(s.scene); if (!b) { issues.push({ level: 'error', where, msg: `Unknown scene "${s.scene}"` }); return; }
    if (!CAMERA_TYPES[s.camera.type]) issues.push({ level: 'error', where, msg: `Unknown camera type "${s.camera.type}"`, fix: `Use: ${Object.keys(CAMERA_TYPES).join(', ')}` });
    const from = b.time(s.from, 0); if (from === null) { issues.push({ level: 'error', where, msg: `Unresolved shot start "${s.from}"` }); return; }
    let to: number | null = s.to !== undefined ? b.time(s.to, from) : s.dur !== undefined ? from + s.dur * s.speed : null;
    if (to === null) { issues.push({ level: 'error', where, msg: 'Shot needs "to" or "dur"' }); return; }
    if (to <= from) { issues.push({ level: 'error', where, msg: `Shot ends (${to.toFixed(2)}) before it starts (${from.toFixed(2)})` }); return; }
    if (to > b.duration + 0.05) issues.push({ level: 'warning', where, msg: `Shot runs past the end of scene action (${to.toFixed(2)} > ${b.duration.toFixed(2)}s); characters will hold still` });
    const dur = shotVideoDur(from, to, s.speed, s.ramp);
    if (dur < 0.25) issues.push({ level: 'warning', where, msg: `Very short shot (${dur.toFixed(2)}s)` });
    if (dur > 6) issues.push({ level: 'warning', where, msg: `Long shot (${dur.toFixed(1)}s) — check that something new happens on screen` });
    const shot: CompiledShot = { id: s.id ?? `s${i + 1}`, index: i, start: T, end: T + dur, scene: s.scene, sceneStart: from, speed: s.speed, ramp: s.ramp, camera: s.camera as any, transition: s.transition, purpose: s.purpose };
    shots.push(shot); used.add(s.scene); T += dur;
    if (s.transition === 'flash') overlays.push({ t0: shot.start, t1: shot.start + 0.16, kind: 'flash', p: {} });
    if (s.transition === 'whiteIn') overlays.push({ t0: shot.start, t1: shot.start + 0.4, kind: 'flash', p: { alpha: 1 } });
    if (s.transition === 'fadeIn') overlays.push({ t0: shot.start, t1: shot.start + 0.5, kind: 'fade', p: { from: 1, to: 0 } });
    for (const o of s.overlays ?? []) { const { kind, at, dur: od, until, shot: _s, ...rest } = o as any; const t0 = shot.start + (typeof at === 'number' ? at : 0); overlays.push({ t0, t1: od !== undefined ? t0 + od : shot.end, kind, p: rest }); }
    for (const fx of s.sfx ?? []) { if (!SFX_IDS.includes(fx.id)) issues.push({ level: 'error', where, msg: `Unknown sound "${fx.id}"` }); audio.push({ t: shot.start + fx.at, kind: 'sfx', id: fx.id, gain: fx.gain, rate: fx.rate }); }
    if (s.narration) {
      const n = typeof s.narration === 'string' ? { text: s.narration, at: 0.1 } : s.narration as any;
      const voice = n.voice ?? v.narrator ?? 'bm_george'; const key = ttsKey(n.text, voice, 1); const r = tts[key];
      if (!r) issues.push({ level: 'error', where, msg: `Missing narration audio for "${n.text}"` });
      else {
        const t0 = shot.start + (n.at ?? 0.1);
        audio.push({ t: t0, kind: 'voice', id: key, file: r.file, dur: r.dur, text: n.text, speaker: 'narrator' });
        if (v.captions === 'all') for (const c of captionChunks(n.text, t0, r.dur)) overlays.push({ t0: c.t0, t1: c.t1, kind: 'caption', p: { text: c.text, y: 0.73, size: 46 } });
      }
    }
  });
  const shotRef = (ref: any) => typeof ref === 'number' ? shots[ref] : shots.find((s) => s.id === ref);
  // map scene sounds into the edit
  const emittedVoices = new Set<string>();
  for (const shot of shots) {
    const b = builders.get(shot.scene)!; const sceneEnd = shot.sceneStart + 1e9;
    for (const ev of b.sounds) {
      const T0 = inverseSceneTime(shot, ev.t);
      if (ev.kind === 'voice') {
        const uid = `${shot.scene}:${ev.t}:${ev.id}`; if (emittedVoices.has(uid)) continue;
        let tv = T0; let offset = 0;
        if (tv === null && ev.t < shot.sceneStart && ev.t + (ev.dur ?? 0) > shot.sceneStart + 0.1) { tv = shot.start; offset = shot.sceneStart - ev.t; }
        if (tv === null) continue; emittedVoices.add(uid);
        audio.push({ t: tv, kind: 'voice', id: ev.id, file: ev.file, dur: (ev.dur ?? 0) - offset, text: ev.text, speaker: ev.speaker, rate: ev.pitch ? Math.pow(2, ev.pitch / 12) : undefined, offset: offset || undefined, fx: ev.fx, gain: ev.gain });
        if (ev.caption !== false && v.captions !== 'none') for (const c of captionChunks(ev.text!, tv, Math.max(0.8, (ev.dur ?? 1) - offset))) overlays.push({ t0: c.t0, t1: c.t1, kind: 'caption', p: { text: c.text, speaker: ev.speaker, y: 0.71 } });
        continue;
      }
      if (T0 === null) continue;
      const slow = shot.speed < 0.8 ? shot.speed : 1;
      audio.push({ t: T0, kind: 'sfx', id: ev.id, gain: ev.gain, rate: (ev.rate ?? 1) * (slow < 1 ? 0.75 : 1), dur: ev.dur ? Math.min(ev.dur / shot.speed, shot.end - T0) : undefined });
      void sceneEnd;
    }
  }
  // video-level overlays
  for (const o of v.overlays) {
    const { kind, at, dur: od, until, shot: sref, ...rest } = o as any;
    if (rest.bind === 'gravity') {
      // data-bound HUD: value follows the scene's gravity state through every shot
      let prevVal: string | undefined; let changedAt: number | undefined;
      for (const sh of shots) {
        const b = builders.get(sh.scene)!; const pts = [sh.sceneStart, ...b.gravityEvents.map((e) => e.t).filter((t) => t > sh.sceneStart)];
        for (let i = 0; i < pts.length; i++) {
          const T0 = i === 0 ? sh.start : inverseSceneTime(sh, pts[i]); if (T0 === null || T0 >= sh.end) continue;
          const nextT = i + 1 < pts.length ? inverseSceneTime(sh, pts[i + 1]) : null; const T1 = nextT === null ? sh.end : Math.min(sh.end, nextT);
          const g = b.gravityAt(pts[i] + 1e-4) / GRAV; const val = `${g >= 1 ? +g.toFixed(0) : +g.toFixed(2)}G`;
          if (prevVal !== undefined && val !== prevVal) changedAt = T0; prevVal = val;
          overlays.push({ t0: T0, t1: T1, kind: 'counter', p: { ...rest, value: val, changedAt, color: g >= 16 ? '#ff4d4d' : g >= 4 ? '#ffb703' : rest.color } });
        }
      }
      continue;
    }
    let t0 = typeof at === 'number' ? at : 0; let t1: number;
    if (sref !== undefined) { const sh = shotRef(sref); if (!sh) { issues.push({ level: 'error', where: `${vid}/overlays`, msg: `Unknown shot ${sref}` }); continue; } t0 = sh.start + (typeof at === 'number' ? at : 0); t1 = od !== undefined ? t0 + od : sh.end; }
    else t1 = od !== undefined ? t0 + od : T;
    if (until !== undefined) { const us = shotRef(until); if (us) t1 = us.end; else if (typeof until === 'number') t1 = until; }
    overlays.push({ t0, t1, kind, p: rest });
  }
  // scoreboard
  if (v.score) {
    const steps = v.score.timeline.map((s) => ({ t: s.shot !== undefined ? (shotRef(s.shot)?.start ?? 0) + s.at : s.at, ...s })).sort((a, b) => a.t - b.t);
    const endT = v.score.until !== undefined ? (shotRef(v.score.until)?.end ?? T) : T;
    let prevL: any, prevR: any, chL: number | undefined, chR: number | undefined;
    steps.forEach((s, i) => {
      if (prevL !== undefined && s.left !== prevL) chL = s.t; if (prevR !== undefined && s.right !== prevR) chR = s.t;
      const t1 = i + 1 < steps.length ? steps[i + 1].t : endT;
      overlays.push({ t0: s.t, t1, kind: 'score', p: { left: { ...v.score!.left, value: s.left, changedAt: chL }, right: { ...v.score!.right, value: s.right, changedAt: chR }, note: s.note } });
      prevL = s.left; prevR = s.right;
    });
    // scoreboard fades in only once; consecutive items share appearance (handled by overlay timing)
  }
  // drop scenes not used by this video to keep files small
  if (v.style && !STYLES[v.style]) issues.push({ level: 'error', where: vid, msg: `Unknown style "${v.style}"`, fix: `Available: ${Object.keys(STYLES).join(', ')}` });
  const vScenes = [...used].map((id) => scenes[id]);
  const music = v.music ? { ...v.music, cues: (v.music.cues ?? []).map((c) => ({ ...c, at: c.shot !== undefined ? (shotRef(c.shot)?.start ?? 0) + c.at : c.at })) } : undefined;
  const cover = v.cover ? (shotRef(v.cover.shot)?.start ?? 0) + v.cover.at : undefined;
  if (T < 8) issues.push({ level: 'warning', where: vid, msg: `Video is only ${T.toFixed(1)}s long` });
  if (T > 90) issues.push({ level: 'warning', where: vid, msg: `Video is ${T.toFixed(1)}s long — long for short-form` });
  // narration/dialogue overlap check
  const voices = audio.filter((a) => a.kind === 'voice').sort((a, b) => a.t - b.t);
  for (let i = 1; i < voices.length; i++) if (voices[i].t < voices[i - 1].t + (voices[i - 1].dur ?? 0) - 0.15) issues.push({ level: 'warning', where: `${vid}@${voices[i].t.toFixed(1)}s`, msg: `Voice lines overlap: "${voices[i - 1].text}" / "${voices[i].text}"` });
  for (const vc of voices) if (vc.t + (vc.dur ?? 0) > T + 0.1) issues.push({ level: 'warning', where: `${vid}@${vc.t.toFixed(1)}s`, msg: `Line runs past the end of the video: "${vc.text}"` });
  overlays.sort((a, b) => (a.kind === 'caption' ? 1 : 0) - (b.kind === 'caption' ? 1 : 0) || (a.kind === 'choice' || a.kind === 'card' ? 1 : 0) - (b.kind === 'choice' || b.kind === 'card' ? 1 : 0));
  return { episode: ep.id, id: vid, branch: v.branch ?? vid, title: v.title, fps: ep.fps, width: ep.width, height: ep.height, duration: T, seed: ep.seed, scenes: vScenes, shots, overlays, audio: audio.sort((a, b) => a.t - b.t), music, grade: resolveStyle(v.style, v.grade ?? {}) as any, style: v.style ?? 'bright-cartoon', coverTime: cover };
}
