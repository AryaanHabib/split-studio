// npm run setup:voices — installs the free local voice model (Kokoro-82M, Apache-2.0).
// Weights come from the npm package "kokoro-q8-shards" (byte-identical to onnx-community/Kokoro-82M-v1.0-ONNX
// model_quantized.onnx; sha256 verified below). Voice style vectors come from the Kokoro-FastAPI repo (Apache-2.0).
// The .pt voice files are read as raw tensor bytes; they are never unpickled.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'tools/models/kokoro'); fs.mkdirSync(dir, { recursive: true });
const SHA = 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478';
const model = path.join(dir, 'kokoro-q8.onnx');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
if (!fs.existsSync(model) || crypto.createHash('sha256').update(fs.readFileSync(model)).digest('hex') !== SHA) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kokoro-'));
  console.log('Downloading model shards from npm…');
  execFileSync(npm, ['pack', 'kokoro-q8-shards@1.0.0', '--silent'], { cwd: tmp, stdio: 'inherit', shell: process.platform === 'win32' });
  const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
  execFileSync('tar', ['xzf', tgz], { cwd: tmp });
  const parts = [0, 1, 2, 3, 4, 5].map((i) => fs.readFileSync(path.join(tmp, 'package', `kokoro-q8.part${i}.bin`)));
  const buf = Buffer.concat(parts);
  const h = crypto.createHash('sha256').update(buf).digest('hex');
  if (h !== SHA) throw new Error(`Model checksum mismatch (${h}). Not installing.`);
  fs.writeFileSync(model, buf); console.log('Model installed and verified.');
} else console.log('Model already installed.');
const VOICES = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'bf_emma', 'bm_fable', 'bm_george', 'bm_lewis'];
const vdir = path.join(dir, 'voices-src'); fs.mkdirSync(vdir, { recursive: true });
for (const v of VOICES) {
  const f = path.join(vdir, `${v}.pt`); if (fs.existsSync(f)) continue;
  const r = await fetch(`https://raw.githubusercontent.com/remsky/Kokoro-FastAPI/master/api/src/voices/v1_0/${v}.pt`);
  if (!r.ok) { console.warn(`voice ${v}: HTTP ${r.status}`); continue; }
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); console.log(`voice ${v}`);
}
const py = process.env.STUDIO_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
// no -I: isolated mode hides user-installed packages (pip --user on Windows). The script only reads the .pt files as raw bytes.
execFileSync(py, [path.join(ROOT, 'tools/build_voices.py'), vdir, path.join(dir, 'voices.npz')], { stdio: 'inherit' });
console.log('Done. Test with: npm run doctor');
