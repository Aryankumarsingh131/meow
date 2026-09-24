# Rollback and old-client compatibility evidence (T37)

Date 2026-09-25. Procedure: infra/rollback.md.

## Rehearsal: roll back and forward on one database with a queued outbox

`python tests/e2e/rollback_rehearsal.py <old-commit>`: local synthetic dev
stack, a git worktree for the old release, the same SQLite database and signing
key across all three phases.

### To `67dbf71` (T34, before T35's migration lock and T47's deletion_ledger)

| Check | Result |
|---|---|
| New release accepts event A | PASS |
| Old release starts on the newer database (tables it does not know) | PASS |
| Old release: replay of A is `duplicate` | PASS |
| Old release: queued event B `accepted` | PASS |
| Old release has no `/models/disabled` (404); the phone keeps its last list | PASS |
| Roll forward: replay of B is `duplicate` | PASS |
| A and B each once in the changefeed, in commit order | PASS |
| Changefeed sequence has no gap | PASS |

**8/8.**

### Failure boundary: to `8a2c3ef` (just before T14's changefeed)

7/8: the old release **accepts B but writes no changefeed entry**, so phones
never pull B. There is no error, which makes the loss silent. This sets the
rollback floor at `1052e76` (infra/rollback.md).

The staging database already holds one such sample (docs/restore-evidence.md):
a sample with no changefeed entry, most likely written by a deploy older than
T14.

## Destructive migrations

`grep -niE "DROP|ALTER|RENAME|DELETE FROM" services/api/migrations/*.py`
matches only a comment ("No `DROP` and no hard delete"). There are no
down-migrations.

## Old app builds

| Client | Pushes | Result |
|---|---|---|
| Every build so far (v2, v2.2, this commit) | `sample.create` / `sample.correct`, `schema_version: 1` | Accepted by every release since T13; replays are duplicates |
| Future schema change | must keep accepting `schema_version: 1` until no phone sends it | Rule, not yet tested (no v2 schema exists) |

## Unsafe model switch-off

- Server: `GET /models/disabled`, from `JALSAKSHI_DISABLED_MODELS`
  (tests/provider_test.py: public, normalised, empty by default).
- App: `apps/mobile/src/analysis/modelSwitch.ts`, checked on every analysis;
  `tests/model-switch.test.ts` checks that the list switches the model off,
  stays in force offline and after server errors or malformed answers, that
  the server can re-enable the model, and that an existing model problem is
  never masked.
- Not yet on a phone: needs the next APK build. Builds v2.2 and older ignore
  the switch (infra/rollback.md, Limit).

## Not done

- A rollback on Render itself was not performed. The rehearsal ran the same
  code locally, which is safer than rolling back the live staging service.
