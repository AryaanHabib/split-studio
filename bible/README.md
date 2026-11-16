# Story Bible

Recurring universes and characters. Episodes are independent by default. Only link an episode to an entry here
when the director wants continuity.

- `characters/<id>.json`: the character definition block (same format as `episode.characters`) plus `traits`, `voice`, `history[]`.
- `universes/<id>.md`: rules of the world, timeline of episodes, open threads, things that must never contradict.

The showrunner copies character blocks from here into new episodes and appends to `history` after each episode.
