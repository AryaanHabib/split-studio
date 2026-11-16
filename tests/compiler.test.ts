import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { EpisodeSchema, type Episode } from '../engine/src/compiler/schema';
import { compileEpisode, collectTts } from '../engine/src/compiler/compile';

const fakeTts = (ep: Episode) => Object.fromEntries(collectTts(ep).map((l) => [l.key, { file: '', dur: 1.2, env: [0.2, 0.6, 0.3] }]));
const base = (): any => ({
  id: 't', title: 'T', seed: 7,
  characters: { a: { archetype: 'adult' }, kid: { archetype: 'toddler', variants: { shirt: ['#f00', '#0f0'] } } },
  scenes: { s: { set: 'court', cast: { a: { at: [0, 0], facing: 'hoop' } }, props: { ball: { kind: 'ball', heldBy: 'a' } },
    tracks: { a: [{ do: 'walkTo', to: [2, -4], mark: 'walk' }, { do: 'shoot', prop: 'ball', outcome: 'make', mark: 'shot' }] } } },
  videos: { main: { title: 'm', shots: [{ scene: 's', from: 0, to: '@shot.arrive+0.5', camera: { type: 'follow', target: 'a' } }] } },
});
const parse = (o: any) => EpisodeSchema.parse(o);

test('schema rejects malformed specs', () => {
  const bad = base(); delete bad.characters;
  assert.equal(EpisodeSchema.safeParse(bad).success, false);
  const bad2 = base(); bad2.videos.main.shots[0].camera = {}; // missing camera type
  assert.equal(EpisodeSchema.safeParse(bad2).success, false);
});

test('unsupported actions are reported, never silently dropped', async () => {
  const o = base(); o.scenes.s.tracks.a.push({ do: 'breakdance', dur: 2 });
  const { issues } = await compileEpisode(parse(o), {});
  const e = issues.find((i) => i.level === 'error' && i.msg.includes('breakdance'));
  assert.ok(e, 'expected an error for unknown action'); assert.ok(e!.fix);
});

test('unknown targets, sets, cameras and sounds are errors', async () => {
  const o = base(); o.scenes.s.tracks.a.push({ do: 'walkTo', to: 'the moon' }); o.scenes.s.tracks.world = [{ do: 'sound', id: 'kazoo' }];
  o.videos.main.shots.push({ scene: 's', from: 0, to: 1, camera: { type: 'drone-swoop' } });
  const { issues } = await compileEpisode(parse(o), {});
  const msgs = issues.filter((i) => i.level === 'error').map((i) => i.msg).join(' | ');
  assert.match(msgs, /the moon/); assert.match(msgs, /kazoo/); assert.match(msgs, /drone-swoop/);
  const o2 = base(); o2.scenes.s.set = 'moonbase';
  const r2 = await compileEpisode(parse(o2), {});
  assert.ok(r2.issues.some((i) => i.msg.includes('moonbase')));
});

test('markers drive timing: shot ends after the ball arrives', async () => {
  const { videos, scenes } = await compileEpisode(parse(base()), {});
  const m = scenes.s.markers;
  assert.ok(m['walk.end'] > m['walk']); assert.ok(m['shot.release'] > m['shot']); assert.ok(m['shot.arrive'] > m['shot.release']);
  assert.ok(Math.abs(videos.main.duration - (m['shot.arrive'] + 0.5)) < 0.05);
});

test('compilation is deterministic (same spec, same seed → identical output)', async () => {
  const h = async () => crypto.createHash('sha1').update(JSON.stringify((await compileEpisode(parse(base()), {})).videos)).digest('hex');
  assert.equal(await h(), await h());
});

test('branch scenes inherit positions and who holds the ball', async () => {
  const o = base(); o.scenes.b = { set: 'court', continueFrom: { scene: 's', at: '@end' }, tracks: { a: [{ do: 'celebrate', dur: 1 }] } };
  o.scenes.s.tracks.a = [{ do: 'walkTo', to: [3, -5] }];
  o.videos.b = { title: 'b', shots: [{ scene: 'b', from: 0, to: 1, camera: { type: 'close', target: 'a' } }] };
  const { scenes } = await compileEpisode(parse(o), {});
  const a = scenes.b.actors.find((x) => x.id === 'a')!;
  assert.ok(Math.abs(a.root[0].x - 3) < 0.05 && Math.abs(a.root[0].z + 5) < 0.05);
  assert.equal(scenes.b.props[0].segs[0].mode, 'attach');
});

test('crowds expand with seeded variation and group actions', async () => {
  const o = base(); o.scenes.s.crowds = { kids: { template: 'kid', count: 20, formation: 'grid', center: [0, -8], spacing: 0.6 } };
  o.scenes.s.tracks.kids = [{ do: 'group:swarm', target: 'a', radius: 1 }];
  const { scenes } = await compileEpisode(parse(o), {});
  const kids = scenes.s.actors.filter((x) => x.id.startsWith('kids_'));
  assert.equal(kids.length, 20);
  assert.ok(new Set(kids.map((k) => k.look!.shirt)).size > 1);
  assert.ok(kids.every((k) => k.root.length > 2), 'every member moved');
});

test('physics simulations are deterministic and flagged as simulated', async () => {
  const o = base(); o.scenes.s.structures = { tower: { at: [5, -5], floors: 5, size: [4, 4] } };
  o.scenes.s.tracks.world = [{ do: 'gravity', value: 4, at: 0.5 }, { do: 'collapse', structures: ['tower'], at: 1 }];
  const r1 = await compileEpisode(parse(o), {}); const r2 = await compileEpisode(parse(o), {});
  const b1 = Object.values(r1.scenes.s.bakes).find((b) => b.bodies.length > 10)!; const b2 = Object.values(r2.scenes.s.bakes).find((b) => b.bodies.length > 10)!;
  assert.ok(b1.simulated); assert.deepEqual(b1.data, b2.data);
});

for (const f of ['episodes/ep001-toddlers/episode.json', 'episodes/ep002-the-call/episode.json', 'episodes/ep003-gravity-city/episode.json']) {
  test(`genre spec compiles with zero errors: ${f}`, async () => {
    const ep = parse(JSON.parse(fs.readFileSync(f, 'utf8')));
    const { issues, videos } = await compileEpisode(ep, fakeTts(ep));
    assert.deepEqual(issues.filter((i) => i.level === 'error').map((i) => `${i.where}: ${i.msg}`), []);
    for (const v of Object.values(videos)) { assert.ok(v.duration > 10); assert.ok(v.shots.length >= 8); }
  });
}
