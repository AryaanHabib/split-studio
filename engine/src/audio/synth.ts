// Procedural sound effects + music. Everything here is synthesized from
// scratch (no samples), so it is license-clean for monetized publishing.
// Quality note: this is serviceable game-style audio, not a pro sound library.
// Users can drop real recordings into assets/sfx/<id>.wav to override any id.

export const SR = 48000;
type Buf = Float32Array;

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));
const buf = (sec: number) => new Float32Array(Math.max(1, Math.round(sec * SR)));

/** 2-pole resonant bandpass (RBJ) applied in place */
function bandpass(x: Buf, f: number | ((i: number) => number), q: number) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const fc = typeof f === 'number' ? f : f(i);
    const w = (2 * Math.PI * fc) / SR, al = Math.sin(w) / (2 * q), cw = Math.cos(w);
    const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
    const y = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}
function lowpass(x: Buf, f: number) { const a = Math.exp((-2 * Math.PI * f) / SR); let y = 0; for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; x[i] = y; } return x; }
function highpass(x: Buf, f: number) { const a = Math.exp((-2 * Math.PI * f) / SR); let y = 0, px = 0; for (let i = 0; i < x.length; i++) { y = a * (y + x[i] - px); px = x[i]; x[i] = y; } return x; }
function noise(n: number, r: () => number) { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = r() * 2 - 1; return b; }
function norm(x: Buf, peak = 0.9) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m; return x; }
function mixInto(dst: Buf, src: Buf, at: number, g = 1) { const o = Math.round(at * SR); for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * g; }

/** Formant "voice" chorus used for crowds (aww / boo / cheer / laugh). */
function chorus(sec: number, voices: number, seed: number, f0: (t: number, v: number) => number, amp: (t: number, v: number) => number, formants: [number, number][], breath = 0.3) {
  const r = rng(seed); const out = buf(sec);
  for (let v = 0; v < voices; v++) {
    const det = 0.85 + r() * 0.3; const off = r() * 0.3; let ph = r();
    const src = buf(sec);
    for (let i = 0; i < src.length; i++) {
      const t = i / SR; ph += (f0(t - off, v) * det) / SR; ph -= Math.floor(ph);
      const saw = 2 * ph - 1; src[i] = (saw * (1 - breath) + (r() * 2 - 1) * breath) * Math.max(0, amp(t - off, v));
    }
    const voiced = new Float32Array(src.length);
    for (const [f, q] of formants) { const c = Float32Array.from(src); bandpass(c, f * (0.95 + r() * 0.1), q); for (let i = 0; i < c.length; i++) voiced[i] += c[i]; }
    for (let i = 0; i < out.length; i++) out[i] += voiced[i];
  }
  return out;
}

export type SfxGen = (o: { seed: number; dur?: number }) => Buf;

export const SFX: Record<string, SfxGen> = {
  whistle({ seed }) { const r = rng(seed); const b = buf(0.75); let ph = 0; for (let i = 0; i < b.length; i++) { const t = i / SR; const f = 2900 + Math.sin(t * 2 * Math.PI * 38) * 120 * (r() * 0.3 + 0.85); ph += f / SR; const e = Math.min(1, t / 0.02) * (t > 0.6 ? Math.max(0, 1 - (t - 0.6) / 0.15) : 1); b[i] = (Math.sin(2 * Math.PI * ph) * 0.7 + (r() * 2 - 1) * 0.12) * e; } return norm(bandpass(b, 2900, 2)); },
  bounce({ seed }) { const r = rng(seed); const b = buf(0.25); for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = Math.sin(2 * Math.PI * (95 + 140 * Math.exp(-t * 40)) * t) * env(t, 0.002, 0.045) + (r() * 2 - 1) * env(t, 0.0005, 0.006) * 0.6; } return norm(lowpass(b, 2500)); },
  swish({ seed }) { const r = rng(seed); const b = noise(Math.round(0.45 * SR), r); for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] *= env(t, 0.03, 0.12); } return norm(highpass(bandpass(b, (i) => 3000 + 2500 * Math.exp(-i / SR / 0.1), 0.8), 900), 0.7); },
  rim({ seed }) { const r = rng(seed); const b = buf(0.9); const partials = [523, 1187, 1953, 2811, 3720]; for (let i = 0; i < b.length; i++) { const t = i / SR; let s = 0; partials.forEach((f, k) => (s += Math.sin(2 * Math.PI * f * (1 + r() * 0.0005) * t) * Math.exp(-t * (4 + k * 3)) / (k + 1))); b[i] = s + (r() * 2 - 1) * env(t, 0.0005, 0.004); } return norm(b, 0.8); },
  squeak({ seed }) { const r = rng(seed); const len = 0.08 + r() * 0.06; const b = buf(len); let ph = 0; const f0 = 1800 + r() * 900; for (let i = 0; i < b.length; i++) { const t = i / SR; ph += (f0 + 900 * (t / len)) / SR; b[i] = (Math.sin(2 * Math.PI * ph) + Math.sin(4 * Math.PI * ph) * 0.3) * Math.sin(Math.PI * t / len); } return norm(b, 0.6); },
  footstep({ seed }) { const r = rng(seed); const b = noise(Math.round(0.12 * SR), r); for (let i = 0; i < b.length; i++) b[i] *= env(i / SR, 0.002, 0.02); lowpass(b, 1200); const k = buf(0.12); for (let i = 0; i < k.length; i++) { const t = i / SR; k[i] = Math.sin(2 * Math.PI * 80 * t) * env(t, 0.002, 0.03); } for (let i = 0; i < b.length; i++) b[i] += k[i] * 0.8; return norm(b, 0.7); },
  tinyStep({ seed, dur = 1 }) { // pitter-patter of many small feet
    const r = rng(seed); const b = buf(dur + 0.2); const step = SFX.footstep({ seed: seed + 1 });
    const n = Math.max(3, Math.floor(dur * 28));
    for (let k = 0; k < n; k++) { const t = r() * dur; const s = Float32Array.from(step); highpass(s, 300 + r() * 400); mixInto(b, s, t, 0.25 + r() * 0.3); }
    for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] *= Math.min(1, t / 0.15) * Math.min(1, (dur + 0.2 - t) / 0.3); }
    return norm(b, 0.6);
  },
  thud({ seed }) { const r = rng(seed); const b = buf(0.35); for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = Math.sin(2 * Math.PI * (60 + 70 * Math.exp(-t * 25)) * t) * env(t, 0.003, 0.08) + (r() * 2 - 1) * env(t, 0.001, 0.02) * 0.5; } return norm(lowpass(b, 900)); },
  bigThud({ seed }) { const r = rng(seed); const b = buf(1.0); for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = Math.sin(2 * Math.PI * (38 + 60 * Math.exp(-t * 12)) * t) * env(t, 0.004, 0.25) + (r() * 2 - 1) * env(t, 0.002, 0.06) * 0.7; } return norm(lowpass(b, 700)); },
  hit({ seed }) { const r = rng(seed); const b = buf(0.3); for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = (r() * 2 - 1) * env(t, 0.001, 0.03) + Math.sin(2 * Math.PI * 140 * t) * env(t, 0.002, 0.06); } return norm(lowpass(b, 3000)); },
  impact({ seed }) { const a = SFX.bigThud({ seed }); const h = SFX.hit({ seed: seed + 3 }); mixInto(a, h, 0, 0.8); return norm(a); },
  whoosh({ seed }) { const r = rng(seed); const len = 0.55; const b = noise(Math.round(len * SR), r); for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] *= Math.sin(Math.PI * t / len) ** 2; } return norm(bandpass(b, (i) => 400 + 2200 * Math.sin(Math.PI * i / b.length), 1.2), 0.7); },
  pop({ seed }) { const b = buf(0.12); for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = Math.sin(2 * Math.PI * (900 - 4000 * t) * t) * env(t, 0.001, 0.025); } return norm(b, 0.7); },
  boing({ seed }) { const b = buf(0.7); let ph = 0; for (let i = 0; i < b.length; i++) { const t = i / SR; const f = 180 + 260 * Math.exp(-t * 6) * (1 + 0.35 * Math.sin(2 * Math.PI * 14 * t)); ph += f / SR; b[i] = Math.sin(2 * Math.PI * ph) * env(t, 0.005, 0.22); } return norm(b, 0.8); },
  buzzer({ seed }) { const b = buf(1.1); for (let i = 0; i < b.length; i++) { const t = i / SR; const sq = Math.sign(Math.sin(2 * Math.PI * 190 * t)) * 0.5 + Math.sign(Math.sin(2 * Math.PI * 381 * t)) * 0.3; b[i] = sq * Math.min(1, t / 0.01) * Math.min(1, (1.1 - t) / 0.05); } return norm(lowpass(b, 2500), 0.6); },
  record({ seed }) { const r = rng(seed); const b = buf(0.45); let ph = 0; for (let i = 0; i < b.length; i++) { const t = i / SR; const f = 300 + 900 * Math.sin(Math.PI * t / 0.45) * (t < 0.2 ? 1 : -0.5); ph += Math.abs(f) / SR; b[i] = (Math.sin(2 * Math.PI * ph) * 0.4 + (r() * 2 - 1) * 0.6) * Math.sin(Math.PI * t / 0.45); } return norm(bandpass(b, 1400, 0.7), 0.7); },
  riser({ seed, dur = 2 }) { const r = rng(seed); const b = noise(Math.round(dur * SR), r); let ph = 0; for (let i = 0; i < b.length; i++) { const t = i / SR, u = t / dur; ph += (120 + 600 * u * u) / SR; b[i] = (b[i] * 0.5 + Math.sin(2 * Math.PI * ph) * 0.5) * u * u; } return norm(bandpass(b, (i) => 300 + 4000 * (i / b.length) ** 2, 0.9), 0.6); },
  stinger({ seed }) { const b = buf(1.6); const notes = [110, 164.8, 220, 261.6]; for (let i = 0; i < b.length; i++) { const t = i / SR; let s = 0; notes.forEach((f, k) => { s += (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t * 1.003)) * (k === 0 ? 1.2 : 0.6); }); b[i] = s * env(t, 0.004, 0.45); } const h = SFX.impact({ seed }); mixInto(b, h, 0, 1.5); return norm(lowpass(b, 4000)); },
  sneeze({ seed }) { const r = rng(seed); const b = noise(Math.round(0.5 * SR), r); for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] *= t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) / 0.09); } return norm(bandpass(b, 2400, 0.8), 0.8); },
  crowdCheer({ seed, dur = 2.5 }) {
    const c = chorus(dur, 26, seed, (t, v) => 180 + (v % 7) * 35 + Math.sin(t * 9 + v) * 20, (t) => Math.min(1, t / 0.12) * Math.exp(-Math.max(0, t - 0.4) / (dur * 0.45)), [[700, 3], [1200, 4], [2600, 6]], 0.45);
    const r = rng(seed + 9); const n = noise(c.length, r); bandpass(n, 1500, 0.5); for (let i = 0; i < c.length; i++) { const t = i / SR; c[i] += n[i] * 1.2 * Math.min(1, t / 0.1) * Math.exp(-Math.max(0, t - 0.4) / (dur * 0.45)); }
    return norm(c, 0.8);
  },
  crowdGasp({ seed }) { const r = rng(seed); const n = noise(Math.round(0.9 * SR), r); for (let i = 0; i < n.length; i++) { const t = i / SR; n[i] *= t < 0.15 ? t / 0.15 : Math.exp(-(t - 0.15) / 0.22); } bandpass(n, (i) => 900 + 1800 * Math.min(1, i / SR / 0.15), 0.9); const c = chorus(0.9, 14, seed, (t) => 260 + 80 * Math.min(1, t / 0.15), (t) => (t < 0.12 ? t / 0.12 : Math.exp(-(t - 0.12) / 0.2)), [[800, 3], [1500, 4]], 0.85); for (let i = 0; i < c.length; i++) c[i] = c[i] * 0.6 + n[i]; return norm(c, 0.75); },
  crowdAww({ seed }) { return norm(chorus(1.8, 20, seed, (t, v) => (200 + (v % 5) * 30) * (1 - 0.18 * Math.min(1, t / 1.2)), (t) => Math.min(1, t / 0.15) * Math.max(0, 1 - t / 1.8), [[750, 4], [1150, 5]], 0.3), 0.75); },
  crowdBoo({ seed }) { return norm(chorus(2.2, 22, seed, (t, v) => 110 + (v % 6) * 18 + Math.sin(t * 3 + v) * 6, (t) => Math.min(1, t / 0.25) * Math.max(0, 1 - t / 2.2), [[350, 4], [800, 6]], 0.3), 0.75); },
  crowdLaugh({ seed }) { return norm(chorus(2.2, 18, seed, (t, v) => 220 + (v % 6) * 40 + 30 * Math.sin(t * 30), (t, v) => Math.max(0, Math.sin(2 * Math.PI * (4.5 + (v % 3) * 0.6) * t)) ** 2 * Math.min(1, t / 0.1) * Math.max(0, 1 - t / 2.2), [[750, 3], [1300, 4]], 0.5), 0.75); },
  giggle({ seed }) { return norm(chorus(0.9, 3, seed, (t) => 520 + 120 * Math.sin(t * 40), (t) => Math.max(0, Math.sin(2 * Math.PI * 7 * t)) ** 2 * Math.max(0, 1 - t / 0.9), [[900, 4], [1800, 6]], 0.3), 0.7); },
  phoneRing({ seed }) { const b = buf(2.4); for (let i = 0; i < b.length; i++) { const t = i / SR; const on = t % 0.05 < 0.025 ? 1 : 0.2; const g = t < 1.4 ? 1 : 0; b[i] = (Math.sin(2 * Math.PI * 1700 * t) + Math.sin(2 * Math.PI * 2100 * t)) * on * g * Math.min(1, t / 0.01); } return norm(bandpass(b, 1900, 1.5), 0.6); },
  creak({ seed }) { const r = rng(seed); const b = buf(1.3); let ph = 0; for (let i = 0; i < b.length; i++) { const t = i / SR; ph += (60 + 40 * Math.sin(t * 5) + r() * 30) / SR; const pulse = (ph % 1) < 0.08 ? 1 : 0; b[i] = pulse * Math.sin(Math.PI * t / 1.3); } return norm(bandpass(b, 900, 3), 0.6); },
  drone({ seed, dur = 4 }) { const b = buf(dur); for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = (Math.sin(2 * Math.PI * 55 * t) + Math.sin(2 * Math.PI * 55.7 * t) + 0.5 * Math.sin(2 * Math.PI * 82.6 * t)) * Math.min(1, t / 1) * Math.min(1, (dur - t) / 1); } return norm(lowpass(b, 400), 0.6); },
  heartbeat({ seed }) { const b = buf(1.0); for (const at of [0, 0.22]) for (let i = 0; i < 0.2 * SR; i++) { const t = i / SR; b[Math.round(at * SR) + i] += Math.sin(2 * Math.PI * 50 * t) * env(t, 0.005, 0.05) * (at ? 0.7 : 1); } return norm(lowpass(b, 300)); },
  click({ seed }) { const b = buf(0.03); for (let i = 0; i < b.length; i++) b[i] = (i % 7 < 3 ? 1 : -1) * env(i / SR, 0.0002, 0.003); return norm(b, 0.5); },
  tick({ seed }) { const b = buf(0.05); for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = Math.sin(2 * Math.PI * 3200 * t) * env(t, 0.0005, 0.008); } return norm(b, 0.5); },
  glitch({ seed }) { const r = rng(seed); const b = buf(0.5); for (let i = 0; i < b.length; i++) { const blk = Math.floor(i / 900); b[i] = (blk % 3 === 0 ? Math.sign(Math.sin(i * (0.05 + (blk % 5) * 0.03))) : r() * 2 - 1) * 0.6; } return norm(b, 0.5); },
  rumble({ seed, dur = 2 }) { const r = rng(seed); const b = noise(Math.round(dur * SR), r); lowpass(b, 120); lowpass(b, 120); for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] *= Math.min(1, t / 0.3) * Math.min(1, (dur - t) / 0.5); } return norm(b, 0.8); },
  alarm({ seed }) { const b = buf(1.6); let ph = 0; for (let i = 0; i < b.length; i++) { const t = i / SR; ph += (700 + 300 * Math.sign(Math.sin(2 * Math.PI * 2.5 * t))) / SR; b[i] = Math.sign(Math.sin(2 * Math.PI * ph)) * 0.4; } return norm(lowpass(b, 3000), 0.5); },
  dingDing({ seed }) { const b = buf(1.2); for (const at of [0, 0.25]) for (let i = 0; i < 0.9 * SR; i++) { const t = i / SR; const idx = Math.round(at * SR) + i; if (idx < b.length) b[idx] += (Math.sin(2 * Math.PI * 1320 * t) + 0.4 * Math.sin(2 * Math.PI * 2640 * t)) * env(t, 0.002, 0.3); } return norm(b, 0.6); },
};

// ------------------------------------------------------------------ ambience
export function ambience(kind: string, sec: number, seed: number): Buf {
  const r = rng(seed); const b = buf(sec);
  if (kind === 'arena') {
    // murmuring crowd bed: filtered noise + slow chorus swells
    const n = noise(b.length, r); bandpass(n, 900, 0.5); lowpass(n, 2500);
    const mur = chorus(Math.min(sec, 12), 16, seed, (t, v) => 150 + (v % 8) * 25 + Math.sin(t * 2.3 + v) * 15, (t, v) => 0.5 + 0.5 * Math.sin(t * (0.7 + v * 0.13) + v), [[600, 3], [1100, 4]], 0.5);
    norm(mur, 1);
    for (let i = 0; i < b.length; i++) b[i] = n[i] * 0.6 + mur[i % mur.length] * 0.35;
    return norm(b, 0.5);
  }
  if (kind === 'room') { const n = noise(b.length, r); lowpass(n, 300); lowpass(n, 300); for (let i = 0; i < b.length; i++) b[i] = n[i] + Math.sin(2 * Math.PI * 60 * i / SR) * 0.02; return norm(b, 0.35); }
  if (kind === 'night') { const n = noise(b.length, r); lowpass(n, 500); for (let i = 0; i < b.length; i++) b[i] = n[i] * (0.7 + 0.3 * Math.sin(i / SR * 0.2)); const d = SFX.drone({ seed, dur: sec }); for (let i = 0; i < b.length; i++) b[i] += d[i] * 0.25; return norm(b, 0.4); }
  if (kind === 'lab') { for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = Math.sin(2 * Math.PI * 120 * t) * 0.15 + Math.sin(2 * Math.PI * 240 * t) * 0.05 + (r() * 2 - 1) * 0.05; } return norm(lowpass(b, 1500), 0.3); }
  return b;
}

// ------------------------------------------------------------------ music
const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
function adsrTone(out: Buf, at: number, dur: number, f: number, g: number, type: 'pluck' | 'pad' | 'bass' | 'bell' | 'saw', pan = 0, outR?: Buf) {
  const o = Math.round(at * SR); const len = Math.round((dur + (type === 'pad' ? 0.6 : 0.3)) * SR);
  let ph = 0, ph2 = 0.25;
  for (let i = 0; i < len && o + i < out.length; i++) {
    const t = i / SR; let e: number; let s: number;
    ph += f / SR; ph2 += (f * 1.004) / SR;
    switch (type) {
      case 'pluck': e = Math.exp(-t / Math.max(0.08, dur * 0.35)); s = Math.sin(2 * Math.PI * ph) * 0.7 + Math.sin(4 * Math.PI * ph) * 0.25 * Math.exp(-t / 0.05) + Math.sin(6 * Math.PI * ph) * 0.1 * Math.exp(-t / 0.03); break;
      case 'bass': e = Math.min(1, t / 0.005) * (t < dur ? 1 : Math.exp(-(t - dur) / 0.05)) * Math.exp(-t / 0.6); s = Math.sin(2 * Math.PI * ph) + 0.35 * Math.sin(4 * Math.PI * ph); break;
      case 'bell': e = Math.exp(-t / 0.8); s = Math.sin(2 * Math.PI * ph) + 0.4 * Math.sin(2 * Math.PI * ph * 2.76) * Math.exp(-t / 0.2) + 0.2 * Math.sin(2 * Math.PI * ph * 5.4) * Math.exp(-t / 0.1); break;
      case 'saw': e = Math.min(1, t / 0.01) * (t < dur ? 1 : Math.exp(-(t - dur) / 0.08)); s = ((ph % 1) * 2 - 1) * 0.5 + ((ph2 % 1) * 2 - 1) * 0.5; break;
      default: e = Math.min(1, t / 0.4) * (t < dur ? 1 : Math.exp(-(t - dur) / 0.4)); s = Math.sin(2 * Math.PI * ph) * 0.5 + Math.sin(2 * Math.PI * ph2) * 0.5 + 0.2 * Math.sin(6 * Math.PI * ph);
    }
    const v = s * e * g;
    if (outR) { out[o + i] += v * (1 - Math.max(0, pan)); outR[o + i] += v * (1 + Math.min(0, pan)); } else out[o + i] += v;
  }
}
function drum(out: Buf, at: number, kind: 'kick' | 'snare' | 'hat' | 'tom', g: number, r: () => number) {
  const o = Math.round(at * SR); const len = Math.round((kind === 'hat' ? 0.06 : 0.3) * SR);
  let lp = 0;
  for (let i = 0; i < len && o + i < out.length; i++) {
    const t = i / SR; let s = 0;
    if (kind === 'kick') s = Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-t * 30)) * t) * Math.exp(-t / 0.12);
    else if (kind === 'tom') s = Math.sin(2 * Math.PI * (90 + 60 * Math.exp(-t * 20)) * t) * Math.exp(-t / 0.15);
    else if (kind === 'snare') { const n = r() * 2 - 1; lp = lp * 0.5 + n * 0.5; s = (n - lp) * Math.exp(-t / 0.08) * 0.8 + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.05) * 0.5; }
    else { const n = r() * 2 - 1; lp = lp * 0.2 + n * 0.8; s = (n - lp) * Math.exp(-t / 0.015); }
    out[o + i] += s * g;
  }
}

/** Simple Schroeder reverb for space. */
function reverb(x: Buf, mix = 0.18) {
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d: Math.round(d * SR / 44100), buf: new Float32Array(Math.round(d * SR / 44100)), i: 0 }));
  const out = new Float32Array(x.length);
  for (let n = 0; n < x.length; n++) { let s = 0; for (const c of combs) { const y = c.buf[c.i]; c.buf[c.i] = x[n] + y * 0.8; c.i = (c.i + 1) % c.d; s += y; } out[n] = x[n] + (s / combs.length) * mix; }
  return out;
}

export interface MusicSpec { style: string; bpm?: number; cues?: { at: number; intensity: number }[]; stopAt?: number; key?: string; gain?: number }

export function music(spec: MusicSpec, sec: number, seed: number): [Buf, Buf] {
  const r = rng(seed); const L = buf(sec), R = buf(sec);
  const style = spec.style;
  const bpm = spec.bpm ?? ({ playful: 112, tension: 84, epic: 128, sad: 70, creepy: 60, chase: 150, mystery: 76 } as Record<string, number>)[style] ?? 110;
  const beat = 60 / bpm; const bars = Math.ceil(sec / (beat * 4));
  const root = ({ C: 48, D: 50, E: 52, F: 53, G: 55, A: 57 } as Record<string, number>)[spec.key ?? 'C'] ?? 48;
  const minor = ['tension', 'creepy', 'sad', 'mystery', 'chase'].includes(style);
  const prog = minor ? [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]] : [[0, 4, 7], [5, 9, 12], [-3, 0, 4], [7, 11, 14]];
  const inten = (t: number) => { let v = 0.6; for (const c of spec.cues ?? []) if (t >= c.at) v = c.intensity; return v; };
  const stop = spec.stopAt ?? 1e9;
  for (let bar = 0; bar < bars; bar++) {
    const chord = prog[bar % prog.length];
    for (let b = 0; b < 4; b++) {
      for (let sub = 0; sub < 2; sub++) {
        const t = (bar * 4 + b + sub / 2) * beat; if (t >= sec || t >= stop) continue;
        const I = inten(t);
        if (style === 'playful' || style === 'epic' || style === 'chase') {
          if (I > 0.3 && sub === 0 && (b === 0 || b === 2 || (style !== 'playful' && I > 0.8))) drum(L, t, 'kick', 0.55, r);
          if (I > 0.45 && sub === 0 && (b === 1 || b === 3)) drum(L, t, 'snare', 0.32, r);
          if (I > 0.6) drum(L, t, 'hat', sub ? 0.12 : 0.18, r);
          if (I > 0.2 && sub === 0) adsrTone(L, t, beat * 0.9, NOTE(root - 12 + chord[0] + (b === 2 ? 7 : 0)), 0.3, 'bass');
          if (style === 'playful' && I > 0.1) { const n = chord[(b * 2 + sub + bar) % 3] + 12 + (r() < 0.25 ? 12 : 0); if (sub === 0 || r() < 0.5) adsrTone(L, t, beat * 0.45, NOTE(root + n), 0.14, 'pluck', (r() - 0.5) * 0.6, R); }
          if (style === 'epic' && sub === 0 && b === 0) for (const n of chord) adsrTone(L, t, beat * 3.8, NOTE(root + n), 0.08, 'saw', 0, R);
          if (style === 'chase' && I > 0.3) adsrTone(L, t, beat * 0.4, NOTE(root + chord[(b + sub) % 3] + 12), 0.1, 'saw', (r() - 0.5) * 0.5, R);
        } else if (style === 'tension' || style === 'mystery') {
          if (sub === 0 && b === 0) for (const n of chord) adsrTone(L, t, beat * 4, NOTE(root + n - 12), 0.07, 'pad', 0, R);
          if (I > 0.4 && sub === 0) adsrTone(L, t, beat * 0.3, NOTE(root - 24 + chord[0]), 0.25 * I, 'bass');
          if (I > 0.65) drum(L, t, 'hat', 0.08, r);
          if (style === 'mystery' && sub === 1 && r() < 0.35) adsrTone(L, t, beat, NOTE(root + 24 + chord[Math.floor(r() * 3)]), 0.06, 'bell', (r() - 0.5), R);
        } else if (style === 'sad') {
          if (sub === 0) adsrTone(L, t, beat * 1.2, NOTE(root + chord[b % 3] + 12), 0.12, 'pluck', (r() - 0.5) * 0.4, R);
          if (sub === 0 && b === 0) for (const n of chord) adsrTone(L, t, beat * 4, NOTE(root + n), 0.05, 'pad', 0, R);
        } else if (style === 'creepy') {
          if (sub === 0 && b === 0) { adsrTone(L, t, beat * 4, NOTE(root - 12 + chord[0]), 0.1, 'pad', -0.3, R); adsrTone(L, t, beat * 4, NOTE(root - 12 + chord[0] + 1) * 1.003, 0.06, 'pad', 0.3, R); }
          if (sub === 0 && r() < 0.4) adsrTone(L, t, beat * 1.5, NOTE(root + 24 + [0, 1, 6, 7][Math.floor(r() * 4)]), 0.05, 'bell', (r() - 0.5), R);
          if (I > 0.6 && sub === 0 && b % 2 === 0) drum(L, t, 'kick', 0.3, r);
        }
      }
    }
  }
  // copy mono-sourced parts to R, add space, apply stop
  for (let i = 0; i < L.length; i++) { const m = L[i]; L[i] = m + (R[i] === 0 ? 0 : 0); R[i] += m; }
  const Lr = reverb(L, 0.22), Rr = reverb(R, 0.22);
  const stopI = Math.round(stop * SR);
  for (let i = stopI; i < Lr.length; i++) { const k = Math.max(0, 1 - (i - stopI) / (0.08 * SR)); Lr[i] *= k; Rr[i] *= k; }
  // master fade out at end
  for (let i = 0; i < Lr.length; i++) { const t = i / SR; const f = Math.min(1, (sec - t) / 1.2, t / 0.3); Lr[i] *= f; Rr[i] *= f; }
  let m = 0; for (let i = 0; i < Lr.length; i++) m = Math.max(m, Math.abs(Lr[i]), Math.abs(Rr[i]));
  const g = m > 0 ? 0.8 / m : 1; for (let i = 0; i < Lr.length; i++) { Lr[i] *= g; Rr[i] *= g; }
  return [Lr, Rr];
}
