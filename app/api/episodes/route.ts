import { NextResponse } from 'next/server';
import { listEpisodes, createEpisode, enqueue } from '@/lib/server/store';
export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json(listEpisodes()); }
export async function POST(req: Request) {
  const b = await req.json();
  if (!b.idea || String(b.idea).trim().length < 5) return NextResponse.json({ error: 'Describe the idea (at least a sentence).' }, { status: 400 });
  const { develop, ...fields } = b;
  const ep = createEpisode(fields);
  const job = develop ? enqueue(ep.id, 'develop') : null;
  return NextResponse.json({ id: ep.id, job });
}
