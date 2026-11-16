// npm run app — builds the preview runtime, starts the website and the background worker together.
import { spawn } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const node = process.execPath;
const run = (name, args) => { const p = spawn(node, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } }); const pre = `[${name}] `; p.stdout.on('data', (d) => process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => pre + l).join('\n') + '\n')); p.stderr.on('data', (d) => process.stderr.write(pre + d)); return p; };
await new Promise((res) => run('build', ['tools/build-preview.mjs']).on('close', res));
const prod = process.argv.includes('--prod');
const web = run('web', [path.join(root, 'node_modules/next/dist/bin/next'), prod ? 'start' : 'dev', '-p', process.env.PORT ?? '3000']);
const worker = run('worker', [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'worker/worker.ts']);
console.log(`THE SPLIT STUDIO → http://localhost:${process.env.PORT ?? '3000'}`);
const stop = () => { web.kill(); worker.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
