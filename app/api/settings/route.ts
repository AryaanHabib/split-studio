import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getSetting, setSetting, PRODUCTIONS } from '@/lib/server/store';
export const dynamic = 'force-dynamic';
const DEFAULT_ACCOUNTS = {
  instagram: { main: '', red: '', blue: '' }, tiktok: { main: '', red: '', blue: '' }, youtube: { main: '', red: '', blue: '' },
};
export async function GET() {
  const hb = getSetting<any>('worker_heartbeat', null);
  let doctor = ''; try { doctor = fs.readFileSync(path.join(PRODUCTIONS, 'doctor.txt'), 'utf8'); } catch { /* not run yet */ }
  return NextResponse.json({ accounts: getSetting('accounts', DEFAULT_ACCOUNTS), defaults: getSetting('defaults', { renderScalePreview: 0.5, aiDisclosure: true }),
    worker: hb ? { alive: Date.now() - hb.at < 10000, claude: hb.claude, busy: hb.busy, at: hb.at } : { alive: false }, doctor });
}
export async function POST(req: Request) {
  const b = await req.json();
  if (b.accounts) setSetting('accounts', b.accounts);
  if (b.defaults) setSetting('defaults', b.defaults);
  return NextResponse.json({ ok: true });
}
