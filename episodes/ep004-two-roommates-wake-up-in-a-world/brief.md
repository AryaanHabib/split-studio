# ep004 — Can't Lie (working title: "The Honest Apartment")

**Logline:** Two roommates wake up in a world where lying is physically impossible: every lie makes the lights
flicker and the liar sneeze. Then the landlord knocks for three weeks' overdue rent, and someone has to answer the door.

**Format:** red-blue · **Set:** `apartment` (lamp lighting → `night` when the bulbs blow) · **Style:** `bright-cartoon`
**Targets:** Main < 45 s, Red/Blue 25–35 s.

## Characters
| id | who | trait shown in animation | voice |
|---|---|---|---|
| `maya` | Maya, roommate #1 | confident: hands on hips, smug grin, walks straight into trouble. Bad at hiding things: her face switches the moment she's caught. Loud outfit (hot-pink blazer, lime trousers, orange cap). | `af_bella` |
| `theo` | Theo, roommate #2 | anxious and over-polite: worried/guilty faces, apologises, glasses + beige cardigan-ish tee. | `am_echo` |
| `pruitt` | Mr. Pruitt, the landlord | stocky, arms crossed, impatient. Turns out he has a secret too. | `am_onyx` |
| `narr` | the Narrator (hidden actor, like the ep002 phone voice) | can't lie either. When he tries, the room flickers and *he* sneezes off-screen. | `bm_george` |

The narrator is a hidden scene actor (not shot-level narration) so his lines live in scene time and the
flicker/sneeze can be synced to them with markers. The choice-card question is the only shot-level narration.

## The rule (shown, not told)
Every lie = `flicker` event on the lights + `glitch` blip + the liar plays `sneeze` (auto sneeze SFX).
A *true* line is followed by stable lights. This contrast is the engine of every joke.

## Hook (first second)
Maya shoves an empty takeout box in groggy Theo's face: "Did you eat my noodles?" Theo: "No." The lights flicker
and a sneeze launches him off the sofa. The impossible rule happens in the first 3 seconds, no setup text.

## Main (~40 s)
1. **hook** — Maya with the empty box, "Did you eat my noodles?" (wide 2-shot).
2. **no** — close on seated Theo: "No." → flicker → sneeze jolts him up off the sofa.
3. **yes** — Theo, instantly: "Yes. I ate them. I'm so sorry." Lights steady.
4. **rule** — Maya stares up at the lamp; Narrator: "Overnight, lying became physically impossible." Maya slowly grins and tosses the box away.
5. **outfit** (JOKE 1 setup) — Maya twirls in her loud outfit: "Okay. Honest question. Does this outfit look good?"
6. **theoPanic** — Theo close-up, worried: "It looks... so..." (lights *start* to flicker, he stops) "...bold."
7. **boldGood** — Maya leans in, suspicious: "Bold *good*?"
8. **love** (JOKE 1 payoff) — Theo panics: "I LOVE it!" → huge flicker → double sneeze → he falls flat on his back.
9. **narrLie** (JOKE 2 setup+payoff) — Narrator: "Luckily, Maya took it really well." The room flickers, an off-screen narrator sneeze. Maya and Theo (on the floor) look up at the ceiling.
10. **narrTrue** — Narrator: "She did not." Maya, hands on hips, glaring down at Theo. Lights steady.
11. **knock** (EVENT) — three knocks. Both snap to the door.
12. **rent** — through the door, Mr. Pruitt: "It's Pruitt. Rent's three weeks late. Open up."
13. **whisper** — Theo (whispering, terrified): "We can't lie to him!" Maya (whispering): "So who talks?"
14. **choice** — "Nobody can lie. Who answers the door?" RED: Theo answers (too polite) · BLUE: Maya answers (too confident).

## The decision
**Who answers the door?** Red = Theo (honest, over-polite), Blue = Maya (confident bluffer, bad at hiding things).

## Red payoff — "Theo answers" (~30 s)
Theo opens the door and tries to be nice: "Good evening, Mr. Pruitt! You look wonderful." → flicker + sneeze
(a *polite* lie still counts). He corrects himself: "Sorry. You look... tired." Then overshares the truth:
"We don't have the rent. We spent it on a karaoke machine." Maya facepalms. Pruitt: "I have been VERY patient
with you two." → **the lights flicker and PRUITT sneezes.** Maya's head snaps round, smug: "Ooh. How patient,
exactly?" Pruitt, guilty: "...I've been charging you double." Theo: "So we're... paid up?" Pruitt (true, steady
lights): "You're paid up." He slumps off, the door closes. Narrator: "Theo handled it like a hero." Flicker +
narrator sneeze. Narrator: "He cried a little." Theo cries happy tears; Maya hugs him.
**Outcome:** honesty wins, rent is covered, the landlord is the one exposed.

## Blue payoff — "Maya answers" (~30 s)
Maya struts to the door, smug. Theo hides behind the sofa (crouch). Door opens, Pruitt arms crossed.
Maya: "Mr. Pruitt! The rent is in the mail." → flicker + sneeze. "The check is—" → sneeze. Escalation: "Actually,
I'm the landlord here." → the flicker overloads, a bulb POPs, the apartment drops to the dark `night` lighting
and the sneeze knocks her flat on her back. In the dark, Pruitt: "...Did the power just go out?" Maya, from the
floor: "Yes." (true, nothing happens). Pruitt: "I'll come back tomorrow." Door closes. Theo pops up from behind
the sofa: "We still don't have the rent." Maya: "That's tomorrow-Maya's problem." Narrator (true, no flicker):
"Tomorrow-Maya also did not have the rent." Maya facepalms.
**Outcome:** the lie blows the fuses, they buy one night, debt still due. Different events, animation, dialogue
and outcome from Red.

## Mandatory items → shots
| director item | where it lands |
|---|---|
| Lying impossible: lights flicker + uncontrollable sneeze | main `no`, `love`, `narrLie`; red `compliment`, `pruittLie`, `endLie`; blue `mail`, `check`, `landlord` |
| Comedy, fast, character-driven | shots 0.9–3 s, every beat is a character choice (Theo's politeness vs Maya's confidence) |
| Main < 45 s, branches 25–35 s | checked by validator (see bottom) |
| JOKE: "does this outfit look good?" | setup main `outfit` → near-lie `theoPanic` → payoff `love` (double sneeze + fall) |
| JOKE: the narrator also cannot lie | setup main `rule` (narrator speaks truth, nothing happens) → payoff `narrLie` + `narrTrue`; callbacks red `endLie`/`endTrue` (lie) and blue `narrEnd` (deliberately true, no flicker) |
| EVENT: landlord knocks asking for overdue rent | main `knock` + `rent`; resolved differently in both branches |
| Maya: confident, bad at hiding things | struts, hands on hips, twirl; in Blue her bluff collapses on the first line |
| Theo: anxious, over-polite | worried faces, apologises instantly, polite lie "You look wonderful" in Red |

## Jokes (setup → payoff)
1. **Noodles** — setup: empty box in Theo's face (`hook`) → payoff: "No." flicker/sneeze (`no`) → instant confession (`yes`).
2. **Outfit** — setup: twirl + question (`outfit`) → tension: lights start flickering on "so..." (`theoPanic`) → payoff: "I LOVE it!" mega sneeze, falls (`love`).
3. **Narrator can't lie** — setup: narrator states the rule truthfully, lights steady (`rule`) → payoff: "Luckily, Maya took it really well." flicker + off-screen sneeze, both look at the ceiling (`narrLie`) → tag: "She did not." (`narrTrue`).
4. **Red: the landlord lies** — setup: Theo's honesty makes everyone a truth-teller (`karaoke`) → payoff: Pruitt sneezes on "very patient" (`pruittLie`) → "charging you double" (`double`).
5. **Red: narrator callback** — "Theo handled it like a hero." flicker/sneeze → "He cried a little." Theo crying.
6. **Blue: sneeze storm** — setup: Maya's smug walk (`strut`) → escalation: sneeze ×2 → payoff: bulb blows, blackout, she falls (`landlord`) → twist: "Yes." true in the dark (`yes`).
7. **Blue: narrator stays honest** — narrator says a true thing and nothing flickers; the joke is the contrast.

## Simulated vs scripted
Everything in this episode is **scripted**: speech, flickers, sneezes, falls, door, lighting changes and the thrown
takeout box (scripted `throw` arc; the box settles on landing). No simulated physics outcome decides anything.

## Needs engine work
Nothing blocks production. Small things that would help:
- **Costume change**: no wardrobe swap mid-scene, so Maya is in the loud outfit from the first frame (the
  outfit question works because she's wearing it). A `look` change action would let her come out of her room in it.
- **Bulb pop**: no particle/spark system; the "blown bulb" is the `pop` SFX + `lights: night` change. A 3-frame spark
  emitter at the lamp would sell it more.
- **Narrator sneeze**: uses the `sneeze` SFX at a lower pitch (`rate`), with no visual source on purpose (he's the narrator).
- **Voice through the door**: no muffled "through-the-wall" voice fx, so Pruitt's main line is plain with lower gain.
  A `muffled` low-pass fx would be the smallest addition.

## Open questions for the director
1. Title: "The Honest Apartment" or "Can't Lie"? (Spec uses "Can't Lie".)
2. Should the karaoke machine exist as a visible prop? There's no karaoke prop, so right now it's only mentioned. A `box` prop dressed as a speaker could stand in.
3. Red ending rewards honesty and Blue ending buys only one night. Is that the moral split you want, or should Blue end worse (eviction notice)?
4. Should the narrator's sneeze have a visual gag (camera shake/jolt on his sneeze), or stay audio-only?
