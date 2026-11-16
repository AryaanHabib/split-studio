# What the engine can and cannot produce (honest matrix)

Status as of the Phase 1 + genre-test milestone. "Can" means it is implemented, has been rendered, and the frames
were inspected. It does not mean it looks like a studio production.

## How the animation is made
Every frame is rendered from a 3D scene in a headless browser (Three.js/WebGL), driven by a compiled timeline.
Characters are rigged puppets animated by code (procedural clips), cameras are scripted, and physics comes from a
real rigid-body solver (Rapier). **No video-generation model, no stock footage, and no paid service is involved.**
That makes the output deterministic, editable shot by shot, and free to run. The ceiling is the stylised
"game-like" look of the available assets.

## ✅ Can produce now (demonstrated)
| capability | example |
|---|---|
| Characters walking, running, waddling, sneaking, crawling, backing away, jumping, falling, lying, getting up, sitting | ep001 toddlers waddling; ep002 Sam backing away; ep003 jogger crawling at 4G |
| Expressive faces: 17 expressions + blinking + mouth movement driven by the speech audio | smug → confused → terrified Dex; crying toddlers |
| Gestures and reactions: point, wave, shrug, facepalm, panic, celebrate, laugh, cry, sneeze, phone to ear, push/poke, hug/cling | |
| Crowds up to ~150 animated characters with seeded variation, group behaviours (swarm, cling, dogpile, tower, scatter, unison head-turn, regroup) | ep001 (100 toddlers) |
| Characters riding/clinging to other characters | toddlers clinging to Dex's legs |
| Props: carry, dribble, shoot, dunk, throw (with bounce points), grab/steal, drop | basketball, phone handset, mug |
| Scripted physics jokes with a guaranteed outcome | ball banks off a head into the hoop |
| Real simulations (deterministic, seeded) | tower of toddlers collapsing; falling crates; buildings failing floor by floor |
| Variable gravity driving simulations and HUD | ep003 1G→32G |
| Camera language: static, dolly, follow, side-track, orbit, close-up, over-the-shoulder, top-down, auto-framed wide, POV, floor-level; push-ins, zoom punches, handheld drift, impact shake, dutch angle | |
| Editing: cuts, reaction cutaways, replays, montage time-compression, speed ramps / slow motion, flash and fade transitions, audio bridges across cuts | |
| Visual styles independent of story: bright-cartoon, toon (cel), horror, noir, documentary, disaster-epic, dreamy, flat | ep002 horror vs ep001 bright |
| Environments: basketball arena, night apartment (working door, phone, lamp/blackout/flicker), city intersection with destructible buildings, lab with gravity dial | |
| Local neural TTS voices (17 voices), pitch-shift for kids, phone/radio/echo effects | |
| Procedural SFX (34 ids), ambience beds, procedural music (7 styles) with ducking and loudness normalisation | |
| Overlays: titles, name labels pinned to characters, captions, scoreboards, data-bound counters, Red/Blue choice card, end cards | |
| Three matching covers from one frame + grid crop previews | |
| Technical QC: codec/size/fps/duration, full decode, black frames, frozen picture, silence, loudness, contact sheets | |

## 🟡 Possible, but needs assets or engine additions first
| request | what's missing | smallest way to add it |
|---|---|---|
| Animals and creatures (dog, dragon, alien) | no quadruped/creature rig | import a CC0 rigged glTF (e.g. Quaternius animal packs) with walk/run/idle clips; map clips in `characters.<id>.clipMap` |
| Medieval army, spaceship, castle, forest, beach, office, school, space | sets not built | add a set builder (procedural, like `city`) or import a glTF environment; register anchors/colliders in `shared/sets.ts` |
| Realistic humans / specific art styles | puppet rig is stylised | import rigged glTF characters (Mixamo-free / CC0 packs) — engine already plays glTF clips (the robot referee) |
| Particles: dust, smoke, fire, explosions, rain, magic | no particle system | add a GPU-instanced particle emitter driven by world events |
| Vehicles driving, crashing | cars are static decor | make cars props with path/physics modes (same as balls/blocks) |
| Liquids, cloth, soft bodies, crushing/deforming objects | rigid bodies only | out of scope for the MVP; fake with scripted scale/shape changes |
| Accurate lip-sync close-ups | mouth opens with the audio envelope but no visemes | phoneme-to-viseme mapping from the TTS phonemes; still cartoon mouths |
| Fingers, detailed hand interaction | puppet hands are mitts | finger bones on the rig |
| Long dialogue scenes | works, but cartoon mouths over long talk get monotonous | write visual business into every line |

## ❌ Cannot currently produce
- Photorealistic footage, or anything that needs a video-generation model.
- Arbitrary brand-new detailed characters or creatures generated automatically from a text prompt.
- Copyrighted characters, real people or real team branding (deliberately not supported).
- Autonomous story writing *inside* the website. Creative writing happens in Claude Code sessions under your
  subscription (see CLAUDE.md). The website/engine only compiles, renders and edits.

## Performance and the no-GPU constraint
| machine | renderer | measured / expected speed (1080×1920) |
|---|---|---|
| this cloud container (4 vCPU, no GPU) | SwiftShader (software WebGL) | 1.1–1.6 s per frame with 100 characters; ~0.6–0.9 s for small casts. A 40 s video takes 25–45 min. |
| typical Windows PC with a discrete GPU | Chrome ANGLE/D3D11 (`STUDIO_GPU=1`) | **not measured yet**. Expected 10–50× faster; run `npm run doctor` and a test render to confirm. |

The no-GPU environment limits **iteration speed**, not what the engine can express: the same specs render
identically, just faster, on a GPU machine.

## Quality, honestly
- Visually this is a stylised low-poly / toy-like look. It's consistent and readable, closer to an indie game than to Pixar.
- Procedural animation reads well for broad comedy and clear action. It's weaker for subtle acting.
- Kokoro voices are good for free local TTS but recognisably synthetic. Pitch-shifted "toddler" voices sound like it.
- Procedural music and SFX are functional and license-clean, but basic. Dropping real CC0/owned recordings into
  `assets/sfx/` (and later `assets/music/`) is the cheapest big quality upgrade.
- Creative quality (are the jokes landing?) can only be judged by watching. The engine checks feasibility and technical quality, not funniness.
