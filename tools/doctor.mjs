// npm run doctor — inspects THIS machine and reports what the studio can use.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ok = (b) => (b ? '✓' : '✗');
const out = [];
const P = (s) => { console.log(s); out.push(s); };
const tryRun = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return null; } };

P(`THE SPLIT STUDIO — environment report (${new Date().toISOString()})`);
P(`OS: ${os.type()} ${os.release()} (${process.platform}/${process.arch})`);
const cpus = os.cpus();
P(`CPU: ${cpus[0]?.model} × ${cpus.length} threads`);
P(`RAM: ${(os.totalmem() / 2 ** 30).toFixed(1)} GB total, ${(os.freemem() / 2 ** 30).toFixed(1)} GB free`);
try { const s = fs.statfsSync(ROOT); P(`Disk (project drive): ${((s.bavail * s.bsize) / 2 ** 30).toFixed(1)} GB free`); } catch { P('Disk: unknown'); }
P(`Node: ${process.version} ${ok(parseInt(process.versions.node) >= 20)} (need ≥ 20)`);
if (process.platform === 'win32') { const gpu = tryRun('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name']); P(`GPU (Windows): ${gpu ?? 'unknown'}`); }
else { const gpu = tryRun('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader']); P(`GPU (nvidia-smi): ${gpu ?? 'none detected'}`); }
const ff = tryRun('ffmpeg', ['-version']); P(`FFmpeg: ${ok(ff)} ${ff ? ff.split('\n')[0] : 'not on PATH → Windows: winget install --id Gyan.FFmpeg -e  (then open a NEW terminal)'}`);
if (ff) { const filters = tryRun('ffmpeg', ['-hide_banner', '-filters']) ?? ''; P(`  rubberband (pitch-preserving voice shift): ${ok(filters.includes('rubberband'))}  loudnorm: ${ok(filters.includes('loudnorm'))}`); }
const py = process.env.STUDIO_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const pyv = tryRun(py, ['--version']); P(`Python (${py}): ${ok(pyv)} ${pyv ?? 'not found — install Python 3.10+ from python.org'}`);
if (pyv) { const k = tryRun(py, ['-c', 'import kokoro_onnx, soundfile, numpy; print("ok")']); P(`  kokoro-onnx/soundfile/numpy: ${ok(k)} ${k ? '' : '→ pip install kokoro-onnx soundfile numpy'}`); }
const model = path.join(ROOT, 'tools/models/kokoro/kokoro-q8.onnx'), voices = path.join(ROOT, 'tools/models/kokoro/voices.npz');
P(`Kokoro model: ${ok(fs.existsSync(model))}  voice pack: ${ok(fs.existsSync(voices))} ${fs.existsSync(model) && fs.existsSync(voices) ? '' : '→ npm run setup:voices'}`);

// WebGL renderer + quick benchmark in headless Chromium
try {
  const { chromium } = await import('playwright');
  for (const mode of ['gpu', 'software']) {
    const args = mode === 'gpu' ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=default'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
    const b = await chromium.launch({ args, headless: true });
    const p = await b.newPage();
    const r = await p.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); if (!g) return 'no WebGL2'; const d = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : g.RENDERER); });
    P(`Chromium WebGL (${mode} flags): ${r}`);
    await b.close();
  }
} catch (e) { P(`Chromium/Playwright: ✗ ${e.message.split('\n')[0]} → npx playwright install chromium`); }

P('');
P('Recommendations:');
P('- If the "gpu flags" renderer above names your graphics card (not SwiftShader), set STUDIO_GPU=1 before `npm run produce` for much faster renders.');
P(`- Render workers: ${Math.max(1, Math.min(4, Math.floor(cpus.length / 4)))} (use --workers N) when rendering on GPU; 1 when on SwiftShader (it already uses all cores).`);
P('- Preview renders: --scale 0.5 (≈3× faster), then render the approved cut at full resolution.');
fs.mkdirSync(path.join(ROOT, 'productions'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'productions/doctor.txt'), out.join('\n'));
console.log('\nSaved productions/doctor.txt');
