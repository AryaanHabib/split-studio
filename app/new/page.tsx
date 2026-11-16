'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, usePoll } from '../ui';

const STYLES = ['auto', 'bright-cartoon', 'toon', 'horror', 'noir', 'documentary', 'disaster-epic', 'dreamy', 'flat'];
const GENRES = ['auto', 'comedy', 'sports', 'horror', 'mystery', 'sci-fi', 'fantasy', 'experiment / what-if', 'absurd', 'drama'];

export default function NewEpisode() {
  const router = useRouter();
  const { data: settings } = usePoll<any>('/api/settings', 15000);
  const [f, setF] = useState<Record<string, string>>({ format: 'red-blue', genre: 'auto', style: 'auto', duration: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [more, setMore] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const claudeOk = settings?.worker?.alive && settings?.worker?.claude;
  async function submit(develop: boolean) {
    setBusy(true); setErr(null);
    try {
      const body: any = { ...f, develop };
      if (body.genre === 'auto') delete body.genre; if (body.style === 'auto') delete body.style;
      const r = await api('/api/episodes', 'POST', body);
      router.push(`/episodes/${r.id}`);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <div style={{ maxWidth: 760 }}>
      <h1>New episode</h1>
      <p className="muted" style={{ marginTop: 0 }}>Describe the scenario. Claude develops it into Main, Red and Blue scripts and shot lists, checks them against what the engine can animate, and then the local engine renders them.</p>
      {err && <div className="notice">{err}</div>}
      <div className="panel">
        <label htmlFor="idea">The idea</label>
        <textarea id="idea" rows={3} value={f.idea ?? ''} onChange={set('idea')} placeholder="What if gravity doubled every ten seconds? · A man gets a phone call from himself in the future · Could 100 toddlers beat the world's best basketball player?" autoFocus />
        <label>Your creative instructions <span className="hint">tone, what must be true, how it should feel</span></label>
        <textarea rows={3} value={f.instructions ?? ''} onChange={set('instructions')} />
        <div className="grid2">
          <div><label>Jokes that must be included</label><textarea rows={3} value={f.jokes ?? ''} onChange={set('jokes')} placeholder="One per line" /></div>
          <div><label>Required events / twists</label><textarea rows={3} value={f.events ?? ''} onChange={set('events')} placeholder="One per line" /></div>
        </div>
        <label>Characters <span className="hint">names, personalities, looks, important dialogue</span></label>
        <textarea rows={2} value={f.characters ?? ''} onChange={set('characters')} />
        <div className="grid3">
          <div><label>Format</label><select value={f.format} onChange={set('format')}><option value="red-blue">Red / Blue (3 videos)</option><option value="single">Single video</option></select></div>
          <div><label>Genre</label><select value={f.genre} onChange={set('genre')}>{GENRES.map((g) => <option key={g}>{g}</option>)}</select></div>
          <div><label>Visual style</label><select value={f.style} onChange={set('style')}>{STYLES.map((g) => <option key={g}>{g}</option>)}</select></div>
        </div>
        {f.format === 'red-blue' && (
          <div className="grid2">
            <div><label className="team-red">Team Red choice <span className="hint">optional</span></label><input value={f.red ?? ''} onChange={set('red')} placeholder="Let Claude propose" /></div>
            <div><label className="team-blue">Team Blue choice <span className="hint">optional</span></label><input value={f.blue ?? ''} onChange={set('blue')} placeholder="Let Claude propose" /></div>
          </div>
        )}
        <button onClick={() => setMore(!more)} style={{ marginTop: 12 }}>{more ? 'Fewer options' : 'More options'}</button>
        {more && (<>
          <div className="grid2">
            <div><label>Target duration <span className="hint">Main video</span></label><input value={f.duration ?? ''} onChange={set('duration')} placeholder="e.g. 35–45 seconds" /></div>
            <div><label>References</label><input value={f.references ?? ''} onChange={set('references')} placeholder="moods, pacing, camera ideas" /></div>
          </div>
          <label>Things you do NOT want</label>
          <textarea rows={2} value={f.avoid ?? ''} onChange={set('avoid')} />
        </>)}
      </div>
      {settings && !claudeOk && (
        <div className="notice">{settings.worker.alive ? 'Claude Code CLI was not found by the worker.' : 'The background worker is not running (start it with npm run worker).'} You can still create the episode and use the manual Claude Code workflow from the episode page.</div>
      )}
      <div className="row">
        <button className="primary" disabled={busy || !(f.idea ?? '').trim()} onClick={() => submit(true)}>Develop story with Claude</button>
        <button disabled={busy || !(f.idea ?? '').trim()} onClick={() => submit(false)}>Save without developing</button>
        <span className="small muted">Uses your own Claude Code login (subscription). No API key, no extra charges.</span>
      </div>
    </div>
  );
}
