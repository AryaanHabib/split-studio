#!/usr/bin/env node
// THE SPLIT STUDIO — production CLI.
//   studio validate <episode.json>             schema + feasibility report (no rendering)
//   studio produce  <episode.json> [options]   TTS -> compile -> render -> mix -> covers -> QC
//   studio stills   <episode.json> <video> <t1,t2,...>   quick frame previews
// Options: --videos main,red,blue  --scale 0.5 (preview)  --force  --workers 1  --no-covers
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Exit code meaning "the spec has errors" (a normal outcome, reported in feasibility.json), as opposed to 1 = crash. */
const EXIT_SPEC_ERRORS = 3;
import { spawn } from 'node:child_process';
import { EpisodeSchema, type Episode } from './compiler/schema';
import { compileEpisode, collectTts, type TtsResult, type TtsLine, type Issue } from './compiler/compile';
import { buildRuntime, renderStills, renderRanges, concatClips, ROOT } from './render/render';
import { mixVideo, mux } from './audio/mix';
import { makeCovers } from './covers/covers';
import { qcVideo } from './qc/qc';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true') : d; };

function loadEpisode(file: string): Episode {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = EpisodeSchema.safeParse(raw);
  if (!r.success) {
    console.error('Episode spec is invalid:');
    for (const i of r.error.issues) console.error(`  - ${i.path.join('.')}: ${i.message}`);
    process.exit(2);
  }
  return r.data;
}

export async function synthesize(lines: TtsLine[], outDir: string): Promise<Record<string, TtsResult>> {
  if (!lines.length) return {};
  const py = process.env.STUDIO_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const model = path.join(ROOT, 'tools/models/kokoro/kokoro-q8.onnx'), voices = path.join(ROOT, 'tools/models/kokoro/voices.npz');
  if (!fs.existsSync(model)) throw new Error(`Kokoro model missing at ${model}. Run: npm run setup:voices`);
  return new Promise((resolve, reject) => {
    const p = spawn(py, [path.join(ROOT, 'engine/src/audio/tts.py'), '--out', outDir, '--model', model, '--voices', voices], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = ''; p.stdout.on('data', (d) => (out += d));
    p.on('close', (c) => (c === 0 ? resolve(JSON.parse(out)) : reject(new Error(`TTS worker exited ${c}`))));
    p.stdin.write(JSON.stringify(lines)); p.stdin.end();
  });
}

function printIssues(issues: Issue[]) {
  const by = { error: issues.filter((i) => i.level === 'error'), warning: issues.filter((i) => i.level === 'warning') };
  for (const i of by.error) console.log(`  ✗ ERROR   ${i.where}: ${i.msg}${i.fix ? `\n            fix: ${i.fix}` : ''}`);
  for (const i of by.warning) console.log(`  ! warning ${i.where}: ${i.msg}`);
  console.log(`  ${by.error.length} error(s), ${by.warning.length} warning(s)`);
  return by.error.length;
}

async function compileWithTts(ep: Episode, prodDir: string) {
  const lines = collectTts(ep);
  console.log(`• speech: ${lines.length} line(s) via local Kokoro TTS`);
  const tts = await synthesize(lines, path.join(prodDir, 'audio/tts'));
  return { ...(await compileEpisode(ep, tts)), tts };
}

async function main() {
  if (!cmd || cmd === 'help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 7).join('\n')); return; }
  const epFile = args[1]; if (!epFile) throw new Error('episode.json path required');
  const ep = loadEpisode(epFile);
  const prodDir = path.join(ROOT, 'productions', ep.id);
  fs.mkdirSync(prodDir, { recursive: true });

  if (cmd === 'validate') {
    const { issues } = await compileEpisode(ep, Object.fromEntries(collectTts(ep).map((l) => [l.key, { file: '', dur: Math.max(0.8, l.text.split(' ').length * 0.33), env: [] }])));
    console.log(`Feasibility report for "${ep.title}" (${ep.id})  [speech durations estimated]`);
    fs.writeFileSync(path.join(prodDir, 'feasibility.json'), JSON.stringify(issues, null, 2));
    process.exit(printIssues(issues) ? EXIT_SPEC_ERRORS : 0);
  }

  if (cmd === 'compile') {
    // speech + compile + feasibility, no rendering (used by the website's live preview)
    const { videos, issues } = await compileWithTts(ep, prodDir);
    const nErr = printIssues(issues);
    fs.mkdirSync(path.join(prodDir, 'compiled'), { recursive: true });
    for (const [vid, v] of Object.entries(videos)) fs.writeFileSync(path.join(prodDir, 'compiled', `${vid}.json`), JSON.stringify(v));
    fs.writeFileSync(path.join(prodDir, 'feasibility.json'), JSON.stringify(issues, null, 2));
    fs.writeFileSync(path.join(prodDir, 'compiled', 'index.json'), JSON.stringify(Object.fromEntries(Object.entries(videos).map(([k, v]) => [k, { title: v.title, duration: v.duration, shots: v.shots.map((s) => ({ id: s.id, start: s.start, end: s.end, purpose: s.purpose, camera: s.camera.type })) }]))));
    console.log(`compiled ${Object.keys(videos).length} video(s)`);
    process.exit(nErr ? EXIT_SPEC_ERRORS : 0);
  }

  if (cmd === 'stills') {
    const { videos, issues } = await compileWithTts(ep, prodDir); printIssues(issues);
    const v = videos[args[2]];
    // times may be numbers (video seconds) or shot ids (mid-shot) or id@offset
    const times = (args[3] ?? '1').split(',').map((x) => { if (/^[0-9.]+$/.test(x)) return Number(x); const [id, off] = x.split('@'); const sh = v.shots.find((s) => s.id === id); if (!sh) throw new Error(`unknown shot ${id}`); return off !== undefined ? sh.start + Number(off) : (sh.start + sh.end) / 2; });
    await buildRuntime(); const dir = path.join(prodDir, 'stills'); fs.mkdirSync(dir, { recursive: true });
    await renderStills(v, times, times.map((t) => path.join(dir, `${v.id}_${t.toFixed(2)}.png`)), flag('overlays', 'true') === 'true', Number(flag('scale', '0.5')));
    console.log(`stills -> ${dir}`); return;
  }

  if (cmd === 'produce') {
    const log: string[] = []; const L = (s: string) => { console.log(s); log.push(s); };
    const t0 = Date.now();
    L(`THE SPLIT STUDIO — producing "${ep.title}" (${ep.id})`);
    const { videos, issues } = await compileWithTts(ep, prodDir);
    const nErr = printIssues(issues);
    fs.writeFileSync(path.join(prodDir, 'feasibility.json'), JSON.stringify(issues, null, 2));
    if (nErr && flag('allow-errors') !== 'true') { L('Stopping: fix the errors above (nothing was silently dropped).'); process.exit(EXIT_SPEC_ERRORS); }
    const which = (flag('videos') ?? Object.keys(videos).join(',')).split(',');
    const scale = Number(flag('scale', '1'));
    const dirs = { compiled: path.join(prodDir, 'compiled'), renders: path.join(prodDir, 'renders'), audio: path.join(prodDir, 'audio'), final: path.join(prodDir, 'final'), covers: path.join(prodDir, 'covers'), qc: path.join(prodDir, 'qc') };
    Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
    await buildRuntime();
    const results: Record<string, any> = {};
    for (const vid of which) {
      const v = videos[vid]; if (!v) { L(`unknown video ${vid}`); continue; }
      const json = JSON.stringify(v); const hash = crypto.createHash('sha1').update(json + scale).digest('hex').slice(0, 12);
      fs.writeFileSync(path.join(dirs.compiled, `${vid}.json`), json);
      // ---- per-shot render cache: a shot is re-rendered only if something that affects its pixels changed
      const RENDER_VERSION = 'r3';
      const sceneHash: Record<string, string> = {};
      for (const sc of v.scenes) sceneHash[sc.id] = crypto.createHash('sha1').update(JSON.stringify(sc)).digest('hex');
      const shotDir = path.join(dirs.renders, vid); fs.mkdirSync(shotDir, { recursive: true });
      const forced = new Set((flag('shots') ?? '').split(',').filter(Boolean));
      const reuseOld = flag('reuse-shots') === 'true';
      const plan = v.shots.map((sh) => {
        const f0 = Math.round(sh.start * v.fps), f1 = Math.round(sh.end * v.fps);
        const ov = v.overlays.filter((o) => o.t1 > sh.start && o.t0 < sh.end);
        const h = crypto.createHash('sha1').update(JSON.stringify({ RENDER_VERSION, sh, f0, f1, scene: sceneHash[sh.scene], ov, grade: v.grade, scale, w: v.width, h: v.height })).digest('hex').slice(0, 12);
        const out = path.join(shotDir, `${String(sh.index).padStart(2, '0')}_${sh.id}_${h}.mp4`);
        let use = out;
        if (!fs.existsSync(out) && reuseOld && !forced.has(sh.id)) { const prev = fs.readdirSync(shotDir).filter((f) => f.startsWith(`${String(sh.index).padStart(2, '0')}_${sh.id}_`) && f.endsWith('.mp4') && !f.includes('.tmp')).map((f) => path.join(shotDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]; if (prev) use = prev; }
        const need = flag('force') === 'true' || forced.has(sh.id) || !fs.existsSync(use);
        return { sh, f0, f1, out, use: need ? out : use, need };
      }).filter((p) => p.f1 > p.f0);
      const todo = plan.filter((p) => p.need);
      L(`  shots: ${plan.length - todo.length} cached, ${todo.length} to render (${todo.reduce((n, p) => n + p.f1 - p.f0, 0)} frames)`);
      if (todo.length) {
        let last = 0;
        const r = await renderRanges(v, todo.map((p) => ({ from: p.f0, to: p.f1, out: p.out })), { scale, onProgress: (d, n) => { const now = Date.now(); if (now - last > 15000 || d === n) { last = now; process.stdout.write(`  render ${d}/${n} frames (${((d / n) * 100).toFixed(0)}%)\n`); } } });
        L(`  rendered ${r.frames} frames in ${r.seconds.toFixed(0)}s (${(r.frames / Math.max(1, r.seconds)).toFixed(2)} fps)`);
      }
      const silent = path.join(dirs.renders, `${vid}_${hash}.mp4`);
      await concatClips(plan.map((p) => p.use), silent);
      const mix = await mixVideo(v, dirs.audio);
      L(`  audio: ${mix.voices} voice line(s), ${mix.sfx} sfx, music=${v.music?.style ?? 'none'}, input loudness ${mix.lufs?.toFixed(1)} LUFS -> normalized to -14${mix.missing.length ? `, MISSING: ${mix.missing.join(', ')}` : ''}`);
      const final = path.join(dirs.final, `${ep.id}_${vid}.mp4`);
      if (scale !== 1) {
        // preview renders are upscaled so the deliverable keeps platform dimensions
        const up = silent.replace('.mp4', '_up.mp4');
        await (await import('./render/render')).run('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-vf', `scale=${v.width}:${v.height}:flags=lanczos`, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', up]);
        await mux(up, mix.file, final);
      } else await mux(silent, mix.file, final);
      const qc = await qcVideo(final, v, path.join(dirs.qc, `${vid}_contact.jpg`));
      const bad = qc.filter((c) => !c.ok);
      L(`  QC: ${qc.length - bad.length}/${qc.length} checks passed${bad.length ? ' — ' + bad.map((b) => `${b.level === 'error' ? '✗' : '!'} ${b.name}: ${b.detail}`).join('; ') : ''}`);
      results[vid] = { file: final, duration: v.duration, shots: v.shots.length, qc, renderScale: scale, mix };
    }
    if (flag('no-covers') !== 'true' && ep.covers) {
      const cv = videos[ep.covers.video]; const shot = typeof ep.covers.shot === 'number' ? cv.shots[ep.covers.shot] : cv.shots.find((s) => s.id === ep.covers!.shot);
      if (shot) {
        const src = path.join(dirs.covers, 'cover_source.png');
        await renderStills(cv, [shot.start + ep.covers.at], [src], false, 1);
        const c = await makeCovers(src, dirs.covers, { label: ep.covers.label });
        L(`\n▶ covers: ${Object.values(c).map((p) => path.relative(ROOT, p)).join(', ')}`);
        results.covers = c;
      } else L(`cover shot ${ep.covers.shot} not found`);
    }
    fs.writeFileSync(path.join(prodDir, 'report.json'), JSON.stringify({ episode: ep.id, title: ep.title, at: new Date().toISOString(), seconds: (Date.now() - t0) / 1000, issues, results }, null, 2));
    fs.writeFileSync(path.join(prodDir, 'produce.log'), log.join('\n'));
    L(`\nDone in ${((Date.now() - t0) / 60000).toFixed(1)} min → ${path.relative(ROOT, dirs.final)}`);
    return;
  }
  throw new Error(`Unknown command ${cmd}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
