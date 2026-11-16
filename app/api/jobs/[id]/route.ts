import { NextResponse } from 'next/server';
import { getJob, readLog, updateJob } from '@/lib/server/store';
export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); const job = getJob(id);
  return job ? NextResponse.json({ job, log: readLog(id) }) : NextResponse.json({ error: 'not found' }, { status: 404 });
}
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); const job = getJob(id); if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (job.status === 'queued') updateJob(id, { status: 'cancelled', finished_at: new Date().toISOString() });
  else if (job.status === 'running') updateJob(id, { status: 'cancel_requested' });
  return NextResponse.json({ ok: true });
}
