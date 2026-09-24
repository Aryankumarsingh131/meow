# Handoff — T46 closure-policy domain approval (DRAFT)

- Task: T46 / REQ-009, REQ-011, REQ-013. Owner A/domain + C. The agent carried the C half and drafted the A half; **the domain approval itself has not happened.**
- Status: **`[!]` blocked on a human domain reviewer.** The draft policy, the code that enforces it, and its regression tests exist. What T46 actually needs — a named reviewer's sign-off — does not. The project owner chose "draft only, marked pending" (2026-09-24).

## What was built

| File | Purpose |
|---|---|
| `docs/closure-policy-approval.md` | Draft policy v1: the five `close` evidence items, rules E1–E3, six open questions for the reviewer, and an **empty** sign-off block. Status line reads PENDING |
| `services/api/app/case_policy.py` | E1 enforced in `g_close`: an exemption reason under 20 non-whitespace characters is refused for every exemptable item |
| `tests/closure_policy_test.py` | 7 tests: E1 (trivial reasons refused for all three fields; a substantive one accepted **and stored on the closure event**), E2 (no safety-verdict column exists; closure records `policy_version`), E3 (correcting the relied-on report flags the closed case without reopening it; a superseded report stops counting as evidence), and a guard test that fails if the doc stops saying PENDING without the test being deliberately updated |
| `tests/communication_test.py` | Refactor only: `ClosureHarness` split out of `FullClosureTests` so T46's tests reuse the real-evidence setup without re-running T22's tests |

## Acceptance mapping

- **Exceptions explicit and authorized.** *Explicit:* met (E1, stored on the event). *Authorized:* **not met** — who may use which exemption is open question 1 in the draft, and no one with authority has answered it.
- **No blanket safe label.** Met by construction (E2) and pinned by a test.
- **Dependent disputed report triggers review.** Met (E3): T19's supersession already flagged `requires_rereview`; T46 adds end-to-end regression tests that go through a real closure first.
- **Verification: domain signoff and regression tests for approved exceptions.** Regression tests: done for the draft. Domain sign-off: **not done.**

## Verification actually run (2026-09-24)

- `python -m unittest tests.closure_policy_test tests.communication_test -v`: **17/17**.
- Full repo suite: **279 passed**, 11 skipped (`TEST_DATABASE_URL`-gated).

## What unblocks it

A reviewer with domain authority reads `docs/closure-policy-approval.md`, answers the six questions, and fills in the sign-off block. Any rule change then bumps `POLICY_VERSION`, and `PolicyIsDraftTests` is updated in the same change.
