'use client';
import { use, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePoll, api, StatusChip, JobChip, fmtTime, ago } from '../../ui';

const VCOL: Record<string, { label: string; cls: string; color: string }> = {
  main: { label: 'Main', cls: '', color: 'var(--ink)' }, red: { label: 'Team Red', cls: 'red-col', color: 'var(--red)' }, blue: { label: 'Team Blue', cls: 'blue-col', color: 'var(--blue)' }, single: { label: 'Video', cls: '', color: 'var(--ink)' },
};

export default function Studio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: d, reload } = usePoll<any>(`/api/episodes/${id}`, (x) => (x?.activeJob ? 2000 : 7000));
  const [tab, setTab] = useState<'story' | 'videos' | 'feedback' | 'jobs' | 'import'>('story');
  const [pv, setPv] = useState('main');
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [previewKey, setPreviewKey] = useState(0);

  const job = async (kind: string, args: any = {}) => { setMsg(null); try { await api('/api/jobs', 'POST', { episode: id, kind, args }); await reload(); } catch (e: any) { setMsg(e.message); } };
  const selected = useMemo(() => Object.entries(sel).filter(([, v]) => v.length), [sel]);
  if (!d) return <div className="muted">Loading…</div>;
  if (d.error) return <div className="notice">{d.error}</div>;

  const hasSpec = !!d.choice || d.videos.length > 0;
  const errors = (d.feasibility ?? []).filter((i: any) => i.level === 'error');
  const warnings = (d.feasibility ?? []).filter((i: any) => i.level === 'warning');
  const busy = !!d.activeJob;
  const compiledOk = Object.keys(d.compiled ?? {}).length > 0;
  const toggle = (v: string, s: string) => setSel((p) => ({ ...p, [v]: (p[v] ?? []).includes(s) ? p[v].filter((x) => x !== s) : [...(p[v] ?? []), s] }));
  const seek = (v: string, t: number) => { if (v !== pv) { setPv(v); setTimeout(() => frame.current?.contentWindow?.postMessage({ seek: t }, '*'), 2500); } else frame.current?.contentWindow?.postMessage({ seek: t }, '*'); };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ maxWidth: 760 }}>
          <div className="small muted"><Link href="/">Episodes</Link> / {id}</div>
          <h1>{d.title}</h1>
          <div className="row"><StatusChip status={d.status} /><span className="muted small">{d.logline}</span></div>
        </div>
        <div className="row">
          {d.approval?.approved
            ? <button onClick={async () => { await api(`/api/episodes/${id}/approve`, 'POST', { approved: false }); reload(); }}>Withdraw approval</button>
            : <button className="primary" disabled={d.finals.length === 0 || d.finals.length < d.videos.length} title={d.finals.length < d.videos.length ? 'Render all videos and watch them first' : ''} onClick={async () => { await api(`/api/episodes/${id}/approve`, 'POST', { approved: true }); reload(); }}>Approve episode</button>}
        </div>
      </div>
      {msg && <div className="notice">{msg}</div>}
      {d.activeJob && (
        <div className="notice info">
          <b>{d.activeJob.kind}</b> {d.activeJob.status}{d.activeJob.stage ? ` · ${d.activeJob.stage}` : ''}{d.activeJob.progress > 0 ? ` · ${(d.activeJob.progress * 100).toFixed(0)}%` : ''}
          {d.activeJob.progress > 0 && <div className="bar"><i style={{ width: `${d.activeJob.progress * 100}%` }} /></div>}
          <div className="small">This runs in the background worker. You can close the browser. <button style={{ padding: '1px 8px', marginLeft: 8 }} onClick={() => setTab('jobs')}>Show log</button></div>
        </div>
      )}

      <div className="panel">
        <div className="row">
          <b style={{ marginRight: 4 }}>Pipeline</b>
          <button className={!hasSpec ? 'primary' : ''} disabled={busy} onClick={() => job('develop')}>{hasSpec ? 'Re-develop story' : 'Develop story with Claude'}</button>
          <button disabled={busy || !hasSpec} onClick={() => job('validate')}>Check feasibility</button>
          <button disabled={busy || !hasSpec} onClick={() => job('compile')} className={hasSpec && !compiledOk ? 'primary' : ''}>Compile preview</button>
          <button disabled={busy || !compiledOk} onClick={() => job('produce', { scale: 0.5 })}>Render draft (½ res)</button>
          <button disabled={busy || !compiledOk || errors.length > 0} onClick={() => job('produce', {})} className={compiledOk && d.finals.length === 0 ? 'primary' : ''}>Render final</button>
          {selected.length > 0 && <>
            <span className="muted">|</span>
            <button disabled={busy} onClick={() => selected.forEach(([v, s]) => job('stills', { video: v, shots: s.join(','), scale: 0.4 }))}>Stills of {selected.reduce((n, [, s]) => n + s.length, 0)} selected</button>
            <button disabled={busy} onClick={() => job('produce', { videos: selected.map(([v]) => v).join(','), shots: selected.flatMap(([, s]) => s).join(',') })}>Re-render selected shots</button>
            <button onClick={() => setSel({})}>Clear</button>
          </>}
        </div>
        {!hasSpec && <p className="small muted" style={{ marginBottom: 0 }}>Step 1: Claude writes the brief and the episode spec (2–10 minutes). Step 2: compile and preview. Step 3: render.</p>}
      </div>

      <div className="studio">
        <div>
          <div className="tabs">
            {(['story', 'videos', 'feedback', 'jobs', 'import'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'story' ? 'Story & shots' : t === 'videos' ? `Videos${d.finals.length ? ` (${d.finals.length})` : ''}` : t === 'feedback' ? `Feedback${d.feedback.length ? ` (${d.feedback.length})` : ''}` : t === 'jobs' ? 'Jobs' : 'Import / manual'}</button>)}
          </div>

          {tab === 'story' && <>
            {d.choice && (
              <div className="grid2" style={{ marginBottom: 16 }}>
                <div className="panel" style={{ marginBottom: 0, borderTop: '3px solid var(--red)' }}><h3 className="team-red">Team Red</h3>{d.choice.red}</div>
                <div className="panel" style={{ marginBottom: 0, borderTop: '3px solid var(--blue)' }}><h3 className="team-blue">Team Blue</h3>{d.choice.blue}</div>
              </div>
            )}
            {(errors.length > 0 || warnings.length > 0) && (
              <div className="panel">
                <h2>Animation feasibility</h2>
                <ul className="issues small" style={{ paddingLeft: 18, margin: 0 }}>
                  {errors.map((i: any, k: number) => <li key={'e' + k} className="e"><b>{i.where}</b>: {i.msg}{i.fix && <div className="muted">fix: {i.fix}</div>}</li>)}
                  {warnings.map((i: any, k: number) => <li key={'w' + k} className="w">{i.where}: {i.msg}</li>)}
                </ul>
              </div>
            )}
            {d.feasibility && errors.length === 0 && <div className="small" style={{ color: 'var(--ok)', marginBottom: 12 }}>✓ Every action, set, camera, sound and style in this spec is supported by the engine.</div>}
            {hasSpec ? (
              <div className="panel">
                <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Storyboard</h2><span className="small muted">Click a shot to preview it · tick to select for stills, re-render or feedback</span></div>
                <div className={`grid${Math.min(3, d.videos.length)}`} style={{ marginTop: 10, display: 'grid', gridTemplateColumns: `repeat(${d.videos.length}, minmax(0,1fr))`, gap: 12 }}>
                  {d.videos.map((v: string) => {
                    const c = d.compiled?.[v]; const col = VCOL[v] ?? VCOL.main;
                    const shots = c?.shots ?? (d.specShots?.[v] ?? []).map((s: any, k: number) => ({ ...s, id: s.id ?? `s${k + 1}` }));
                    return (
                      <div key={v}>
                        <div className="col-head" style={{ color: col.color }}><span className={`dot ${v}`} />{col.label}<span className="small muted" style={{ fontWeight: 400 }}>{c ? `${c.duration.toFixed(1)}s · ${c.shots.length} shots` : `${shots.length} shots`}</span></div>
                        {shots.map((s: any, k: number) => {
                          const spec = (d.specShots?.[v] ?? []).find((x: any) => x.id === s.id) ?? {};
                          const isSel = (sel[v] ?? []).includes(s.id);
                          return (
                            <div key={s.id + k} className={`shot ${col.cls} ${isSel ? 'sel' : ''}`} onClick={() => c && seek(v, (s.start + s.end) / 2 - 0.2)}>
                              <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                                <span><b>{k + 1}.</b> {s.id}</span>
                                <input type="checkbox" checked={isSel} onClick={(e) => e.stopPropagation()} onChange={() => toggle(v, s.id)} style={{ width: 'auto' }} />
                              </div>
                              <div className="meta">{s.purpose ?? spec.purpose ?? ''}{(s.camera ?? spec.camera) ? ` · ${s.camera ?? spec.camera}` : ''}{c ? ` · ${(s.end - s.start).toFixed(1)}s @ ${fmtTime(s.start)}` : ''}</div>
                              {spec.narration && <div className="meta" style={{ fontStyle: 'italic' }}>“{spec.narration}”</div>}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : <div className="panel empty">No story yet. Click <b>Develop story with Claude</b>, or use the <a href="#" onClick={(e) => { e.preventDefault(); setTab('import'); }}>manual workflow</a>.</div>}
            {d.brief && <div className="panel"><h2>Brief (written by Claude)</h2><pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', margin: 0 }}>{d.brief}</pre></div>}
            <div className="panel">
              <h2>Your request</h2>
              {d.request ? Object.entries(d.request).filter(([k, v]) => v && !['id', 'created_at'].includes(k)).map(([k, v]: any) => <div key={k} style={{ marginBottom: 6 }}><span className="small muted" style={{ textTransform: 'uppercase', marginRight: 8 }}>{k}</span>{v}</div>) : <span className="muted">This episode was created from a spec file.</span>}
              {d.mandatory?.length > 0 && <><h3 style={{ marginTop: 12 }}>Mandatory items tracked in the spec</h3><ul style={{ margin: 0, paddingLeft: 18 }}>{d.mandatory.map((m: string) => <li key={m}>{m}</li>)}</ul></>}
              {d.characters?.length > 0 && <div className="small muted" style={{ marginTop: 10 }}>Characters: {d.characters.map((c: any) => `${c.name} (${c.kind === 'gltf' ? 'imported model' : c.archetype})`).join(', ')} · Sets: {d.sets.join(', ')} · Styles: {Object.entries(d.styles).map(([v, s]) => `${v}=${s}`).join(', ')}</div>}
            </div>
          </>}

          {tab === 'videos' && <>
            {d.finals.length === 0 && <div className="panel empty">Nothing rendered yet. Render a draft (½ resolution, faster) or the final.</div>}
            {d.finals.length > 0 && (
              <div className="panel">
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${d.finals.length}, minmax(0,1fr))`, gap: 12 }}>
                  {d.finals.map((f: any) => {
                    const r = d.report?.results?.[f.video];
                    const bad = (r?.qc ?? []).filter((c: any) => !c.ok);
                    return (
                      <div key={f.video}>
                        <div className="col-head" style={{ color: VCOL[f.video]?.color }}><span className={`dot ${f.video}`} />{VCOL[f.video]?.label ?? f.video}</div>
                        <video src={`${f.url}?v=${f.mtime}`} controls preload="metadata" playsInline />
                        <div className="small muted" style={{ marginTop: 6 }}>{r ? `${r.duration.toFixed(1)}s · ${r.shots} shots · ${r.renderScale === 1 ? 'full res' : `draft ${r.renderScale}×`}` : ''} · rendered {ago(f.mtime)}</div>
                        {r && <div className="small" style={{ color: bad.length ? 'var(--warn)' : 'var(--ok)' }}>QC {r.qc.length - bad.length}/{r.qc.length}{bad.length ? ': ' + bad.map((b: any) => b.name).join(', ') : ' passed'}</div>}
                        <a className="small" href={f.url} download>Download MP4</a>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {d.covers.length > 0 && (
              <div className="panel">
                <h2>Covers <span className="small muted" style={{ fontWeight: 400 }}>one source frame, three treatments</span></h2>
                <div className="thumbs" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>{d.covers.filter((c: any) => !c.key.startsWith('grid')).map((c: any) => <a key={c.key} href={c.url} target="_blank"><img src={c.url} alt={c.key} /></a>)}</div>
                <h3 style={{ marginTop: 12 }}>Profile grid preview (3:4 crop)</h3>
                {d.covers.filter((c: any) => c.key === 'grid_preview_3x4').map((c: any) => <img key={c.key} src={c.url} style={{ width: '100%', maxWidth: 540, borderRadius: 6 }} />)}
              </div>
            )}
            {d.stills.length > 0 && <div className="panel"><h2>Preview stills</h2><div className="thumbs">{d.stills.map((s: any) => <a key={s.name} href={s.url} target="_blank" title={s.name}><img src={`${s.url}?m=${s.mtime}`} alt={s.name} /></a>)}</div></div>}
          </>}

          {tab === 'feedback' && <Feedback id={id} d={d} selected={selected} reload={reload} />}
          {tab === 'jobs' && <Jobs jobs={d.jobs} reload={reload} />}
          {tab === 'import' && <ImportManual id={id} d={d} reload={reload} />}
        </div>

        <div className="preview">
          <div className="panel" style={{ padding: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <b>Live preview</b>
              <div className="row" style={{ gap: 4 }}>{d.videos.map((v: string) => <button key={v} style={{ padding: '3px 8px', borderColor: pv === v ? VCOL[v]?.color : undefined }} onClick={() => { setPv(v); setPreviewKey((k) => k + 1); }}>{VCOL[v]?.label ?? v}</button>)}</div>
            </div>
            {compiledOk ? <iframe ref={frame} key={`${pv}-${previewKey}-${d.compiled?.[pv]?.duration}`} src={`/preview.html?ep=${d.productionId}&video=${pv}&scale=0.5`} title="preview" />
              : <div className="empty small">Compile the spec to get an interactive preview of every shot, without rendering.</div>}
            <div className="small muted" style={{ marginTop: 6 }}>Runs the real engine in your browser. Real-time on a GPU, slow in software mode. Sound plays after a render.</div>
          </div>
        </div>
      </div>
    </>
  );
}

function Feedback({ id, d, selected, reload }: any) {
  const [text, setText] = useState(''); const [video, setVideo] = useState(''); const [err, setErr] = useState<string | null>(null);
  const shots = selected.flatMap(([, s]: any) => s).join(',');
  const send = async (apply: boolean) => { setErr(null); try { await api(`/api/episodes/${id}/feedback`, 'POST', { text, video: video || selected.map(([v]: any) => v).join(',') || null, shots: shots || null, apply }); setText(''); reload(); } catch (e: any) { setErr(e.message); } };
  return (
    <>
      <div className="panel">
        <h2>Give feedback</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Plain English. Claude changes only the affected shots and tracks, keeps a backup of the previous spec, and logs the revision. Then re-render; unchanged shots are reused from the cache.</p>
        {err && <div className="notice">{err}</div>}
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'"Make him look terrified."  "That joke needs a beat of silence before it."  "The camera should follow the ball."  "Keep everything except the Blue ending."'} />
        <div className="row" style={{ marginTop: 8 }}>
          <select value={video} onChange={(e) => setVideo(e.target.value)} style={{ width: 'auto' }}><option value="">{selected.length ? `Selected shots (${shots})` : 'Whole episode'}</option>{d.videos.map((v: string) => <option key={v} value={v}>{v} only</option>)}</select>
          <button className="primary" disabled={!text.trim() || !!d.activeJob} onClick={() => send(true)}>Apply with Claude</button>
          <button disabled={!text.trim()} onClick={() => send(false)}>Save as note</button>
        </div>
      </div>
      <div className="panel">
        <h2>History</h2>
        {d.feedback.length === 0 && <div className="muted small">No feedback yet.</div>}
        {d.feedback.map((f: any) => <div key={f.id} style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}><span className={`chip ${f.status === 'applied' ? 'ok' : f.status === 'revising' ? 'run' : ''}`}>{f.status}</span> <span className="small muted">{f.created_at}{f.video ? ` · ${f.video}` : ''}{f.shots ? ` · shots ${f.shots}` : ''}</span><div>{f.text}</div></div>)}
        {d.revisions && <><h3 style={{ marginTop: 12 }}>Revision log</h3><pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', fontSize: 12, margin: 0 }}>{d.revisions}</pre></>}
        {d.specVersions.length > 0 && <div className="small muted" style={{ marginTop: 8 }}>Saved spec versions: {d.specVersions.slice(0, 8).map((v: string) => <a key={v} href={`/api/files/episodes/${id}/versions/${v}`} target="_blank" style={{ marginRight: 8 }}>{v.slice(0, 19)}</a>)}</div>}
      </div>
    </>
  );
}

function Jobs({ jobs, reload }: any) {
  const [open, setOpen] = useState<number | null>(jobs[0]?.id ?? null);
  const { data } = usePoll<any>(open ? `/api/jobs/${open}` : '/api/settings', 2000);
  return (
    <div className="panel">
      {jobs.length === 0 && <div className="muted">No jobs yet.</div>}
      {jobs.map((j: any) => (
        <div key={j.id} style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span><JobChip job={j} /> <span className="small muted">#{j.id} · {j.created_at}{j.error ? ` · ${j.error}` : ''}</span></span>
            <span className="row" style={{ gap: 6 }}>
              {['queued', 'running'].includes(j.status) && <button className="danger" style={{ padding: '2px 8px' }} onClick={async () => { await api(`/api/jobs/${j.id}`, 'DELETE'); reload(); }}>Cancel</button>}
              <button style={{ padding: '2px 8px' }} onClick={() => setOpen(open === j.id ? null : j.id)}>{open === j.id ? 'Hide log' : 'Log'}</button>
            </span>
          </div>
          {open === j.id && <pre className="log">{data?.log || '(no output yet)'}</pre>}
        </div>
      ))}
    </div>
  );
}

function ImportManual({ id, d, reload }: any) {
  const [prompt, setPrompt] = useState<string | null>(null); const [json, setJson] = useState(''); const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <div className="panel">
        <h2>Manual Claude Code workflow</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Use this if the worker cannot run Claude Code, or if you prefer to work with Claude interactively. Open Claude Code in the studio folder and paste:</p>
        {d.request ? <button onClick={async () => setPrompt((await (await fetch(`/api/episodes/${id}/prompt`)).json()).prompt)}>Show the prompt</button> : <span className="small muted">This episode has no request (it was imported as a spec).</span>}
        {prompt && <><pre className="log">{prompt}</pre><button onClick={() => navigator.clipboard.writeText(prompt)}>Copy</button></>}
        <p className="small muted">Claude writes <code>episodes/{id}/episode.json</code>. Then click <b>Compile preview</b> here.</p>
      </div>
      <div className="panel">
        <h2>Import a spec</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Paste an episode.json produced in any Claude Code session. The current spec is backed up first.</p>
        {msg && <div className="notice">{msg}</div>}
        <textarea rows={8} value={json} onChange={(e) => setJson(e.target.value)} placeholder='{ "id": "...", "characters": {...}, "scenes": {...}, "videos": {...} }' style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" disabled={!json.trim()} onClick={async () => { try { await api(`/api/episodes/${id}/spec`, 'PUT', json); setJson(''); setMsg('Imported. Compiling…'); reload(); } catch (e: any) { setMsg(e.message); } }}>Import & compile</button>
          {(d.choice || d.videos.length > 0) && <a className="btn" href={`/api/episodes/${id}/spec`} target="_blank">View current spec</a>}
        </div>
      </div>
    </>
  );
}
