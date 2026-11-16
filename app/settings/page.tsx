'use client';
import { useEffect, useState } from 'react';
import { usePoll, api } from '../ui';

export default function Settings() {
  const { data, reload } = usePoll<any>('/api/settings', 10000);
  const [acc, setAcc] = useState<any>(null); const [saved, setSaved] = useState(false);
  useEffect(() => { if (data && !acc) setAcc(data.accounts); }, [data, acc]);
  if (!data || !acc) return <div className="muted">Loading…</div>;
  const w = data.worker;
  return (
    <>
      <h1>Settings</h1>
      <div className="grid2">
        <div className="panel">
          <h2>Local production</h2>
          <div><span className="dot" style={{ background: w.alive ? 'var(--ok)' : 'var(--red)', marginRight: 6 }} />Background worker: {w.alive ? 'running' : 'not running. Start it with npm run worker (or npm run app starts both)'}</div>
          <div style={{ marginTop: 6 }}><span className="dot" style={{ background: w.claude ? 'var(--ok)' : 'var(--warn)', marginRight: 6 }} />Claude Code CLI: {w.claude ?? 'not detected by the worker'}</div>
          <p className="small muted">Story development runs <code>claude -p</code> on this computer with your own Claude login. API-key variables are removed from its environment, so it can never switch to pay-as-you-go billing. If you hit your plan's usage limit, the job fails with that message; retry later or use the manual workflow.</p>
          <h3 style={{ marginTop: 12 }}>Machine report</h3>
          {data.doctor ? <pre className="log" style={{ maxHeight: 260 }}>{data.doctor}</pre> : <p className="small muted">Run <code>npm run doctor</code> in a terminal to detect CPU, GPU, RAM, FFmpeg, Python, voices and whether rendering can use your GPU.</p>}
          <p className="small muted">Folders: episodes in <code>episodes/</code>, outputs in <code>productions/&lt;id&gt;/final</code>, covers in <code>productions/&lt;id&gt;/covers</code>, your own sound effects in <code>assets/sfx/&lt;id&gt;.wav</code>, imported characters in <code>assets/models/</code>.</p>
        </div>
        <div className="panel">
          <h2>Social accounts</h2>
          <p className="small muted" style={{ marginTop: 0 }}>Handles used in captions and on the publish checklist. These are not connections. Nothing is logged in or posted.</p>
          {(['tiktok', 'instagram', 'youtube'] as const).map((p) => (
            <div key={p} style={{ marginBottom: 10 }}>
              <h3>{p === 'youtube' ? 'YouTube' : p === 'tiktok' ? 'TikTok' : 'Instagram'}</h3>
              <div className="grid3">{(['main', 'red', 'blue'] as const).map((r) => <input key={r} placeholder={`${r} @handle`} value={acc[p]?.[r] ?? ''} onChange={(e) => { setSaved(false); setAcc({ ...acc, [p]: { ...acc[p], [r]: e.target.value } }); }} style={{ borderColor: r === 'red' ? 'var(--red)' : r === 'blue' ? 'var(--blue)' : undefined }} />)}</div>
            </div>
          ))}
          <button className="primary" onClick={async () => { await api('/api/settings', 'POST', { accounts: acc }); setSaved(true); reload(); }}>Save accounts</button> {saved && <span className="small" style={{ color: 'var(--ok)' }}>saved</span>}
          <h3 style={{ marginTop: 16 }}>Official publishing APIs: not connected</h3>
          <ul className="small muted" style={{ paddingLeft: 18 }}>
            <li><b>YouTube Data API</b>: free with a Google Cloud project + OAuth consent. Uploads cost quota (≈6 uploads/day on the default quota). Custom thumbnails need a verified channel.</li>
            <li><b>TikTok Content Posting API</b>: needs a registered developer app. Unaudited apps can only post privately, so public posting requires TikTok's audit.</li>
            <li><b>Instagram (Graph API)</b>: needs a professional account linked to a Facebook Page and a Meta app with content-publishing permission (app review).</li>
          </ul>
          <p className="small muted">Each needs your authorization and app approval. Until then, the Publish page is a manual hand-off. No cookies, browser automation or paid schedulers are used.</p>
        </div>
      </div>
    </>
  );
}
