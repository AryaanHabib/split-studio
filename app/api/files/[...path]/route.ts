import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '@/lib/server/store';
export const dynamic = 'force-dynamic';
const ALLOWED = ['productions', 'episodes', 'assets'];
const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.glb': 'model/gltf-binary', '.otf': 'font/otf', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8' };
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path.map(decodeURIComponent);
  const abs = path.resolve(ROOT, ...parts);
  if (!ALLOWED.some((d) => abs.startsWith(path.join(ROOT, d) + path.sep)) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return new Response('not found', { status: 404 });
  const size = fs.statSync(abs).size; const type = TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.get('range');
  const headers: Record<string, string> = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)!; const start = m[1] ? Number(m[1]) : 0; const end = m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
    const stream = fs.createReadStream(abs, { start, end });
    return new Response(stream as any, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) } });
  }
  return new Response(fs.createReadStream(abs) as any, { headers: { ...headers, 'content-length': String(size) } });
}
