# Episode spec format

An episode is one JSON file: `episodes/<id>/episode.json`. The schema is in `engine/src/compiler/schema.ts`;
the vocabulary (what you may use) is in `docs/VOCABULARY.md`.

```
episode
├── id, title, format ("red-blue" | "single"), seed, logline, mandatory[], avoid[], choice{question, red, blue}
├── characters   { id: { archetype | kind:"gltf", look{...}, variants{...} (crowd templates), voice, voicePitch } }
├── scenes       { id: { set, params, duration?, continueFrom?{scene, at}, cast{}, crowds{}, props{}, structures{}, tracks{} } }
├── videos       { main|red|blue: { title, style, narrator, captions, music, score, overlays[], shots[], cover } }
└── covers       { video, shot, at, label }
```

## Separation of concerns
| layer | where | changes independently |
|---|---|---|
| story & timing | `scenes.*.tracks` (what happens, when, relative to markers) | yes |
| environment | `scenes.*.set` + `params` (+ `structures` for destructible buildings) | yes |
| characters | `characters` (procedural rig parameters or glTF models), `cast`, `crowds` | yes |
| animation behaviours | action names in tracks (engine vocabulary) | engine-side |
| camera direction | `videos.*.shots[].camera` | yes, without touching the story |
| editing | `videos.*.shots` (which scene time each shot shows, speed ramps, transitions) | yes |
| visual style | `videos.*.style` + `grade` overrides | yes |
| sound | `say` lines, `sound` events, `music`, automatic footsteps/bounces/impacts | yes |

A **scene** is continuous action in one place. A **shot** is a camera looking at a time range of a scene.
The edit is the list of shots, so you can cut away and back, show a reaction to something that already happened,
replay in slow motion, or compress time with a montage, all without re-choreographing anything.

## Tracks
Each key in `tracks` is an actor id, a crowd name (group actions), or `"world"`.
```json
"dex": [
  { "do": "dribble", "dur": 2.8, "at": 0 },
  { "do": "say", "text": "That's it?", "at": 3.9, "mark": "dexLine1" },
  { "do": "dribbleTo", "prop": "ball", "to": [6.4, -1.5], "gait": "run", "at": "@whistle+0.3", "mark": "drive" },
  { "do": "shoot", "prop": "ball", "outcome": "make", "mark": "bucket1" }
]
```
- Entries without `at` start when the previous blocking entry on that track ends.
- `mark` names a moment that other tracks and shots can use: `@drive`, `@bucket1.release`, `@bucket1.arrive`, `@dexLine1.done`.
- Targets: actor id (`"dex"`, `"dex.head"`, `"dex.chest"`), crowd name (centroid), prop id, set anchor (`"hoop"`), `[x, z]` or `[x, y, z]`.

## Branches
`"continueFrom": { "scene": "game", "at": "@end" }` starts a scene with everyone (actors, crowds, props, who holds what,
who is lying down) exactly where the source scene ended. Red and Blue then only contain what happens next.

## Crowds
```json
"crowds": { "toddlers": { "template": "toddler", "count": 100, "formation": "grid", "cols": 10, "center": [0, -8.6],
  "spacing": 0.62, "facing": "dex", "named": { "gus": { "char": "gus", "index": 94 } } } }
```
Members get seeded variations from the template's `variants`. Named members are real characters with their own
tracks. Group actions (`group:swarm`, `group:cling`, `group:pileOn`, `group:tower`, `group:collapse`, ...) exclude named
members unless `include`d, and create sub-groups (`toddlers_cling`, `toddlers_pile`, `toddlers_tower`) you can target
later with `fromGroup` / `excludeGroup`.

## Physics: simulated vs scripted
- **Scripted:** ball arcs (`shoot`, `throw` with `via` bounce points), dunks, jumps, piles, towers. These outcomes are guaranteed.
- **Simulated:** `group:collapse`, `ragdoll`, `group:pileTumble`, `dropProps`, `collapse` (structures), loose balls after a
  shot or release. Rapier deterministic build, fixed seed, so the same spec always produces the same result.
- `gravity` events change the world gravity for every later simulation and drive bound HUD counters.

## Shots
```json
{ "id": "dunk", "scene": "game", "from": "@dunk+0.2", "to": "@dunk.arrive+0.7",
  "ramp": [{ "at": 1.75, "speed": 0.35, "dur": 0.15 }, { "at": 2.75, "speed": 1 }],
  "camera": { "type": "track", "target": "dex", "dist": 5, "height": 1.4, "rel": 95 },
  "narration": { "text": "...", "at": 0.2 }, "overlays": [{ "kind": "tag", "text": "SIX MINUTES LATER", "dur": 1.4 }],
  "transition": "cut" }
```
Prefer marker-based `from`/`to` so changing story timing doesn't break the edit.

## Commands
```
npm run validate -- episodes/<id>/episode.json          # feasibility report, no rendering
npm run stills   -- episodes/<id>/episode.json main hook,dunk@1.5 --scale 0.35
npm run produce  -- episodes/<id>/episode.json [--videos main,red] [--scale 0.5 for a fast preview]
```
