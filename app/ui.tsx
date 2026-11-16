'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

export function usePoll<T>(url: string, ms: number | ((d: T | null) => number) = 3000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<any>(null);
  const load = useCallback(async () => {
    try { const r = await fetch(url, { cache: 'no-store' }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setData(j); setError(null); return j; }
    catch (e: any) { setError(e.message); return null; }
  }, [url]);
  useEffect(() => {
    let alive = true;
    const run = async () => { const d = await load(); if (!alive) return; const wait = typeof ms === 'function' ? ms(d) : ms; timer.current = setTimeout(run, wait); };
    run(); return () => { alive = false; clearTimeout(timer.current); };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload: load };
}

export async function api(url: string, method = 'POST', body?: any) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
}

export function StatusChip({ status }: { status: string }) {
  const cls = status === 'approved' ? 'ok' : status === 'awaiting review' || status === 'story ready' ? 'ok' : status.startsWith('failed') || status === 'needs fixes' ? 'err' : ['writing', 'rendering', 'working'].includes(status) ? 'run' : '';
  return <span className={`chip ${cls}`}>{status}</span>;
}

export function JobChip({ job }: { job: any }) {
  const cls = job.status === 'completed' ? 'ok' : job.status === 'failed' ? 'err' : job.status === 'running' ? 'run' : job.status === 'cancelled' ? '' : 'warn';
  return <span className={`chip ${cls}`}>{job.kind} · {job.status}{job.status === 'running' && job.progress > 0 ? ` ${(job.progress * 100).toFixed(0)}%` : ''}</span>;
}

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const ago = (ms: number) => { const s = (Date.now() - ms) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };
