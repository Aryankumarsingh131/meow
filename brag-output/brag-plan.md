# Brag Plan: JalSakshi

## What is this app?
JalSakshi is a field water-quality system — a phone app for residents, field workers and
supervisors plus a FastAPI backend — that lets a resident report a problem with their water source
and see the recorded status of every source near them, without ever claiming the water is safe.

## The angle
One resident's journey, end to end, shown as the working app: **a problem at the handpump → a
report sent from her phone → the public map of sources near her → the one nearby source that has a
verified laboratory record.**

The restraint is what keeps it honest, and it is baked into the product: `statusLabel.ts` maintains
a `BANNED_WORDS` list (`safe`, `potable`, `drinkable`, `clean`, …) asserted in tests against every
status string the app can emit, and the map's own footnote says *"Colours show the type of source
only, not water quality."* So the video never says "find the safest water." It shows what the app
actually shows: a record. `All tested parameters within limits` is the real `labSummary()` wording,
not a safety verdict.

Every screen, label and sentence in the video is lifted from the source.

## Hook (first 2-3 seconds)
A resident holding a glass of discoloured water up to the light beside a handpump, on deep navy.
One line: **"The handpump water tastes wrong."** Then, smaller: **"Who do you tell?"**

## Key moments (the middle)
- The resident report form filling itself in: Area `Ward 7`, Water source `Handpump 4`, and three
  problem chips — *Taste*, *Colour*, *Stomach illness* — tapped one by one with a visible tap ring,
  under the app's own `Choose all that apply.` and its health warning.
- `Send report` pressed, and the confirmation arriving as a plain record: `Sent · Ward 7 · Handpump 4`.
  Deliberately not a celebration.
- The public map: sources as type-coloured pins, her own `Handpump 4 · 1 open issue` ringed in amber,
  then a tap on the nearest tap — popup opens with the app's real fields, and the status line resolves
  to green: `All tested parameters within limits`.

## Outro / punchline
**"It shows you the record, never a verdict."** → **JalSakshi** → **"Your water, your voice."**

## User flow worth showing
Entry → key action → result, taken from `residentApp.tsx`, `publicMap.tsx` and `statusLabel.ts`:
1. **Entry** — a problem with the water at her own source.
2. **Key action** — select area + source, tick the problems that apply, attach photos, send.
3. **Result** — open the public map, tap the nearest source, read its recorded status and age.

Scenes 2 and 3 *are* this flow. That is the centrepiece; scenes 1 and 4 only frame it.

## Tone
- Preset: `polished`
- Creative direction: a quiet product film that follows one person and lets the working app do the talking
- Interpretation: restraint is the subject and the technique. Long holds, soft 0.5s crossfades,
  light-weight type, no hype adjectives, no exclamation. Every beat the video claims is a beat the
  app actually performs, at the moment it performs it.

## Format: landscape — 1920x1080
## Duration: 20.77s (4 scenes)

## Visual identity (from the project)
- Background (product scenes): `#F0F7FF`; cards `#FFFFFF`, card alt `#F8FBFF`
- Background (hook + outro): `#0F2942` navy with a faint `#194641` vignette
- Accent: `#1D6FD0` primary, `#14507D` dark, `#E8F2FC` soft
- Text: `#0F2942`, muted `#5A7387`
- Status: ok `#0E9F6E` on `#E6F6F0` (darkened to `#0B7E57` where WCAG AA required it);
  watch `#C77700` on `#FDF3E3` (darkened to `#A16000` / `#8F5600` on light surfaces)
- Borders `#DCE9F5` / `#C3DCEF`; radii 8 / 12 / 16 / pill; card shadow `0 2px 10px rgba(15,41,66,0.06)`
- Map pin colours are the project's own `SOURCE_TYPE_COLORS`: hand pump `#2563EB`, tap `#0891B2`,
  well `#7C3AED`, tank `#EA580C`
- Display + body font: Inter
- Strongest visual element: the white card on tinted blue — the app's universal container

## Share copy (draft)
The handpump water tastes wrong. Who do you tell? JalSakshi: report it from your phone in one tap,
then check the recorded status of every source near you. It shows you the record — never a verdict.

## Audio direction
- Role: sparse, motion-matched UI accents over a low steady bed
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (109.96 BPM)
- Music treatment: volume automation lane 0 → 0.30 over 0.6s, held, then 0.30 → 0 across 19.6–20.75s.
  No ducking (no narration), no riser, no whoosh.
- Music cue guidance: bundled preset read. **Three strong-cue locks:** `10.93s` (0.97) she taps the
  nearest pin; `17.47s` (0.99) the wordmark; `18.56s` (0.99) the tagline. Beat-grid alignments:
  `1.09 / 2.19` (scene-1 lines), `5.34 / 6.00 / 6.56` (the three problem chips — every other beat,
  above the readable floor), `7.64` (send), `8.19` (confirmation), `12.55` (status resolves green).
- Audio-reactive treatment: subtle — music RMS drives the phone's shadow depth and the background
  vignette; treble drives a faint glow on the outro wordmark. No waveform, no bars, no text scaling.
- SFX posture: 8 cues, all soft and all motion-matched — three tap clicks, a send press, a quiet
  confirmation, a map-tap click, a soft popup accent, one bell on the wordmark.
- Restraint rule: the send confirmation is a *record*, not a win. No success stinger anywhere near a
  water-quality result.

## Storyboard

### Scene 1 — The problem — 0.00→4.39s
Deep navy. A resident holds a glass of amber water up beside a handpump that is running discoloured
water. Copy right of the illustration: "The handpump water tastes wrong." then "Who do you tell?"
Sequential/interaction: the water drops fall in one by one; the two lines land on beats 1.09 / 2.19.
Audio intent: quiet, unresolved. No accent.
Transition mood: soft (0.5s crossfade) → Scene 2

### Scene 2 — She reports it — 4.39→9.29s
Light. Phone left, copy right. The resident report screen: `JalSakshi / Your water, your voice.`,
`Area: Ward 7`, `Water source: Handpump 4`, `Problem / Choose all that apply.`, six chips, the health
warning, `Photos (optional)`, `Send report`.
Sequential/interaction: **yes** — tap rings expand on *Taste* (5.34), *Colour* (6.00) and *Stomach
illness* (6.56), each chip turning selected as it is tapped; `Send report` is pressed at 7.64 and
depresses; `Sent · Ward 7 · Handpump 4` appears at 8.19. Right column: "She reports it from her
phone." with "Problem, source, photos." and "Sent in one tap."
Audio intent: the sound of a form being filled in correctly. Clicks on the taps, a quiet tone on send.
Transition mood: soft (0.5s crossfade) → Scene 3

### Scene 3 — She checks what is nearby — 9.29→15.29s
Light. Phone left, copy right. `Sources near you / Ward 7`, a map of type-coloured pins, the legend
(`Hand pump 2 · Tap 2 · Well 1 · Tank 1`), and the app's footnote about colour and the 500 m fuzzing.
Sequential/interaction: **yes** — pins pop in one by one from 9.83; an amber ring pulses on her own
source, labelled `Handpump 4 · 1 open issue` (10.37); a tap ring lands on the nearest tap at **10.93
(beat-locked)**; the popup opens at 11.20 with `Tap 3 / Tap · Ward 7 / Open issues: 0 · Recorded 3
days ago / Location: about 500 m`; the status line resolves from grey to green at 12.55.
Audio intent: a click and one soft accent for the popup. Nothing triumphant on the green.
Transition mood: soft (0.5s crossfade) → Scene 4

### Scene 4 — Outro — 15.29→20.75s
Navy. Kicker "It shows you the record, never a verdict." (15.79, holds to the end), then **JalSakshi**
at **17.47 (beat-locked)** and "Your water, your voice." at **18.56 (beat-locked)**.
Audio intent: one gentle bell on the wordmark, then the bed fades out under the held frame.

**Music mood for this video:** steady, clean, low — vol-12 at 0.30 with a 0.6s fade-in and a 1.15s tail.
**Audio summary:** an unbroken low bed for all 20.8s, eight soft motion-matched cues that follow the
simulated taps rather than decorating them, and a single bell on the wordmark before the fade-out.

## Poster frame
13.6s — the map, the open popup with the green `All tested parameters within limits`, and the right
column headline. The whole story in one settled frame.
