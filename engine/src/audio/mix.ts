// Audio mixdown for a compiled video: voices, SFX, music, ambience.
// Music is ducked under speech; the result is loudness-normalized (EBU R128)
// to -14 LUFS integrated / -1.5 dBTP, a common target for short-form platforms.
import fs from 'node:fs';
import path from 'node:path';
import type { CompiledVideo } from '../shared/types';
import { SFX, SR, music, ambience } from './synth';
import { run, ROOT } from '../render/render';

const db = (x: number) => Math.pow(10, x / 20);

export function readWav(file: string): Float32Array {
  const b = fs.readFileSync(file);
  let p = 12; let fmt: any = null; let data: Buffer | null = null;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4); const sz = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + sz);
    p += 8 + sz + (sz % 2);
  }
  if (!fmt || !data) throw new Error(`Bad WAV ${file}`);
  const n = Math.floor(data.length / (fmt.bits / 8) / fmt.ch); const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) { const o = (i * fmt.ch + c) * (fmt.bits / 8); s += fmt.bits === 16 ? data.readInt16LE(o) / 32768 : fmt.bits === 32 && fmt.format === 3 ? data.readFloatLE(o) : fmt.bits === 24 ? (data.readIntLE(o, 3) / 8388608) : data.readInt32LE(o) / 2147483648; }
    mono[i] = s / fmt.ch;
  }
  return resample(mono, fmt.sr / SR);
}

/** Linear resample. ratio = source_rate / target_rate (also used for varispeed). */
export function resample(x: Float32Array, ratio: number): Float32Array {
  if (Math.abs(ratio - 1) < 1e-6) return x;
  const n = Math.floor(x.length / ratio); const o = new Float32Array(n);
  for (let i = 0; i < n; i++) { const f = i * ratio; const k = Math.floor(f); const w = f - k; o[i] = (x[k] ?? 0) * (1 - w) + (x[k + 1] ?? 0) * w; }
  return o;
}

export function writeWavStereo(file: string, L: Float32Array, R: Float32Array) {
  const n = L.length; const b = Buffer.alloc(44 + n * 8);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 8, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 8, 28); b.writeUInt16LE(8, 32); b.writeUInt16LE(32, 34); b.write('data', 36); b.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) { b.writeFloatLE(L[i], 44 + i * 8); b.writeFloatLE(R[i], 48 + i * 8); }
  fs.writeFileSync(file, b);
}

// voice processing presets (FFmpeg filter chains)
const FX: Record<string, string> = {
  phone: 'highpass=f=350,lowpass=f=3200,acompressor=threshold=-20dB:ratio=6,volume=1.6',
  radio: 'highpass=f=500,lowpass=f=2800,acrusher=bits=10:mix=0.3,volume=1.4',
  echo: 'aecho=0.8:0.7:180|320:0.35|0.2',
  whisper: 'highpass=f=900,volume=0.8',
  demon: 'rubberband=pitch=0.7,aecho=0.8:0.6:60:0.3',
};

const AMBIENCE: Record<string, string> = { court: 'arena', apartment: 'night', lab: 'lab' };

export interface MixReport { voices: number; sfx: number; missing: string[]; file: string; lufs?: number }

export async function mixVideo(video: CompiledVideo, outDir: string): Promise<MixReport> {
  fs.mkdirSync(outDir, { recursive: true });
  const N = Math.ceil(video.duration * SR) + SR;
  const vL = new Float32Array(N), vR = new Float32Array(N); // voice bus
  const sL = new Float32Array(N), sR = new Float32Array(N); // sfx bus
  const missing: string[] = [];
  const sfxCache = new Map<string, Float32Array>();
  let nv = 0, ns = 0;
  const place = (L: Float32Array, R: Float32Array, src: Float32Array, at: number, g: number, pan = 0) => {
    const o = Math.round(at * SR); const gl = g * Math.min(1, 1 - pan), gr = g * Math.min(1, 1 + pan);
    for (let i = 0; i < src.length; i++) { const k = o + i; if (k < 0 || k >= N) continue; L[k] += src[i] * gl; R[k] += src[i] * gr; }
  };
  for (const [k, cue] of video.audio.entries()) {
    if (cue.kind === 'voice') {
      if (!cue.file || !fs.existsSync(cue.file)) { missing.push(`voice:${cue.text}`); continue; }
      let file = cue.file;
      if (cue.rate && Math.abs(cue.rate - 1) > 0.01) { // pitch shift, keep timing
        const pf = file.replace(/\.wav$/, `_p${cue.rate.toFixed(3)}.wav`);
        if (!fs.existsSync(pf)) await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-af', `rubberband=pitch=${cue.rate}:formant=preserved`, pf]).catch(async () => { await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-af', `asetrate=24000*${cue.rate},aresample=24000,atempo=${1 / cue.rate!}`, pf]); });
        file = pf;
      }
      if (cue.fx && FX[cue.fx]) {
        const ff = file.replace(/\.wav$/, `_${cue.fx}.wav`);
        if (!fs.existsSync(ff)) await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-af', FX[cue.fx], ff]);
        file = ff;
      } else if (cue.fx) missing.push(`fx:${cue.fx}`);
      let s = readWav(file); if (cue.offset) s = s.subarray(Math.round(cue.offset * SR));
      place(vL, vR, s, cue.t, db(cue.gain ?? 0)); nv++;
    } else if (cue.kind === 'sfx') {
      const variant = k % 5; const ckey = `${cue.id}:${variant}:${cue.dur ? cue.dur.toFixed(2) : ''}`;
      let s = sfxCache.get(ckey);
      if (!s) {
        const override = path.join(ROOT, 'assets/sfx', `${cue.id}.wav`);
        if (fs.existsSync(override)) s = readWav(override);
        else if (SFX[cue.id]) s = SFX[cue.id]({ seed: 1000 + variant * 77 + cue.id.length, dur: cue.dur });
        else { missing.push(`sfx:${cue.id}`); continue; }
        sfxCache.set(ckey, s);
      }
      const src = cue.rate && cue.rate !== 1 ? resample(s, cue.rate) : s;
      const pan = ((k * 0.37) % 0.6) - 0.3;
      place(sL, sR, src, cue.t, db((cue.gain ?? 0) - 3), pan); ns++;
    }
  }
  // music + ambience
  const [mL, mR] = video.music ? music(video.music as any, N / SR, video.seed) : [new Float32Array(N), new Float32Array(N)];
  const setId = video.scenes[0]?.set.preset;
  const amb = ambience(AMBIENCE[setId] ?? 'room', N / SR, video.seed + 5);
  // crowd reactions from scene "crowd" events are already sfx; ambience is a constant bed
  // sidechain: speech envelope ducks music/ambience
  const envV = new Float32Array(N); let e = 0;
  for (let i = 0; i < N; i++) { const x = Math.max(Math.abs(vL[i]), Math.abs(vR[i])); const a = x > e ? 0.004 : 0.00012; e += (x - e) * a; envV[i] = e; }
  const musicGain = db(video.music?.gain ?? -13), ambGain = db(-21);
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const duck = 1 - Math.min(0.65, envV[i] * 6);
    L[i] = vL[i] + sL[i] + mL[i] * musicGain * duck + amb[i] * ambGain * (1 - Math.min(0.4, envV[i] * 4));
    R[i] = vR[i] + sR[i] + mR[i] * musicGain * duck + amb[i] * ambGain * (1 - Math.min(0.4, envV[i] * 4));
  }
  const raw = path.join(outDir, `${video.id}_mix_raw.wav`);
  writeWavStereo(raw, L.subarray(0, Math.ceil(video.duration * SR)), R.subarray(0, Math.ceil(video.duration * SR)));
  // two-pass loudness normalization
  const out = path.join(outDir, `${video.id}_mix.wav`);
  const meas = await run('ffmpeg', ['-hide_banner', '-i', raw, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { capture: true, stderr: true }).catch((err) => String(err));
  const m = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(meas);
  let lufs: number | undefined;
  if (m) {
    const j = JSON.parse(m[0]); lufs = parseFloat(j.input_i);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`, '-ar', '48000', out]);
  } else fs.copyFileSync(raw, out);
  return { voices: nv, sfx: ns, missing, file: out, lufs };
}

export async function mux(videoFile: string, audioFile: string, out: string) {
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', videoFile, '-i', audioFile, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out]);
}
