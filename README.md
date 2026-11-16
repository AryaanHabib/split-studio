# THE SPLIT STUDIO

A local-first, zero-subscription factory for animated short-form videos. You (the director) give an idea; a
Claude Code session (your own subscription) writes a structured episode spec; the local engine renders real
3D animation, voices, sound, edit, captions and covers. The first format is **Red/Blue**: a Main video that ends
on a choice, plus two fully animated branch videos.

> Status: **engine, three genre tests and the website MVP working.** See `PROGRESS.md`.

## Quick start (Windows)
1. Install the free prerequisites:
   - Node.js 20+ (https://nodejs.org)
   - Python 3.10+ (https://python.org; tick "Add to PATH")
   - FFmpeg: `winget install --id Gyan.FFmpeg -e` in PowerShell, then open a **new** terminal so PATH updates
2. In a terminal in this folder:
   ```bash
   npm install
   ```
   ```bash
   npx playwright install chromium
   ```
   ```bash
   npm run setup
   ```
   `npm run setup` installs the voice packages into the same Python the studio uses (`python -m pip`),
   downloads and verifies the local voice model, then prints the machine report (`npm run doctor`).
   Everything in the report should show ✓.
3. If `doctor` shows your graphics card as the WebGL renderer, render on the GPU (PowerShell):
   ```bash
   $env:STUDIO_GPU="1"
   ```
4. Start the studio (website + background worker):
   ```bash
   npm run app
   ```
   Open http://localhost:3000 → **Create** → describe the idea → **Develop story with Claude**. The worker runs
   Claude Code on this PC with your own login (Claude Code must be installed and logged in; no API key is used).
   Then **Compile preview**, scrub the live preview, **Render draft** or **Render final**, watch the three videos,
   give feedback, approve, and use **Publish** for the manual posting checklist.
   Renders keep running if you close the browser. Outputs: `productions/<id>/final/*.mp4`, `covers/`, `qc/`.

Linux/macOS: the same steps (`export STUDIO_GPU=1`).

## Making a new episode
In this folder, start Claude Code and run:
```
/develop-story What if gravity reversed for one person at a wedding? Must include: the cake. Blue ending should be wholesome.
```
Claude reads `docs/VOCABULARY.md` + `docs/SHOWRUNNER_PLAYBOOK.md`, writes `episodes/<id>/brief.md` and
`episode.json`, validates them, previews key frames and reports anything the engine can't do yet. Then:
```bash
npm run produce -- episodes/<id>/episode.json --scale 0.5
```
(fast preview) and, after approval, render without `--scale`. For feedback use `/revise <id> <notes>`.

## Commands
| command | what it does |
|---|---|
| `npm run validate -- <episode.json>` | schema + feasibility report (no rendering) |
| `npm run stills -- <episode.json> <video> <shotId[@sec],...> [--scale 0.35]` | preview frames |
| `npm run produce -- <episode.json> [--videos main,red] [--scale 0.5] [--force]` | full pipeline |
| `npm run docs` | regenerate `docs/VOCABULARY.md` from the engine |
| `npm run doctor` | inspect this machine |
| `npm run typecheck` | TypeScript check |

## Layout
```
engine/src/compiler   spec schema, story→animation compiler, physics bakes, character defaults
engine/src/runtime    Three.js renderer: sets, puppet rig, pose clips, cameras, overlays, styles
engine/src/render     headless Chromium capture → FFmpeg
engine/src/audio      Kokoro TTS worker, procedural SFX/music, mixer
engine/src/covers     Main/Red/Blue covers from one frame
engine/src/qc         technical quality checks
episodes/             episode specs (ep001 comedy/sports, ep002 horror, ep003 physics what-if)
productions/          rendered outputs (per episode)
docs/                 VOCABULARY (generated), EPISODE_SPEC, SHOWRUNNER_PLAYBOOK, CAPABILITIES, ARCHITECTURE
bible/                story bible for recurring characters/universes
assets/               fonts, glTF models (CC0), optional sfx overrides
```
