import { NextResponse } from 'next/server';
import { db, enqueue } from '@/lib/server/store';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id; const { text, video, shots, apply } = await req.json();
  if (!text?.trim()) return NextResponse.json({ error: 'Write the feedback first.' }, { status: 400 });
  const r = db().prepare('INSERT INTO feedback (episode, video, shots, text) VALUES (?, ?, ?, ?)').run(id, video || null, shots || null, text);
  const fid = Number(r.lastInsertRowid); let job: number | null = null;
  if (apply) { job = enqueue(id, 'revise', { feedback: text, video, shots, feedbackId: fid }); db().prepare("UPDATE feedback SET status = 'revising', job = ? WHERE id = ?").run(job, fid); }
  return NextResponse.json({ id: fid, job });
}
