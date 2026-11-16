'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePoll, api } from '../ui';

const P: Record<string, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube Shorts' };

export default function Publish() {
  const { data, reload } = usePoll<any[]>('/api/publish', 15000);
  return (
    <>
      <h1>Publish</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Manual hand-off queue for approved episodes: the right video, cover and caption for each of the nine account slots, in posting order. Branch videos go up first, so Main can point viewers to them.
        <b> Nothing is posted automatically.</b> A row is only marked posted when you record it. Official API uploads are not connected yet (see Settings).
      </p>
      {!data && <div className="muted">Loading…</div>}
      {data && data.length === 0 && <div className="panel empty">No approved episodes. Approve one in its Episode Studio after watching all three videos.</div>}
      {data?.map((ep) => (
        <div key={ep.episode} className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}><Link href={`/episodes/${ep.episode}`}>{ep.title}</Link></h2>
            <span className="small muted">{ep.rows.filter((r: any) => r.status === 'posted').length}/{ep.rows.length} posted</span></div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>#</th><th>Slot</th><th>Files</th><th style={{ width: '40%' }}>Caption</th><th>Status / URL</th></tr></thead>
            <tbody>{ep.rows.map((r: any) => <Row key={r.id} r={r} reload={reload} />)}</tbody>
          </table>
          <div className="small muted">Checklist: confirm the account before uploading · use the cover as the thumbnail where the platform allows it · add the platform's AI-generated content label · paste the published URL back here.</div>
        </div>
      ))}
    </>
  );
}

function Row({ r, reload }: any) {
  const [cap, setCap] = useState(r.caption ?? ''); const [url, setUrl] = useState(r.url ?? '');
  const save = async (patch: any) => { await api('/api/publish', 'POST', { id: r.id, caption: cap, url, ...patch }); reload(); };
  const color = r.role === 'red' ? 'var(--red)' : r.role === 'blue' ? 'var(--blue)' : 'var(--ink)';
  return (
    <tr>
      <td>{r.ord}</td>
      <td><b style={{ color }}>{r.role.toUpperCase()}</b><div className="small">{P[r.platform]}</div><div className="small muted">{r.account || 'account not set'}</div></td>
      <td className="small">{r.video ? <a href={r.video} download>video</a> : <span className="team-red">missing</span>}<br />{r.cover ? <a href={r.cover} download>cover</a> : <span className="muted">no cover</span>}</td>
      <td><textarea rows={3} value={cap} onChange={(e) => setCap(e.target.value)} onBlur={() => cap !== r.caption && save({})} className="small" />
        <button style={{ padding: '2px 8px', marginTop: 4 }} onClick={() => navigator.clipboard.writeText(cap)}>Copy caption</button></td>
      <td>
        <span className={`chip ${r.status === 'posted' ? 'ok' : ''}`}>{r.status}</span>
        <input className="small" style={{ marginTop: 6 }} placeholder="Published URL" value={url} onChange={(e) => setUrl(e.target.value)} />
        <div className="row" style={{ gap: 4, marginTop: 4 }}>
          {r.status !== 'posted' ? <button style={{ padding: '2px 8px' }} disabled={!url.trim()} onClick={() => save({ status: 'posted' })}>Mark posted</button> : <button style={{ padding: '2px 8px' }} onClick={() => save({ status: 'pending' })}>Undo</button>}
        </div>
      </td>
    </tr>
  );
}
