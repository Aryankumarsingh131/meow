# Demo evidence (T34)

Status: **partial.** The journey is proven end to end over HTTP and on the
emulator; the card's "two cold real-device runs" need a physical phone.

## What a demo can show, and what backs it

| Claim | Evidence |
|---|---|
| A field worker signs in with a real account and gets the server's source list | Emulator, release v2.2 against Render: `docs/evidence/screenshots/v22-render-signed-in.png` |
| The app works offline and nothing is lost or duplicated on reconnect | Emulator, M1: `handoff-T15.md`, `handoff-T45.md`; journey step 2 (re-push is a duplicate) |
| A flagged sample opens exactly one case | Journey step 3 |
| A lab result counts only after a *different* person verifies it | Journey step 5 (the recorder gets 403) |
| **A case cannot be closed without real evidence** | Journey step 7: closure refused, checklist names the missing resident communication |
| A properly evidenced case closes | Journey step 8 |
| The on-device model runs offline and matches the desktop build | Emulator Model check, 29/29 (`docs/evidence/screenshots/t26-*.png`) |

Journey = `tests/e2e/field-case.spec.ts`, 8 steps, all passing on 2026-09-25.

## Boundaries to state in the demo

- Everything measured is **synthetic**: a printed colour card, rendered
  training images, demo users, a pretend lab. Nothing here says anything about
  real water.
- The model is **research-only**; in the live capture flow it never suggests a
  reading (no reference-card locator exists), so every reading is manual.
- Scientific validity (T23–T27 on real samples) and the pilot (T38) are
  separate gates, not shown by any of this.

## Still owed for T34

Two cold runs of the journey on a real phone, recorded (video, build hash,
receipts), per the card.
