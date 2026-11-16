import { NextResponse } from 'next/server';
import { listJobs, enqueue, type JobKind } from '@/lib/server/store';
export const dynamic = 'force-dynamic';
const KINDS: JobKind[] = ['develop', 'revise', 'validate', 'compile', 'stills', 'produce'];
export async function GET() { return NextResponse.json(listJobs(undefined, 100)); }
export async function POST(req: Request) {
  const { episode, kind, args } = await req.json();
  if (!episode || !KINDS.includes(kind)) return NextResponse.json({ error: 'bad job' }, { status: 400 });
  return NextResponse.json({ id: enqueue(episode, kind, args ?? {}) });
}
