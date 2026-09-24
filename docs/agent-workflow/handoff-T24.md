# Handoff — T24 leakage-safe evaluation

- Task: T24 / REQ-019, REQ-027. Owner B/ML; carried by the agent.
- Status: **`[~]` built and verified on the synthetic set (T23).** Outstanding: rerun on real data.

## What was built

| File | Purpose |
|---|---|
| `ml/splits.py` | Assigns **preparations**, never captures, to train/val/test (half/quarter/quarter per class × domain). Frozen in `ml/data/splits.v1.json` with the manifest digest; `assert_frozen` refuses any drift or hand edit |
| `ml/evaluate.py` | Metrics with denominators: record accuracy with a cluster bootstrap over preparations, preparation accuracy with a Wilson interval, per class and per domain, coverage for abstentions. The **test split is locked** (`LockedSplitError`) unless the release evaluation opens it |
| `ml/tests/test_splits.py` | 15 tests, including the **deliberate failure**: a preparation copied into another split, and one renamed with a new id, both raise `LeakageError` |
| `ml/reports/baseline.md` | Nearest fixture colour (the app's rule): val 159/160; 32/32 preparations |

## Verification (2026-09-24)

- `python -m unittest discover -s ml/tests -v`: 15/15 split and metric tests.
- Mutation: disabling the overlap check fails 2 tests; restored.

## Note

32 preparations at 100% only establish ≥ 89.3% (Wilson). The reports say so rather than quoting 100%.
