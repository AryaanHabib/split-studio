// Offline renderer: headless Chromium executes the runtime frame-by-frame and
// streams JPEG frames into FFmpeg. Frames are independent, so ranges can be
// rendered by several browser pages in parallel and re-rendered selectively.
import { chromium, type Browser } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import type { CompiledVideo } from '../shared/types';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

const BUNDLE = `runtime-${process.pid}`;
export async function buildRuntime() {
  const out = path.join(ROOT, `engine/dist/${BUNDLE}.js`);
  await esbuild.build({ entryPoints: [path.join(ROOT, 'engine/src/runtime/main.ts')], bundle: true, format: 'iife', outfile: out, target: 'es2022', minify: false, sourcemap: false, logLevel: 'warning' });
  fs.writeFileSync(path.join(ROOT, `engine/dist/${BUNDLE}.html`), `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{display:block;max-width:100%}</style></head><body><script src="${BUNDLE}.js"></script></body></html>`);
  process.once('exit', () => { for (const ext of ['js', 'html']) try { fs.unlinkSync(path.join(ROOT, `engine/dist/${BUNDLE}.${ext}`)); } catch {} });
  return out;
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.otf': 'font/otf', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav' };
export function serve(): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent((req.url ?? '/').split('?')[0]);
      const f = path.join(ROOT, path.normalize(u).replace(/^([/\\])+/, ''));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => { const a = srv.address() as any; resolve({ url: `http://127.0.0.1:${a.port}`, close: () => srv.close() }); });
  });
}

export async function launch(): Promise<Browser> {
  const gpu = process.env.STUDIO_GPU === '1';
  const args = gpu ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  return chromium.launch({ args, headless: true });
}

async function openPage(browser: Browser, base: string, video: CompiledVideo, scale: number) {
  const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error(`[page] ${m.text()}`); });
  page.on('pageerror', (e) => console.error(`[page error] ${e.message}`));
  await page.goto(`${base}/engine/dist/${BUNDLE}.html`);
  const info = await page.evaluate(([v, b, s]) => (window as any).studio.load(v, b, s), [video, `${base}/assets`, scale] as const);
  return { page, info };
}

export interface RenderOpts { out: string; scale?: number; from?: number; to?: number; workers?: number; quality?: number; onProgress?: (done: number, total: number) => void; crf?: number }

/** Render frames [from,to) of a compiled video to a silent H.264 MP4. */
export async function renderVideo(video: CompiledVideo, opts: RenderOpts) {
  const scale = opts.scale ?? 1;
  const total = Math.round(video.duration * video.fps);
  const from = opts.from ?? 0, to = Math.min(total, opts.to ?? total);
  const workers = Math.max(1, Math.min(opts.workers ?? 2, Math.ceil((to - from) / 30)));
  const srv = await serve(); const browser = await launch();
  const W = Math.round(video.width * scale / 2) * 2, H = Math.round(video.height * scale / 2) * 2;
  const tmpDir = opts.out + '.parts'; fs.mkdirSync(tmpDir, { recursive: true });
  let done = 0; const t0 = Date.now();
  try {
    const chunk = Math.ceil((to - from) / workers);
    const parts = await Promise.all(Array.from({ length: workers }, async (_, w) => {
      const a = from + w * chunk, b = Math.min(to, a + chunk); if (a >= b) return null;
      const partFile = path.join(tmpDir, `part${String(w).padStart(2, '0')}.mp4`);
      const { page } = await openPage(browser, srv.url, video, scale);
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(video.fps), '-c:v', 'mjpeg', '-i', '-', '-vf', `scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(opts.crf ?? 18), '-r', String(video.fps), partFile], { stdio: ['pipe', 'inherit', 'inherit'] });
      const ffDone = new Promise<void>((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
      for (let i = a; i < b; i++) {
        const r = await page.evaluate(([i, q]) => (window as any).studio.frame(i, q), [i, opts.quality ?? 0.92] as const);
        const buf = Buffer.from(r.data.slice(r.data.indexOf(',') + 1), 'base64');
        if (!ff.stdin.write(buf)) await new Promise((r2) => ff.stdin.once('drain', r2));
        done++; opts.onProgress?.(done, to - from);
      }
      ff.stdin.end(); await ffDone; await page.close();
      return partFile;
    }));
    const list = parts.filter(Boolean) as string[];
    fs.writeFileSync(path.join(tmpDir, 'list.txt'), list.map((p) => `file '${path.resolve(p)}'`).join('\n'));
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(tmpDir, 'list.txt'), '-c', 'copy', opts.out]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } finally { await browser.close(); srv.close(); }
  return { frames: to - from, seconds: (Date.now() - t0) / 1000 };
}

/** Render single stills (PNG) at given video times. */
export async function renderStills(video: CompiledVideo, times: number[], outPaths: string[], overlays = false, scale = 1) {
  const srv = await serve(); const browser = await launch();
  try {
    const { page } = await openPage(browser, srv.url, video, scale);
    for (let i = 0; i < times.length; i++) {
      const data: string = await page.evaluate(([t, o]) => (window as any).studio.still(t, o), [times[i], overlays] as const);
      fs.writeFileSync(outPaths[i], Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
    }
  } finally { await browser.close(); srv.close(); }
}

export function run(cmd: string, args: string[], opts: { capture?: boolean; input?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [opts.input !== undefined ? 'pipe' : 'ignore', opts.capture ? 'pipe' : 'inherit', 'pipe'] });
    let out = '', err = '';
    p.stdout?.on('data', (d) => (out += d)); p.stderr?.on('data', (d) => { err += d; });
    if (opts.input !== undefined) { p.stdin!.write(opts.input); p.stdin!.end(); }
    p.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.slice(0, 6).join(' ')}… exited ${c}\n${err.slice(-2000)}`))));
  });
}
