# THE SPLIT STUDIO — progress

_Last updated: 2026-11-16. Built and verified in a 4-vCPU cloud container with **no GPU** (software WebGL)._

## Status at a glance
| phase | status |
|---|---|
| 1 · Prove real animation (Main/Red/Blue + covers) | **done**: ep001 rendered, inspected, revised |
| 2 · Reusable engine, second genre | **done**: horror (ep002) and physics what-if (ep003) through the same engine |
| 3 · Website connected to the engine | **working MVP**: create → Claude develops → compile → live preview → render → watch → feedback → approve |
| 4 · Claude-assisted showrunner | **working**: CLAUDE.md, /develop-story, /revise, playbook, story bible, headless runs from the website |
| 5 · Final editing automation | mostly in place (cuts, ramps, captions, mix, loudness, covers, QC); creative review is manual |
| 6 · Publishing | manual hand-off queue only; no platform APIs connected |
| 7 · Daily operations | job queue + crash recovery + shot cache; no scheduling or notifications yet |

## Verified results (watched/inspected, not assumed)
- **ep001 "100 Toddlers vs 1 Pro"** (comedy/sports, Red/Blue): Main 45.7 s / 22 shots, Red 28.2 s / 12 shots,
  Blue 30.2 s / 15 shots. 100 animated toddlers, dribbling, a layup, a three-pointer, a slow-motion dunk, a unison
  head-turn, a steal, a choice card. Red: clinging toddlers, a dogpile, a ball banked off the pro's head into the hoop.
  Blue: a 14-toddler tower that collapses under real physics simulation, then the pro wins and everyone cries.
  Per-shot contact sheets in `productions/ep001/qc/`. QC 15/15 on the re-mixed Main.
- **ep002 "The Call"** (horror, single): dark apartment, phone call from his future self, the door opens by itself,
  backlit double in the doorway. Horror style, phone-filtered voice. Stills inspected; full render queued.
- **ep003 "Gravity Doubles Every 5 Seconds"** (physics what-if, single): procedural city, HUD bound to the simulation,
  the same kid's jump at 1G/2G/4G, a jogger crawling, buildings failing floor by floor. Stills inspected; full render queued.
- **ep004 "Can't Lie"**: **written by Claude Code from the website** (headless, under the user's subscription)
  from a one-paragraph idea plus jokes, an event and characters. Validated with 0 errors; full render running.
  The session ran out of the 5-hour plan limit while polishing camera framing. The worker reported it honestly as failed, and the spec was already valid.
- Compiler test suite: 11/11 passing (`npm test`).

## How it works (one paragraph)
An episode is a JSON spec: characters, scenes with timed action tracks, and videos made of shots. The compiler
turns it into time-indexed animation data (locomotion, crowd behaviours, prop arcs, Rapier physics bakes, audio
cues, captions). A Three.js runtime renders any frame as a pure function of time inside headless Chromium. FFmpeg
encodes; a local Kokoro TTS + procedural SFX/music mixer produces sound; covers and QC run automatically. Details:
`docs/ARCHITECTURE.md`. What it can and can't do: `docs/CAPABILITIES.md`.

## Known limitations (honest)
- **Speed without a GPU:** ~0.4–1.1 frames/s at 1080×1920 here (≈25–45 min per minute of video). A Windows GPU
  should be far faster (`STUDIO_GPU=1`), but that has **not been measured yet**.
- **Look:** stylised toy/low-poly. Procedural animation suits broad comedy and action, not subtle acting.
- **Assets:** 4 sets (arena, apartment, city, lab), procedural people of any age/build, one imported CC0 robot.
  No animals, vehicles in motion, particles (dust/fire/smoke), liquids or cloth yet.
- **Audio:** Kokoro voices are good for free TTS but recognisably synthetic. SFX/music are procedural and basic.
  Drop real recordings into `assets/sfx/` to upgrade.
- **Building collapses** run at reduced visual gravity so they are readable (stated on screen in ep003).
- **Claude usage:** story development uses your Claude Code plan. A long episode used ~160 agent turns and hit the
  5-hour limit. Expect 1–3 episodes per window. The manual workflow (copy the prompt into an interactive session) is always available.
- **Publishing:** no automatic posting. The queue is a checklist with files, captions and URL recording.
- Live preview in the browser is real-time only with GPU WebGL. Here it renders a few frames per second.

## Mistakes found and fixed along the way (kept for the record)
- Teleports took effect one tick late, so characters faced where others *used* to be. Now exact at the marker.
- The apartment "door frame" was a solid block, so the door could never reveal anything. Rebuilt as jambs + header.
- Loudness normalization silently did nothing because FFmpeg's stderr wasn't captured. Fixed; QC now measures loudness.
- Render was ~5 s/frame with 100 characters. Merged static meshes per joint, blob shadows for crowds, face-detail LOD → ~1.4 s.
- Rigid-block buildings wouldn't fall (pinned by friction). Switched to progressive floor failure.

## Next tasks
1. Watch ep004 and give feedback through the Studio's Feedback tab (tests the revise loop end to end).
2. On the Windows PC: `npm run doctor`, render one episode with `STUDIO_GPU=1`, record real speed here.
3. Add particles (dust/smoke/sparks) and a few CC0 glTF character/animal packs to widen what stories can show.
4. Notifications when renders finish; a daily backlog view; optional YouTube Data API upload (needs your OAuth app).
5. Better music: allow user-supplied CC0/owned tracks per mood.

## Commands
```bash
npm run app                      # website (http://localhost:3000) + background worker
npm run worker                   # worker only
npm run produce -- episodes/<id>/episode.json [--videos main] [--scale 0.5] [--shots a,b --reuse-shots]
npm run validate -- episodes/<id>/episode.json
npm run stills -- episodes/<id>/episode.json main shotId,shotId@1.5 --scale 0.35
npm test                         # compiler tests
npm run doctor                   # machine report
```
Startup on Windows: see README.md.
