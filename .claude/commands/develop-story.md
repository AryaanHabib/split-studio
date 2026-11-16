---
description: Develop a director's idea into a validated Red/Blue episode spec
argument-hint: <idea and any mandatory instructions>
---
Director's idea and instructions:

$ARGUMENTS

Follow the workflow in CLAUDE.md exactly:
1. Read docs/VOCABULARY.md, docs/SHOWRUNNER_PLAYBOOK.md, docs/EPISODE_SPEC.md and the closest example episode.
2. Pick an episode id (next free `epNNN-slug` in episodes/). Write brief.md first: hook, decision, Red payoff, Blue payoff, mandatory items mapped to shots, jokes as setup/payoff pairs, simulated vs scripted beats, anything that needs engine work.
3. Write episode.json (format red-blue unless the director asked otherwise; main ≈ 30–45 s, branches ≈ 25–35 s).
4. Run `npm run validate -- episodes/<id>/episode.json` and fix all errors.
5. Render preview stills for the key shots of each video and inspect them; fix framing problems.
6. Report: logline, the three videos' shot lists in one line each, feasibility warnings, and questions for the director. Do not start full renders unless asked (`npm run produce -- episodes/<id>/episode.json`).
