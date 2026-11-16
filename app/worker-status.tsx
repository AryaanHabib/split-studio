'use client';
import { usePoll } from './ui';

export default function WorkerStatus() {
  const { data } = usePoll<any>('/api/settings', 5000);
  if (!data) return null;
  const w = data.worker;
  return (
    <span className="small muted" title={w.alive ? `Claude Code: ${w.claude ?? 'not found'}` : 'Start it with: npm run worker'}>
      <span className="dot" style={{ background: w.alive ? 'var(--ok)' : 'var(--red)', marginRight: 6 }} />
      {w.alive ? (w.busy ? `worker busy (job ${w.busy})` : 'worker idle') : 'worker not running'}
    </span>
  );
}
