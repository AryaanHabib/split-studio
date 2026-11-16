import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { EPISODES } from '@/lib/server/store';
export const dynamic = 'force-dynamic';
// Manual fallback: the exact command to paste into a Claude Code session in this folder.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const req = JSON.parse(fs.readFileSync(path.join(EPISODES, id, 'request.json'), 'utf8'));
  const lines = Object.entries(req).filter(([k, v]) => v && !['id', 'created_at'].includes(k)).map(([k, v]) => `${k.toUpperCase()}: ${v}`);
  return NextResponse.json({ prompt: `/develop-story Use episode id "${id}" (folder episodes/${id}/, request.json is there).\n${lines.join('\n')}` });
}
