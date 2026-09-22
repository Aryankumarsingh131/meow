# Handoff — integration of the sibling `meow` repository

Date: 2026-09-22. Branch: `integrate-meow`. Performed on explicit user request
("take the missing parts after forking and integrate both").

## What these two repositories actually are

`meow` and `meow1` are **siblings, not a fork**. `git merge-base` reports **no
common ancestor** — they were started separately from the same
`jalsakshi-blueprint` package. A plain `git merge --allow-unrelated-histories`
would have produced conflicts across ~40 files, so the integration was done
deliberately, file by file, with the conflicting files merged by hand.

`meow` is added as a git remote so the provenance is traceable:

```
git remote -v
meow    https://github.com/Aryankumarsingh131/meow.git
origin  https://github.com/Aryankumarsingh131/meow1.git
```

They implemented **different slices of the same blueprint**, so the two are
genuinely complementary rather than competing:

| | `meow` | `meow1` (this repo) |
|---|---|---|
| Service skeleton | health, config validation, error contract | — |
| Synthetic demo workflow | worker/supervisor/about, camera, on-device ONNX probe, offline sync | — |
| v1 contracts (T05) | — | schemas, frozen `openapi.json`, generated client |
| Authorization (T06) | — | OIDC verification, PKCE client |
| Source catalogue (T07) | — | tenant-scoped catalogue, QR safety, history staleness |
| Kit protocol (T08) | — | read-window timing, clock integrity, kit eligibility |
| Capture pipeline (T04) | — | JS/Python feature parity, golden vectors |
| Android toolchain | `patch-onnxruntime.mjs`, plugin config | emulator, SDK, JDK 17, screenshots |

## Blueprint comparison

35 of 39 blueprint documents are **byte-identical** once line endings are
normalised. Only four genuinely differ, and all four are `meow` updating
status text to reflect that implementation was authorised on 22 September
2026 (`README.md`, `implementation-plan.md`, `AGENTS.md`,
`docs/agent-workflow/current-state.md`).

**Those four were deliberately NOT taken.** `jalsakshi-blueprint/` is a
reference package this repo does not edit, and `current-state.md` inside it
describes `meow`'s work, not this repo's. Two genuinely new blueprint
documents *were* taken because they are additive reference material:
`docs/input.md` and `docs/synthetic-demo-protocol.md`.

## Integrated — additive (no conflict)

| From `meow` | Why it matters |
|---|---|
| `apps/mobile/scripts/patch-onnxruntime.mjs` | **Resolves a blocker this repo recorded as open.** See below |
| `apps/mobile/metro.config.js` | Registers `.onnx` as a Metro asset extension |
| `apps/mobile/src/demo-store.ts` | SQLite-backed offline store for the demo workflow |
| `apps/mobile/src/sync-state.ts` + `.test.mjs` | Metadata-vs-photo sync state ordering |
| `apps/mobile/assets/identity.onnx`, `assets/demo/syn-*.png` | Probe model and controlled fixtures |
| `apps/mobile/make_probe_model.py` | Generates the probe model |
| `services/api/app/{config,errors,demo}.py` | Config validation, problem+json errors, synthetic demo API |
| `services/api/{pyproject.toml,uv.lock}`, `tests/` | Packaging and 12 API tests |
| `jalsakshi-blueprint/docs/{input,synthetic-demo-protocol}.md` | Reference docs |
| `jalsakshi-blueprint/scripts/create-synthetic-demo-card.py`, `output/pdf/…` | Printable reference card |
| `.gitattributes`, `.gitignore` | `meow`'s `.gitignore` is a strict superset — taken wholesale |

## Integrated — merged by hand (conflicts)

### `services/api/app/main.py` — and a freeze that had to be protected

`meow`'s `main.py` is a real service; this repo's was T05's contract-only stub
that **generates the frozen `contracts/openapi.json`**.

Naively taking `meow`'s `main.py` would have silently broken the T05 freeze:
the next regeneration would have added `/health/live`, `/health/ready` and all
`/demo/v1/*` paths to a document that is explicitly frozen.

Resolution: this repo's stub moved to **`services/api/app/contracts_app.py`**
(contract surface only), and `main.py` is now `meow`'s real service. The
regeneration command in `docs/agent-workflow/handoff-T05.md` was updated, and
regeneration was **re-run and verified byte-identical** — the freeze is intact.

### Import convention

`meow` used absolute `from app.x import …` (rooted at `services/api/`); this
repo uses relative imports and runs tests from the repo root as
`services.api.app.*`. `meow`'s modules were converted to relative imports and
its tests repathed to the full package. All 12 of its API tests pass unchanged
in behaviour.

### `apps/mobile/App.tsx`

`meow`'s root app became `apps/mobile/src/demo-workflow.tsx`, exporting
`DemoWorkflowScreen` (only the default export and asset paths changed). The
new root is a tab shell hosting **both** it and this repo's T07/T08 screens.
The "fictional fixture data" banner shows only on the T07/T08 tabs, since the
demo workflow carries its own "Not water analysis" disclaimer.

### `apps/mobile/package.json` and `app.config.ts`

Union of dependencies. This repo's `app.config.ts` (typed) was kept over
`meow`'s `app.json`, with `meow`'s plugin block merged in. Android package id
stays `org.jalsakshi.mobile`. `onnxruntime-react-native` is now pinned to
exactly `1.24.3` because the patch script version-guards on it.

**This edits T03's declared files (role B).** Done under explicit user
instruction to integrate; flagged here for role B's awareness.

## Blocker resolved: onnxruntime vs Gradle 9

This repo's T08 handoff recorded an unresolved blocker: `onnxruntime-react-native@1.24.3`
calls `VersionNumber.parse()`, removed in Gradle 9, and my local workaround
was a crude `if (false)` edit inside gitignored `node_modules` that would be
**lost on the next `npm install`**.

`meow` had already solved this properly. Its `patch-onnxruntime.mjs` is
strictly better than my hack: it **version-guards** (refuses to run against
anything but 1.24.3), **preserves the real semantics** instead of disabling the
branch, **refuses to patch unrecognised source**, and also removes a stale
`unimodule.json` autolinking marker. Wired as a `postinstall` script, it now
**survives `npm install`**.

Pleasingly, the script's safety check fired during integration: my leftover
`if (false)` edit made it refuse with *"ONNX Gradle source changed; refusing an
unknown patch."* I restored the vendor original and re-ran, and the proper
patch applied. That is the guard working exactly as designed.

## Also unblocked

T06 and T07 both recorded dependencies as blocked pending a role-B lockfile
change. `meow`'s `package.json` already carried them, so they are now present:
**`expo-crypto`** (T06's PKCE S256 — Hermes has no `crypto.subtle`),
**`expo-camera`** (T07's QR scanning), plus `expo-sqlite`, `expo-file-system`,
`expo-asset`, `expo-device`, `expo-build-properties`.

The T06/T07 modules are **not yet rewired** to use them — that is follow-up
work, not part of this integration.

## Verification — exact commands and results

Run from the repo root unless noted. Node v24.19.0, Python 3.13.7.

```
# this repo
node tests/protocol.test.ts                            -> 39/39 passed
node tests/sources_client.test.ts                      -> 22/22 passed
node tests/auth_client.test.ts                         -> 12/12 passed
node tests/contracts.test.ts                           -> ALL CHECKS PASSED
python -m unittest tests.sources_test tests.auth_test \
       services.api.app.tests.test_schemas             -> Ran 102 tests ... OK

# from meow, under this repo's layout
python -m pytest services/api/tests -q                 -> 12 passed
cd apps/mobile && npm run test:demo                    -> 1 pass, 0 fail

# typechecks
npx tsc --noEmit                                       -> 0 errors
cd apps/mobile && npx tsc --noEmit -p tsconfig.json     -> 0 errors

# T05 freeze after the contracts_app rename
regenerate contracts/openapi.json                      -> byte-identical

# integrated Android build
cd apps/mobile && npx expo run:android                 -> BUILD SUCCESSFUL,
                                                          APK installed,
                                                          app running
```

**Total: 183 tests from this repo + 13 from `meow`, all passing.** `pytest` was
installed to run `meow`'s API tests.

Evidence: `docs/evidence/screenshots/integrated-01-demo-workflow.png` (meow's
synthetic field notebook running inside the merged app) and
`integrated-02-t07-sources.png` (this repo's T07 screen in the same build).

## One defect found by running it

The first integrated launch failed at runtime with *"Unable to resolve module
../assets/identity.onnx"*. Cause: the Metro dev server still running was
started **before** `metro.config.js` was added, so `.onnx` was not yet a
registered asset extension. Restarting Metro with `--clear` fixed it. Worth
recording because the build succeeded and only the running app revealed it.

## Not done / still open

- **The four differing blueprint documents were not merged** (see above).
- **T06/T07 are not rewired** onto the now-available `expo-crypto` /
  `expo-camera`.
- **`meow`'s `demo.py` router is not covered by this repo's contract freeze.**
  It lives under `/demo/v1` and is mounted only when
  `environment=development` **and** `tenant_data_mode=synthetic`, so it cannot
  reach production by configuration — but it is not part of the v1 contract.
- **The root shell remains a demo harness.** It is not real navigation, and
  T07/T08 tabs still render fictional fixtures.
- **No domain validation changed.** T01 is still a fictional template; `meow`'s
  workflow is explicitly synthetic and says so on screen. Nothing here brings
  the project closer to a validated real kit.
- This work is on branch `integrate-meow`, **not merged to `main`** and not
  pushed.
