# Hyperframes Composition Brief: JalSakshi

> Shipped brief. This reflects the cut that was rendered (`brag.mp4`, 20.77s), after the first
> concept — a text-forward piece about the app's `BANNED_WORDS` list — was replaced on request with
> a resident-journey demo.

## Objective
A short launch-style brag video for JalSakshi that follows one resident from a bad-water problem to
the recorded status of a source near her, shown as the working app.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4` — 1920x1080, 30fps, h264 + aac, 623 frames
- Format: landscape — 1920x1080
- Duration: 20.77s

## Source Material
- Project root: `C:/Users/Aryan Kumar Singh/OneDrive/Desktop/meow1`
- Primary files read: `apps/mobile/src/theme.ts`, `apps/mobile/src/statusLabel.ts`,
  `apps/mobile/src/residentApp.tsx`, `apps/mobile/src/publicMap.tsx`,
  `apps/mobile/src/publicMapModel.ts`, `apps/mobile/src/publicApp.tsx`,
  `apps/mobile/src/pluccy.tsx`, `apps/supervisor/README.md`
- Product name: **JalSakshi**
- Tagline: "Your water, your voice." (`residentApp.tsx`)
- Key UI recreated: the **resident report form** and the **public source map with a pin popup** —
  both as real screens, not diagrams.
- Copy that appears verbatim:
  - `Your water, your voice.` · `Area` · `Water source` · `Problem` · `Choose all that apply.`
  - `If anyone is unwell, also contact a health worker now.` · `Photos (optional)`
  - `Colours show the type of source only, not water quality. Pins are placed about 500 m from the
    real location unless a laboratory has verified the source.`
  - `All tested parameters within limits` (the real `labSummary()` title)
  - Popup fields `Open issues:` / `Recorded 3 days ago` / `Location: about 500 m`
  - Map legend labels from `SOURCE_TYPE_LABELS`; pin colours from `SOURCE_TYPE_COLORS`
  - Written for the video (not from source): "The handpump water tastes wrong." / "Who do you tell?"
    / "She reports it from her phone." / "Then she checks the sources near her." /
    "Colour shows type, not quality." / "It shows you the record, never a verdict."

## Creative Direction
- Tone preset: `polished`
- Creative direction: a quiet product film that follows one person and lets the working app do the talking
- Angle: a resident's journey — problem → report → map → the one nearby source with a verified lab
  record. The honesty constraint is load-bearing: the app is architecturally forbidden from calling
  water safe (`BANNED_WORDS` in `statusLabel.ts`, asserted in tests), so the video never ranks a
  "best" source. It shows the record.
- Hook: a resident holding a glass of discoloured water up beside a handpump. "The handpump water
  tastes wrong." / "Who do you tell?"
- Outro: "It shows you the record, never a verdict." → **JalSakshi** → "Your water, your voice."
- Avoid: generic SaaS language; abstract filler; **any** visual implying water is safe — no splashing
  droplets, no purity imagery, no green checkmark, no success stinger on a water-quality result.

## Visual Identity
- Light scenes `#F0F7FF`; cards `#FFFFFF` / `#F8FBFF`; dark scenes `#0F2942`
- Accent `#1D6FD0` / `#14507D` / `#E8F2FC`; text `#0F2942`, muted `#5A7387`
- ok `#0E9F6E`→`#0B7E57`, watch `#C77700`→`#A16000`/`#8F5600` where WCAG AA required darker values
- Borders `#DCE9F5` / `#C3DCEF`; radii 8/12/16/pill; `shadow.card` = `0 2px 10px rgba(15,41,66,0.06)`
- Pin colours are the project's `SOURCE_TYPE_COLORS`
- Font: Inter throughout

## Storyboard
`brag-output/brag-plan.md` holds the scene-by-scene contract. Summary:
1. **The problem** — 4.39s — resident + handpump + discoloured glass; two lines.
2. **She reports it** — 4.90s — the report form, three problem chips tapped, send pressed, `Sent` row.
3. **She checks what's nearby** — 6.00s — the map, pins, her own source ringed, a tap on the nearest,
   the popup and its status resolving to green.
4. **Outro** — 5.46s — kicker, wordmark, tagline.

## Audio
- Audio role: sparse, motion-matched UI accents over a low steady bed
- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`, 109.96 BPM
- Music treatment: `data-automation` volume lane, 0 → 0.30 over 0.6s, hold, 0.30 → 0 across 19.6–20.75s
- Music cue guidance: bundled preset at `assets/music/cues/…music-cues.json`. Strong-cue locks at
  **10.93** (map tap), **17.47** (wordmark), **18.56** (tagline). Beat-grid at 1.09 / 2.19 / 5.34 /
  6.00 / 6.56 / 7.64 / 8.19 / 12.55.
- Audio-reactive treatment: subtle. `assets/music/audio-data.js` (pre-extracted via the
  `hyperframes-creative` extraction script, 30fps, trimmed to the root duration) drives three CSS
  custom properties per frame: phone shadow depth and background vignette from RMS, outro wordmark
  glow from treble. No waveform / equalizer / particles.
- SFX (8 total, all low high-frequency risk): `interface/click_003` ×4 (three chip taps + the map
  tap), `ui/click2` (send), `ui/rollover2` (the quiet confirmation), `impact/impactSoft_medium_000`
  (popup), `impact/impactBell_heavy_000` (wordmark). Volumes 0.5–0.66.
- Restraint rule: the send confirmation is a record, not a win — no success stinger.

## Gate
`npx hyperframes check` — **passed**, 0 errors across lint, runtime, layout, motion and WCAG AA
contrast. Remaining warnings are lint's monolithic-file / sub-composition style preferences and
transient text overlap during the 0.5s crossfades.
