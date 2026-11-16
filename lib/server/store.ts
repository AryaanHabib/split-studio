// Shared server-side store for the website and the worker: SQLite (node:sqlite, no native build)
// for jobs/feedback/approvals/publishing, the filesystem for episodes and productions.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const ROOT = process.env.STUDIO_ROOT ?? process.cwd();
export const EPISODES = path.join(ROOT, 'episodes');
export const PRODUCTIONS = path.join(ROOT, 'productions');

let _db: DatabaseSync | null = null;
export function db() {
  if (_db) return _db;
  fs.mkdirSync(PRODUCTIONS, { recursive: true });
  const d = new DatabaseSync(path.join(PRODUCTIONS, 'studio.db'));
  d.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, episode TEXT NOT NULL, kind TEXT NOT NULL, args TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued', progress REAL DEFAULT 0, stage TEXT DEFAULT '', pid INTEGER, attempts INTEGER DEFAULT 0, error TEXT,
      created_at TEXT DEFAULT (datetime('now')), started_at TEXT, finished_at TEXT);
    CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, episode TEXT NOT NULL, video TEXT, shots TEXT, text TEXT NOT NULL,
      status TEXT DEFAULT 'open', job INTEGER, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS approvals (episode TEXT PRIMARY KEY, approved INTEGER DEFAULT 0, note TEXT, at TEXT);
    CREATE TABLE IF NOT EXISTS publications (id INTEGER PRIMARY KEY AUTOINCREMENT, episode TEXT NOT NULL, platform TEXT NOT NULL, role TEXT NOT NULL,
      caption TEXT, ord INTEGER, scheduled_at TEXT, status TEXT DEFAULT 'pending', url TEXT, posted_at TEXT, UNIQUE(episode, platform, role));
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`);
  _db = d; return d;
}

export type JobKind = 'develop' | 'revise' | 'validate' | 'compile' | 'stills' | 'produce';
export interface Job { id: number; episode: string; kind: JobKind; args: any; status: string; progress: number; stage: string; pid: number | null; attempts: number; error: string | null; created_at: string; started_at: string | null; finished_at: string | null }
const rowToJob = (r: any): Job => ({ ...r, args: JSON.parse(r.args || '{}') });

export function enqueue(episode: string, kind: JobKind, args: Record<string, any> = {}) {
  const r = db().prepare('INSERT INTO jobs (episode, kind, args) VALUES (?, ?, ?)').run(episode, kind, JSON.stringify(args));
  return Number(r.lastInsertRowid);
}
export function listJobs(episode?: string, limit = 50): Job[] {
  const rows = episode ? db().prepare('SELECT * FROM jobs WHERE episode = ? ORDER BY id DESC LIMIT ?').all(episode, limit) : db().prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map(rowToJob);
}
export function getJob(id: number): Job | null { const r = db().prepare('SELECT * FROM jobs WHERE id = ?').get(id); return r ? rowToJob(r) : null; }
export function updateJob(id: number, f: Partial<Omit<Job, 'id' | 'args'>>) {
  const keys = Object.keys(f); if (!keys.length) return;
  db().prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => (f as any)[k]), id);
}
export function jobLogPath(id: number) { return path.join(PRODUCTIONS, 'logs', `job-${id}.log`); }
export function readLog(id: number, tail = 20000) { try { const s = fs.readFileSync(jobLogPath(id), 'utf8'); return s.length > tail ? '…' + s.slice(-tail) : s; } catch { return ''; } }

export function getSetting<T = any>(key: string, def: T): T { const r: any = db().prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? JSON.parse(r.value) : def; }
export function setSetting(key: string, value: any) { db().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)); }

// ---------------------------------------------------------------- episodes
export interface EpisodeRequest {
  id: string; idea: string; title?: string; instructions?: string; jokes?: string; events?: string; characters?: string; genre?: string;
  style?: string; duration?: string; references?: string; red?: string; blue?: string; avoid?: string; format?: 'red-blue' | 'single'; created_at?: string;
}

export function slugify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'episode'; }
export function nextEpisodeId(idea: string) {
  fs.mkdirSync(EPISODES, { recursive: true });
  const nums = fs.readdirSync(EPISODES).map((d) => /^ep(\d+)/.exec(d)?.[1]).filter(Boolean).map(Number);
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return `ep${String(n).padStart(3, '0')}-${slugify(idea.split(/[.?!]/)[0])}`;
}
export function createEpisode(req: Omit<EpisodeRequest, 'id'>) {
  const id = nextEpisodeId(req.idea);
  const dir = path.join(EPISODES, id); fs.mkdirSync(dir, { recursive: true });
  const full: EpisodeRequest = { ...req, id, format: req.format ?? 'red-blue', created_at: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(full, null, 2));
  return full;
}

const readJson = (f: string) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readText = (f: string) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

/** The production id inside episode.json may differ from the folder name (ep001 vs ep001-toddlers). */
export function productionId(dirId: string) { const spec = readJson(path.join(EPISODES, dirId, 'episode.json')); return spec?.id ?? dirId; }

export function episodeSummary(dirId: string) {
  const dir = path.join(EPISODES, dirId);
  const request: EpisodeRequest | null = readJson(path.join(dir, 'request.json'));
  const spec = readJson(path.join(dir, 'episode.json'));
  const pid = spec?.id ?? dirId;
  const prod = path.join(PRODUCTIONS, pid);
  const feas: any[] | null = readJson(path.join(prod, 'feasibility.json'));
  const videos = spec ? Object.keys(spec.videos) : [];
  const finals = videos.map((v) => ({ video: v, file: path.join(prod, 'final', `${pid}_${v}.mp4`) })).filter((x) => fs.existsSync(x.file));
  const jobs = listJobs(dirId, 5);
  const active = jobs.find((j) => ['queued', 'running', 'cancel_requested'].includes(j.status));
  const appr: any = db().prepare('SELECT * FROM approvals WHERE episode = ?').get(dirId);
  let status = 'draft';
  if (spec) status = feas && feas.some((i) => i.level === 'error') ? 'needs fixes' : 'story ready';
  if (spec && finals.length === videos.length && videos.length) status = 'awaiting review';
  if (appr?.approved) status = 'approved';
  if (active) status = active.kind === 'develop' || active.kind === 'revise' ? 'writing' : active.kind === 'produce' ? 'rendering' : 'working';
  else if (jobs[0]?.status === 'failed') status = `failed (${jobs[0].kind})`;
  const mtime = Math.max(...[path.join(dir, 'request.json'), path.join(dir, 'episode.json')].map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }));
  return { id: dirId, productionId: pid, title: spec?.title ?? request?.title ?? request?.idea ?? dirId, logline: spec?.logline ?? request?.idea ?? '', format: spec?.format ?? request?.format ?? 'red-blue',
    status, videos, finals: finals.map((f) => f.video), errors: feas?.filter((i) => i.level === 'error').length ?? null, warnings: feas?.filter((i) => i.level === 'warning').length ?? null,
    activeJob: active ?? null, updated: mtime };
}

export function listEpisodes() {
  if (!fs.existsSync(EPISODES)) return [];
  return fs.readdirSync(EPISODES).filter((d) => !d.startsWith('_') && fs.statSync(path.join(EPISODES, d)).isDirectory())
    .filter((d) => fs.existsSync(path.join(EPISODES, d, 'request.json')) || fs.existsSync(path.join(EPISODES, d, 'episode.json')))
    .map(episodeSummary).sort((a, b) => b.updated - a.updated);
}

export function episodeDetail(dirId: string) {
  const dir = path.join(EPISODES, dirId);
  if (!fs.existsSync(dir)) return null;
  const s = episodeSummary(dirId); const pid = s.productionId; const prod = path.join(PRODUCTIONS, pid);
  const spec = readJson(path.join(dir, 'episode.json'));
  const compiledIndex = readJson(path.join(prod, 'compiled', 'index.json'));
  const compiled: Record<string, any> = {};
  for (const v of s.videos) { const c = readJson(path.join(prod, 'compiled', `${v}.json`)); if (c) compiled[v] = { duration: c.duration, shots: c.shots.map((x: any) => ({ id: x.id, start: x.start, end: x.end, purpose: x.purpose, camera: x.camera.type, scene: x.scene })) }; }
  const report = readJson(path.join(prod, 'report.json'));
  const covers = ['main', 'red', 'blue', 'grid_preview_3x4', 'grid_preview_9x16'].map((k) => ({ k, f: path.join(prod, 'covers', k.startsWith('grid') ? `${k}.jpg` : `cover_${k}.jpg`) })).filter((x) => fs.existsSync(x.f)).map((x) => ({ key: x.k, url: fileUrl(x.f) }));
  const stillsDir = path.join(prod, 'stills');
  const stills = fs.existsSync(stillsDir) ? fs.readdirSync(stillsDir).filter((f) => f.endsWith('.png')).map((f) => ({ name: f, url: fileUrl(path.join(stillsDir, f)), mtime: fs.statSync(path.join(stillsDir, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime).slice(0, 40) : [];
  const finals = s.finals.map((v) => ({ video: v, url: fileUrl(path.join(prod, 'final', `${pid}_${v}.mp4`)), mtime: fs.statSync(path.join(prod, 'final', `${pid}_${v}.mp4`)).mtimeMs }));
  const feedback = db().prepare('SELECT * FROM feedback WHERE episode = ? ORDER BY id DESC').all(dirId);
  const approval = db().prepare('SELECT * FROM approvals WHERE episode = ?').get(dirId) ?? null;
  return {
    ...s, request: readJson(path.join(dir, 'request.json')), brief: readText(path.join(dir, 'brief.md')), revisions: readText(path.join(dir, 'revisions.md')),
    choice: spec?.choice ?? null, mandatory: spec?.mandatory ?? [], characters: spec ? Object.entries(spec.characters).map(([id, c]: any) => ({ id, name: c.name ?? id, archetype: c.archetype, kind: c.kind ?? 'puppet' })) : [],
    specShots: spec ? Object.fromEntries(Object.entries(spec.videos).map(([v, vd]: any) => [v, vd.shots.map((sh: any) => ({ id: sh.id, purpose: sh.purpose, camera: sh.camera?.type, narration: typeof sh.narration === 'string' ? sh.narration : sh.narration?.text }))])) : {},
    sets: spec ? [...new Set(Object.values(spec.scenes).map((sc: any) => sc.set))] : [], styles: spec ? Object.fromEntries(Object.entries(spec.videos).map(([v, vd]: any) => [v, vd.style ?? 'bright-cartoon'])) : {},
    feasibility: readJson(path.join(prod, 'feasibility.json')), compiled, compiledIndex, report, covers, stills, finals, feedback, approval, jobs: listJobs(dirId, 30),
    specVersions: fs.existsSync(path.join(dir, 'versions')) ? fs.readdirSync(path.join(dir, 'versions')).sort().reverse() : [],
  };
}

export function fileUrl(abs: string) { return '/api/files/' + path.relative(ROOT, abs).split(path.sep).map(encodeURIComponent).join('/'); }

/** Keep a copy of the spec before anything rewrites it (revision history). */
export function snapshotSpec(dirId: string, reason: string) {
  const f = path.join(EPISODES, dirId, 'episode.json'); if (!fs.existsSync(f)) return null;
  const vdir = path.join(EPISODES, dirId, 'versions'); fs.mkdirSync(vdir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}_${slugify(reason)}.json`;
  fs.copyFileSync(f, path.join(vdir, name)); return name;
}
