// THE SPLIT STUDIO background worker. Runs independently of the browser:
//   npm run worker
// Picks queued jobs from SQLite one at a time (renders are CPU/GPU heavy), streams logs,
// reports progress, supports cancellation, and re-queues jobs interrupted by a crash
// (renders resume cheaply thanks to the per-shot cache).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { db, enqueue, getJob, updateJob, jobLogPath, ROOT, EPISODES, productionId, snapshotSpec, setSetting, type Job } from '../lib/server/store';

const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = path.join(ROOT, 'engine', 'src', 'cli.ts');
let current: { job: Job; child: ChildProcess } | null = null;

function log(job: Job, line: string) { fs.mkdirSync(path.dirname(jobLogPath(job.id)), { recursive: true }); fs.appendFileSync(jobLogPath(job.id), line.endsWith('\n') ? line : line + '\n'); }

function killTree(child: ChildProcess) {
  if (!child.pid) return;
  try { if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F']); else process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
}

export function claudeAvailable() { try { return execFileSync(process.platform === 'win32' ? 'claude.cmd' : 'claude', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim(); } catch { return null; } }

function commandFor(job: Job): { cmd: string; args: string[]; env?: NodeJS.ProcessEnv; parse?: 'claude' } | string {
  const dir = path.join(EPISODES, job.episode);
  const spec = path.join(dir, 'episode.json');
  const a = job.args ?? {};
  const cli = (...x: string[]) => ({ cmd: process.execPath, args: [TSX, CLI, ...x] });
  switch (job.kind) {
    case 'validate': return fs.existsSync(spec) ? cli('validate', spec) : 'No episode.json yet — develop the story first.';
    case 'compile': return fs.existsSync(spec) ? cli('compile', spec) : 'No episode.json yet.';
    case 'stills': return fs.existsSync(spec) ? cli('stills', spec, a.video ?? 'main', a.shots ?? '1', '--scale', String(a.scale ?? 0.35)) : 'No episode.json yet.';
    case 'produce': {
      if (!fs.existsSync(spec)) return 'No episode.json yet.';
      const x = ['produce', spec];
      if (a.videos) x.push('--videos', a.videos);
      if (a.scale) x.push('--scale', String(a.scale));
      if (a.shots) x.push('--shots', a.shots, '--reuse-shots');
      if (a.force) x.push('--force');
      return cli(...x);
    }
    case 'develop': case 'revise': {
      const claude = process.platform === 'win32' ? 'claude.cmd' : 'claude';
      const tmplFile = path.join(ROOT, '.claude', 'commands', job.kind === 'develop' ? 'develop-story.md' : 'revise.md');
      const tmpl = fs.readFileSync(tmplFile, 'utf8').replace(/^---[\s\S]*?---\n/, '');
      let argText: string;
      if (job.kind === 'develop') {
        const req = JSON.parse(fs.readFileSync(path.join(dir, 'request.json'), 'utf8'));
        argText = `Use episode id "${job.episode}" and write files ONLY inside episodes/${job.episode}/ (request.json is already there; the spec's "id" field must be "${job.episode}").\n\n` +
          Object.entries(req).filter(([k, v]) => v && !['id', 'created_at'].includes(k)).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join('\n');
      } else {
        argText = `${job.episode} — ${a.video ? `[video: ${a.video}] ` : ''}${a.shots ? `[shots: ${a.shots}] ` : ''}${a.feedback}`;
      }
      const prompt = tmpl.replace('$ARGUMENTS', argText) + '\n\nYou are running non-interactively from THE SPLIT STUDIO website. Do not ask questions; record open questions in brief.md. Do not start full renders.';
      // Never let the CLI fall back to pay-as-you-go API billing: strip API credentials so only the user's own Claude login is used.
      const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; delete env.CLAUDE_CODE_USE_BEDROCK; delete env.CLAUDE_CODE_USE_VERTEX;
      // Least privilege: Claude may read the project, but may only write inside this episode's folder,
      // the story bible and the playbook. Anything else is denied (non-interactive "default" mode = no prompts).
      return { cmd: claude, args: ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default',
        '--allowedTools', 'Read', 'Glob', 'Grep', `Edit(episodes/${job.episode}/**)`, 'Edit(bible/**)', 'Edit(docs/SHOWRUNNER_PLAYBOOK.md)',
        'Bash(npm run validate:*)', 'Bash(npm run stills:*)', 'Bash(npm run studio -- compile:*)', 'Bash(ls:*)'], env, parse: 'claude' };
    }
  }
  return `Unknown job kind ${job.kind}`;
}

function summarizeClaude(line: string): string | null {
  try {
    const ev = JSON.parse(line);
    if (ev.type === 'assistant') return (ev.message?.content ?? []).map((c: any) => c.type === 'text' ? c.text : c.type === 'tool_use' ? `→ ${c.name} ${JSON.stringify(c.input).slice(0, 160)}` : '').filter(Boolean).join('\n') || null;
    if (ev.type === 'result') return `■ ${ev.subtype ?? 'done'} — ${ev.num_turns ?? '?'} turns${ev.is_error ? ' (error)' : ''}${ev.result ? `\n${ev.result}` : ''}`;
    if (ev.type === 'system' && ev.subtype === 'init') return `Claude Code session started (model ${ev.model ?? '?'}, auth: your Claude login)`;
    return null;
  } catch { return line.trim() ? line : null; }
}

async function runJob(job: Job) {
  updateJob(job.id, { status: 'running', started_at: new Date().toISOString(), attempts: job.attempts + 1, progress: 0, stage: '', error: null });
  log(job, `=== job ${job.id} ${job.kind} ${job.episode} ${JSON.stringify(job.args)} (attempt ${job.attempts + 1}) @ ${new Date().toISOString()}`);
  if ((job.kind === 'develop' || job.kind === 'revise')) {
    if (!claudeAvailable()) { finish(job, 'failed', 'Claude Code CLI not found. Install Claude Code and log in with your subscription, or use the manual workflow (copy the prompt into a Claude Code session).'); return; }
    if (job.kind === 'revise') snapshotSpec(job.episode, `before revise ${job.id}`);
  }
  const c = commandFor(job);
  if (typeof c === 'string') { finish(job, 'failed', c); return; }
  const child = spawn(c.cmd, c.args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: c.env ?? process.env, detached: process.platform !== 'win32', shell: process.platform === 'win32' && c.cmd.endsWith('.cmd') });
  current = { job, child };
  updateJob(job.id, { pid: child.pid ?? null });
  let buf = '';
  const onData = (d: Buffer) => {
    buf += d.toString(); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const out = c.parse === 'claude' ? summarizeClaude(line) : line;
      if (out) log(job, out);
      const m = /render (\d+)\/(\d+) frames/.exec(line); if (m) updateJob(job.id, { progress: Number(m[1]) / Number(m[2]) });
      const st = /^▶ (\w+)/.exec(line) ?? /^• (.+)/.exec(line); if (st) updateJob(job.id, { stage: st[1].slice(0, 80) });
    }
  };
  child.stdout?.on('data', onData); child.stderr?.on('data', (d) => log(job, d.toString()));
  const code: number = await new Promise((res) => child.on('close', (cd) => res(cd ?? 1)));
  current = null;
  const fresh = getJob(job.id)!;
  if (fresh.status === 'cancel_requested') { finish(job, 'cancelled', 'Cancelled by user'); return; }
  if (code !== 0) {
    // validation failures are a normal outcome (feasibility report written), not a crash
    finish(job, job.kind === 'validate' || job.kind === 'compile' ? 'completed' : 'failed', code !== 0 && (job.kind === 'validate' || job.kind === 'compile') ? 'Spec has errors — see the feasibility report' : `exit code ${code}`);
    return;
  }
  finish(job, 'completed', null);
  // follow-ups: after Claude writes/revises a spec, compile it so the Studio can preview immediately
  if (job.kind === 'develop' || job.kind === 'revise') {
    if (fs.existsSync(path.join(EPISODES, job.episode, 'episode.json'))) enqueue(job.episode, 'compile', { auto: true });
    if (job.args?.feedbackId) db().prepare("UPDATE feedback SET status = 'applied' WHERE id = ?").run(job.args.feedbackId);
  }
}

function finish(job: Job, status: string, error: string | null) {
  updateJob(job.id, { status, error, finished_at: new Date().toISOString(), progress: status === 'completed' ? 1 : getJob(job.id)!.progress, pid: null });
  log(job, `=== ${status}${error ? `: ${error}` : ''}`);
}

function recover() {
  // jobs that were running when the worker died: retry (max 3 attempts), renders resume from cached shots
  const stale = db().prepare("SELECT * FROM jobs WHERE status IN ('running', 'cancel_requested')").all() as any[];
  for (const j of stale) {
    if (j.status === 'cancel_requested' || j.attempts >= 3) updateJob(j.id, { status: j.status === 'cancel_requested' ? 'cancelled' : 'failed', error: 'interrupted', finished_at: new Date().toISOString() });
    else { updateJob(j.id, { status: 'queued', pid: null }); fs.appendFileSync(jobLogPath(j.id), `=== worker restarted: job re-queued\n`); }
  }
}

let claudeVersion: string | null = null;
async function loop() {
  recover();
  claudeVersion = claudeAvailable();
  console.log(`[worker] running in ${ROOT}. Claude Code: ${claudeVersion ?? 'not found'}`);
  setInterval(() => setSetting('worker_heartbeat', { at: Date.now(), claude: claudeVersion, busy: current ? current.job.id : null }), 3000);
  // cancellation watchdog: runs independently because the loop below is awaiting the running job
  setInterval(() => { if (current && getJob(current.job.id)?.status === 'cancel_requested') killTree(current.child); }, 1000);
  for (;;) {
    const next = db().prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get() as any;
    if (!next) { await new Promise((r) => setTimeout(r, 1000)); continue; }
    const job: Job = { ...next, args: JSON.parse(next.args || '{}') };
    try { await runJob(job); } catch (e: any) { finish(job, 'failed', String(e?.message ?? e)); }
  }
}

process.on('SIGINT', () => { if (current) killTree(current.child); process.exit(0); });
void productionId;
loop();
