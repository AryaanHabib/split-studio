import { NextResponse } from 'next/server';
import { episodeDetail } from '@/lib/server/store';
export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = episodeDetail((await params).id);
  return d ? NextResponse.json(d) : NextResponse.json({ error: 'not found' }, { status: 404 });
}
