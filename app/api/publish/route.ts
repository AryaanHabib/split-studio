import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting, listEpisodes, fileUrl, PRODUCTIONS, EPISODES } from '@/lib/server/store';
export const dynamic = 'force-dynamic';
const PLATFORMS = ['tiktok', 'instagram', 'youtube'] as const;
const ROLES = ['red', 'blue', 'main'] as const; // branches first, so they exist before Main points viewers to them
// Manual publishing handoff. No platform API is called; nothing is marked posted unless you record it.
export async function GET() {
  const accounts = getSetting<any>('accounts', {});
  const eps = listEpisodes().filter((e) => e.status === 'approved');
  const out = eps.map((e) => {
    const spec = JSON.parse(fs.readFileSync(path.join(EPISODES, e.id, 'episode.json'), 'utf8'));
    const rows: any[] = [];
    let ord = 1;
    for (const role of ROLES) for (const platform of PLATFORMS) {
      const vid = spec.videos[role] ? role : null; if (!vid) continue;
      let r: any = db().prepare('SELECT * FROM publications WHERE episode = ? AND platform = ? AND role = ?').get(e.id, platform, role);
      if (!r) {
        const acct = (k: string) => accounts?.[platform]?.[k] || `@your_${k}_account`;
        const caption = role === 'main'
          ? `${spec.title} 👀 ${spec.choice ? `What should happen next? 🔴 TEAM RED: ${spec.choice.red} → ${acct('red')}  🔵 TEAM BLUE: ${spec.choice.blue} → ${acct('blue')}` : ''}`
          : `${spec.videos[role].title}. Watch the start on ${acct('main')}. Pick your team. #${role === 'red' ? 'TeamRed' : 'TeamBlue'}`;
        db().prepare('INSERT INTO publications (episode, platform, role, caption, ord) VALUES (?, ?, ?, ?, ?)').run(e.id, platform, role, caption, ord);
        r = db().prepare('SELECT * FROM publications WHERE episode = ? AND platform = ? AND role = ?').get(e.id, platform, role);
      }
      ord++;
      const video = path.join(PRODUCTIONS, e.productionId, 'final', `${e.productionId}_${role}.mp4`);
      const cover = path.join(PRODUCTIONS, e.productionId, 'covers', `cover_${role}.jpg`);
      rows.push({ ...r, account: accounts?.[platform]?.[role] || '', video: fs.existsSync(video) ? fileUrl(video) : null, cover: fs.existsSync(cover) ? fileUrl(cover) : null });
    }
    return { episode: e.id, title: e.title, rows: rows.sort((a, b) => a.ord - b.ord) };
  });
  return NextResponse.json(out);
}
export async function POST(req: Request) {
  const { id, caption, status, url, scheduled_at } = await req.json();
  const r: any = db().prepare('SELECT * FROM publications WHERE id = ?').get(id); if (!r) return NextResponse.json({ error: 'not found' }, { status: 404 });
  db().prepare('UPDATE publications SET caption = ?, status = ?, url = ?, scheduled_at = ?, posted_at = CASE WHEN ? = \'posted\' AND posted_at IS NULL THEN datetime(\'now\') ELSE posted_at END WHERE id = ?')
    .run(caption ?? r.caption, status ?? r.status, url ?? r.url, scheduled_at ?? r.scheduled_at, status ?? r.status, id);
  return NextResponse.json({ ok: true });
}
