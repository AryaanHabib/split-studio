---
description: Apply director feedback to an existing episode with minimal, targeted changes
argument-hint: <episode id> <feedback, optionally naming a video/shot>
---
Feedback: $ARGUMENTS

1. Open episodes/<id>/episode.json and brief.md. Identify exactly which tracks, shots and overlays the feedback touches.
2. Change only those. Keep marker names stable so unrelated shots keep their timing.
3. Validate (`npm run validate -- <file>`), preview the affected shots with `npm run stills`, inspect them.
4. Append to episodes/<id>/revisions.md: date, the request verbatim, what changed, which videos need re-rendering.
5. Tell the director which videos must be re-rendered and roughly how long that takes on their machine.
