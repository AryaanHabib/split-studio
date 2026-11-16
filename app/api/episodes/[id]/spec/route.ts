import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { EPISODES, snapshotSpec, enqueue } from '@/lib/server/store';
export const dynamic = 'force-dynamic';
// Import a production plan generated in a Claude Code session (or edited by hand).
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const f = path.join(EPISODES, (await params).id, 'episode.json');
  return fs.existsSync(f) ? new NextResponse(fs.readFileSync(f), { headers: { 'content-type': 'application/json' } }) : NextResponse.json({ error: 'no spec yet' }, { status: 404 });
}
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id; const text = await req.text();
  let spec: any; try { spec = JSON.parse(text); } catch (e: any) { return NextResponse.json({ error: `Not valid JSON: ${e.message}` }, { status: 400 }); }
  if (!spec.videos || !spec.scenes || !spec.characters) return NextResponse.json({ error: 'This does not look like an episode spec (needs characters, scenes, videos).' }, { status: 400 });
  const dir = path.join(EPISODES, id); fs.mkdirSync(dir, { recursive: true });
  snapshotSpec(id, 'before import');
  spec.id = spec.id ?? id;
  fs.writeFileSync(path.join(dir, 'episode.json'), JSON.stringify(spec, null, 1));
  fs.appendFileSync(path.join(dir, 'revisions.md'), `\n- ${new Date().toISOString()} — spec imported via website\n`);
  const job = enqueue(id, 'compile');
  return NextResponse.json({ ok: true, job });
}
