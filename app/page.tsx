'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePoll, StatusChip, ago } from './ui';

export default function Episodes() {
  const router = useRouter();
  const { data, error } = usePoll<any[]>('/api/episodes', (d) => (d?.some((e) => e.activeJob) ? 2000 : 8000));
  const unfinished = (data ?? []).filter((e) => !['approved'].includes(e.status));
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div><h1>Episodes</h1><div className="muted">{data ? `${data.length} episodes · ${unfinished.length} in progress` : 'Loading…'}</div></div>
        <Link href="/new" className="btn" style={{ background: 'var(--ink)', color: '#fff' }}>New episode</Link>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="panel" style={{ padding: 0 }}>
        {data && data.length === 0 && <div className="empty">No episodes yet. <Link href="/new">Create the first one.</Link></div>}
        {data && data.length > 0 && (
          <table>
            <thead><tr><th style={{ paddingLeft: 16 }}>Episode</th><th>Status</th><th>Videos</th><th>Feasibility</th><th>Updated</th></tr></thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="click" onClick={() => router.push(`/episodes/${e.id}`)}>
                  <td style={{ paddingLeft: 16 }}><div style={{ fontWeight: 600 }}>{e.title}</div><div className="small muted" style={{ maxWidth: 520 }}>{e.logline}</div></td>
                  <td><StatusChip status={e.status} />{e.activeJob?.status === 'running' && e.activeJob.progress > 0 && <div className="bar"><i style={{ width: `${e.activeJob.progress * 100}%` }} /></div>}</td>
                  <td>{(e.videos.length ? e.videos : e.format === 'single' ? ['main'] : ['main', 'red', 'blue']).map((v: string) => <span key={v} title={`${v}: ${e.finals.includes(v) ? 'rendered' : 'not rendered'}`} className={`dot ${e.finals.includes(v) ? v : ''}`} style={{ marginRight: 4, outline: e.finals.includes(v) ? 'none' : '1px solid var(--line)' }} />)}</td>
                  <td className="small">{e.errors === null ? <span className="muted">—</span> : e.errors ? <span className="team-red">{e.errors} errors</span> : <span style={{ color: 'var(--ok)' }}>ok{e.warnings ? ` · ${e.warnings} warn` : ''}</span>}</td>
                  <td className="small muted">{e.updated ? ago(e.updated) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
