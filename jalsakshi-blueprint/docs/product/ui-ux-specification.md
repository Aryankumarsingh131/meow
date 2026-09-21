# UI specification

Design intent: a calm field notebook with a clear next action, not a futuristic AI dashboard. This is a functional screen specification; no new stock/generated imagery is required for the application.

## Navigation and visual rules

Mobile tabs: **Test, Sources, Queue, Settings**. During a test show numbered steps with a persistent back action and saved-draft indicator. Supervisor web: **Cases, Sources, Reports, Settings**. Primary hierarchy is next action → evidence/state → supporting detail.

Use bundled **Noto Sans** and **Noto Sans Devanagari**, subject to recording exact font license in T28. System fallback is permitted. Body16–18sp, labels14sp, section20–24sp; mobile line height approximately1.45. Avoid all-caps Hindi, thin weights and decorative “AI” type. Support Android text scaling to200% without hiding actions.

Palette proposal: paper #F5F4EE, white #FFFFFF, ink #0B2831, teal #0F6B67, muted text #465D63; caution #8A5300 and issue #A33825. Every actual foreground/background combination must pass contrast checks; a hex list is not proof. Pair color with icon and explicit status. No green “safe” badge.

Spacing scale4/8/12/16/24/32; mobile outer16–20dp, minimum48dp touch targets; 8dp between adjacent controls. Two-column web evidence layout at≥1024px, one column below. Mobile width320px supported, keyboard must not cover Save. Long tables use horizontal scrolling only when unavoidable and have accessible labels.

Components: labeled field + persistent validation text; provenance chip; sync-state row; next-action banner; case timeline; evidence preview; evidence-required checklist; destructive-action confirmation. No ornamental charts where counts/list answer the question.

## Screen contracts

| Screen | Layout and primary interaction | Data / API | Required states and recovery |
|---|---|---|---|
| S01 Provision/sign in | Program membership, language choice, explanation of offline access | OIDC + offline-grant + paged bootstrap | Offline first login explains need for network; denied scope; partial download resumable; expired grant locks sensitive access |
| S02 Sources | Search first, QR secondary, recent/assigned sources; last known record | SQLite cache; sources/history endpoints | Empty assignment; stale timestamp; unknown QR; permission denied; no coordinates still usable |
| S03 Kit protocol | Manufacturer/lot/expiry; one instruction per step; timer/read window | Cached immutable protocol/lot version | Unsupported/expired kit; interrupted timer; invalid timing; no hidden auto-restart |
| S04 Capture | Camera preview, reference frame guide, shutter, manual fallback | Camera → native preprocess/analysis | Missing reference; glare/blur reason; camera denied; decoding error; cancel; busy capture cannot queue unlimited jobs |
| S05 Review | Photo/crop, selected parameter/bin, “Indicative screening,” quality reasons, human override | AnalysisResult + local draft | Uncertain/model unavailable; no fake percentage; retake; manual override reason; timer invalid prevents assisted result |
| S06 Receipt | Source, record ID, saved time, next action, separate metadata/photo state | Durable SQLite sample/outbox | Local only; saved/synced; image not shared; never optimistic success before commit |
| S07 Queue | Pending/blocked counts, last attempt, Sync Now, details | Outbox + sync push/pull | Offline; backoff; sign-in needed; conflict; disk pressure; retry only eligible items |
| S08 Case board | Due/owner/status filters; compact table/list; counts with as_of | cases endpoint; 30s active refresh proposal | Loading skeleton; no cases; stale snapshot; request failure keeps old data labeled; keyboard filters |
| S09 Case detail | Next action banner; provenance; timeline; owner/due controls | case GET/commands; evidence access | 409 conflict diff; missing image; unauthorized; blocked closure; superseded sample warning |
| S10 Lab/retest review | Report metadata + private preview + verification checklist | lab-reports/verify; case commands | Malformed/unsafe upload; unit mismatch; wrong source; pending scan; unverified never labeled confirmed |
| S11 Reports/export | Denominator tooltips; source coverage; overdue/closure counts; export task | metrics/exports/jobs | Empty period; synthetic toggle; job progress/cancel/retry; download expires; no partial completed export |
| S12 Settings/support | Language, offline expiry, privacy mode, app/model/protocol versions, diagnostics | Local config + authorized policy | Pending records warning before logout; no casual clear-data button; invalid model rollback explained |

## Copy and uncertainty

Use: “Reading unclear. Move the reference card out of glare and retake.” / “Saved on this phone. Your supervisor has not received it yet.” / “This is a screening result for [parameter], not a complete water-safety assessment.”

For no_flag: “No review flag for this parameter under this protocol.” For research model: “Experimental suggestion—not validated for operational decisions.” Explain confidence as agreement with trained classes, not chemical certainty. Do not display a percentage before calibration is validated.

## Interaction and accessibility

Keyboard order follows visible hierarchy. Focus returns to the triggering control after dialogs; visible focus ring; error summary links to fields. Announce save/failure using polite live regions, but do not repeatedly announce countdown ticks. Screen reader labels include parameter, unit, state and action; photos have descriptions, not invented interpretations.

Web target WCAG2.2 AA; mobile apply equivalent contrast, target, text scaling and TalkBack tests. Permit paste/password managers; no memory puzzles or color-only tasks. Kit interpretation may intrinsically depend on color; manual fallback/reference assistance must not claim to solve color-vision accessibility without testing.

Animations: 120–180ms opacity/position transitions for step/state changes; no bouncing cards, decorative water particles or continuous shimmer. Respect prefers-reduced-motion and native reduce-motion setting; instant transitions retain progress text. Network/loading progress is real; unknown duration uses an honest busy state.

## Rendering and offline behavior

Virtualize long source/case lists; paginate server data. Decode thumbnails rather than full photos for rows; full image only on demand with bounded memory. Heavy image work off JS/UI thread; avoid passing base64 full images through React state. Cancel/ignore stale requests on navigation. Persist drafts at meaningful step boundaries, not every keystroke synchronously.

Prototype placeholders are labeled synthetic and live in demo-only fixtures. T18/T22 wire screens to real contracts; T34 verifies that disabling fixtures still permits complete real persistence/sync. A mock success toast is never backend integration.

