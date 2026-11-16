// Split an existing full silent render into per-shot clips so later revisions can reuse them
// (used to migrate renders made before the shot cache existed).
//   npx tsx tools/seed-shot-cache.ts <episodeId> <videoId> <silent.mp4>
import fs from 'node:fs';
import path from 'node:path';
import { run, ROOT } from '../engine/src/render/render';
const [ep, vid, src] = process.argv.slice(2);
const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'productions', ep, 'compiled', `${vid}.json`), 'utf8'));
const dir = path.join(ROOT, 'productions', ep, 'renders', vid); fs.mkdirSync(dir, { recursive: true });
for (const sh of v.shots) {
  const f0 = Math.round(sh.start * v.fps), f1 = Math.round(sh.end * v.fps); if (f1 <= f0) continue;
  const out = path.join(dir, `${String(sh.index).padStart(2, '0')}_${sh.id}_seed.mp4`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `select='between(n\\,${f0}\\,${f1 - 1})',setpts=N/FRAME_RATE/TB`, '-an', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(v.fps), out]);
}
console.log('seeded', v.shots.length, 'shots into', dir);
