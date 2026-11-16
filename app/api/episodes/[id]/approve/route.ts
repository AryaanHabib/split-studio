import { NextResponse } from 'next/server';
import { db } from '@/lib/server/store';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id; const { approved, note } = await req.json();
  db().prepare("INSERT INTO approvals (episode, approved, note, at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(episode) DO UPDATE SET approved = excluded.approved, note = excluded.note, at = excluded.at").run(id, approved ? 1 : 0, note ?? null);
  return NextResponse.json({ ok: true });
}
