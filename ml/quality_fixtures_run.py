"""T10 verification runner: generate fixtures, measure, fit, record.

Builds synthetic ROI fixtures covering every acceptance case (glare, blur,
clipping, reference-card detected/absent/occluded/unreadable), measures them
with `quality_baseline`, fits the provisional thresholds from the MEASURED
values, re-evaluates every fixture against the fitted policy, and writes
`tests/quality-fixtures.json`.

Each fixture asserts BOTH the decision and the reference-card state. Checking
only the decision was not enough: a fixture meant to be "present but
unreadable" reported "not detected" while still returning `retake`, and the
test passed anyway. Those two states demand different actions from the worker
(fix the lighting vs put the card in frame), so both are asserted.

**All fixtures are SYNTHETIC.** They exercise the deterministic rules; they
are not photographs of a real kit, and passing them is not validation of any
real capture.

Run:  python ml/quality_fixtures_run.py
"""

from __future__ import annotations

import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from quality_baseline import (
    PROVISIONAL_THRESHOLDS,
    QUALITY_RULES_VERSION,
    SYN_COLOR_001_SWATCHES,
    compute_metrics,
    evaluate,
    fit_thresholds,
    outcome_to_dict,
)

W = H = 24
Pixel = tuple[int, int, int]
ALL = ["SYN-A", "SYN-B", "SYN-C", "SYN-D"]
QUADS = {"SYN-A": (0, 0), "SYN-B": (0, 1), "SYN-C": (1, 0), "SYN-D": (1, 1)}


def _clamp(v: float) -> int:
    return max(0, min(255, round(v)))


def sharp_card(seed: int = 7) -> list[list[Pixel]]:
    """Well-exposed, in-focus ROI: four swatch quadrants plus fine texture.

    The texture matters. A perfectly flat colour block has near-zero Laplacian
    variance and would be indistinguishable from a blurred image.
    """
    rng = random.Random(seed)
    order = [SYN_COLOR_001_SWATCHES[k] for k in ALL]
    grid: list[list[Pixel]] = []
    for y in range(H):
        row: list[Pixel] = []
        for x in range(W):
            idx = (0 if y < H // 2 else 2) + (0 if x < W // 2 else 1)
            base = order[idx]
            edge = 18 if (x // 2 + y // 2) % 2 == 0 else -18
            n = rng.randint(-3, 3)
            row.append(tuple(_clamp(c + edge + n) for c in base))  # type: ignore[arg-type]
        grid.append(row)
    return grid


def low_texture_card() -> list[list[Pixel]]:
    """In-focus flat swatches that the provisional blur heuristic rejects.

    This is a deliberate false-reject example for T23: Laplacian variance
    measures texture, not focus, so a sharp low-texture print can look blurry
    to the rule.
    """
    order = [SYN_COLOR_001_SWATCHES[k] for k in ALL]
    return [
        [order[(0 if y < H // 2 else 2) + (0 if x < W // 2 else 1)] for x in range(W)]
        for y in range(H)
    ]


def blurred(grid: list[list[Pixel]], passes: int = 6) -> list[list[Pixel]]:
    """Repeated box blur: destroys high-frequency detail, as defocus does."""
    cur = [row[:] for row in grid]
    for _ in range(passes):
        nxt = [row[:] for row in cur]
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                nxt[y][x] = tuple(  # type: ignore[assignment]
                    sum(cur[y + dy][x + dx][c] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) // 9
                    for c in range(3)
                )
        cur = nxt
    return cur


def with_glare(grid: list[list[Pixel]], fraction: float) -> list[list[Pixel]]:
    """Specular highlight: bright AND desaturated (near-white)."""
    out = [row[:] for row in grid]
    for i in range(int(W * H * fraction)):
        y, x = divmod(i, W)
        if y < H:
            out[y][x] = (252, 252, 252)
    return out


def with_clipping(grid: list[list[Pixel]], fraction: float) -> list[list[Pixel]]:
    """Hard 0/255: information destroyed at capture, unrecoverable later."""
    out = [row[:] for row in grid]
    for i in range(int(W * H * fraction)):
        y, x = divmod(i, W)
        if y < H:
            out[y][x] = (255, 255, 0) if i % 2 == 0 else (0, 0, 0)
    return out


def patches_from(grid: list[list[Pixel]], keys: list[str]) -> dict[str, Pixel]:
    """Mean colour at each swatch's expected quadrant.

    Only the requested swatches are returned; omitting one models occlusion.
    Nothing is inferred for a missing swatch.
    """
    out: dict[str, Pixel] = {}
    for k in keys:
        qy, qx = QUADS[k]
        acc = [0, 0, 0]
        cnt = 0
        for y in range(qy * H // 2, (qy + 1) * H // 2):
            for x in range(qx * W // 2, (qx + 1) * W // 2):
                for c in range(3):
                    acc[c] += grid[y][x][c]
                cnt += 1
        out[k] = tuple(a // cnt for a in acc)  # type: ignore[assignment]
    return out


def wash(c: Pixel, k: float = 0.40) -> Pixel:
    """Blend toward white.

    k is tuned so the result lands BETWEEN the match tolerance and the
    unreadable tolerance, which is what makes `unreadable` a genuinely
    exercised state. An earlier k=0.55 washed so hard the fixture fell through
    to `not_detected` while still returning `retake` - the decision looked
    right and the state was wrong.
    """
    return tuple(_clamp(v + (255 - v) * k) for v in c)  # type: ignore[return-value]


def build_fixtures():
    """(name, grid, patches, expected decision, description, reference state, known good)"""
    good = sharp_card()
    low_texture = low_texture_card()
    washed_grid = [[wash(SYN_COLOR_001_SWATCHES["SYN-A"])] * W for _ in range(H)]
    return [
        ("good_sharp_card_present", good, patches_from(good, ALL), "accept",
         "Well-exposed, in-focus, all four swatches present.", "detected", True),
        ("known_good_low_texture_false_reject", low_texture, patches_from(low_texture, ALL),
         "review", ("In-focus flat swatches rejected by the provisional blur heuristic; "
                    "recorded for T23 because Laplacian variance measures texture, not focus."),
         "detected", True),
        ("reference_absent", good, {}, "retake",
         "Card not in frame. Caller supplied no patches; nothing is guessed.", "not_detected", False),
        ("reference_partially_occluded", good, patches_from(good, ["SYN-A", "SYN-B"]), "retake",
         "Two swatches visible, two covered.", "partially_occluded", False),
        ("reference_unreadable_washed", washed_grid,
         {k: wash(v) for k, v in SYN_COLOR_001_SWATCHES.items()}, "retake",
         ("All four swatches in place but washed beyond the match tolerance: "
          "present-but-unreadable, a DIFFERENT fact from absent."), "unreadable", False),
        ("blur_defocused", blurred(good), patches_from(good, ALL), "review",
         "Same scene, defocused.", "detected", False),
        ("glare_specular_30pct", with_glare(good, 0.30), patches_from(good, ALL), "review",
         "30% of the ROI is specular highlight.", "detected", False),
        ("clipping_30pct", with_clipping(good, 0.30), patches_from(good, ALL), "review",
         "30% of the ROI is clipped to 0/255.", "detected", False),
    ]


def main() -> None:
    cases = build_fixtures()
    measured = {name: compute_metrics(g, p) for name, g, p, _, _, _, _ in cases}

    fitted = fit_thresholds(
        [measured["good_sharp_card_present"]],
        {
            "blur": [measured["blur_defocused"]],
            "glare": [measured["glare_specular_30pct"]],
            "clipping": [measured["clipping_30pct"]],
        },
    )

    results: list[dict] = []
    mismatches: list[dict] = []
    false_rejects: list[dict] = []

    for name, _g, _p, expected, description, expected_ref, known_good in cases:
        outcome = evaluate(measured[name], fitted, require_reference_card=True)
        actual_ref = outcome.metrics.reference_card.state
        ok_decision = outcome.decision == expected
        ok_ref = actual_ref == expected_ref
        if not ok_decision:
            mismatches.append({"fixture": name, "field": "decision",
                               "expected": expected, "actual": outcome.decision})
        if not ok_ref:
            mismatches.append({"fixture": name, "field": "reference_state",
                               "expected": expected_ref, "actual": actual_ref})
        if known_good and outcome.decision != "accept":
            false_rejects.append({
                "fixture": name, "expected": expected, "actual": outcome.decision,
                "reasons": list(outcome.reasons),
                "why_it_matters": "A good capture was rejected. False-reject sample for T23.",
            })
        results.append({
            "fixture": name,
            "description": description,
            "known_good": known_good,
            "expected_decision": expected,
            "expected_reference_state": expected_ref,
            "actual": outcome_to_dict(outcome),
            "matches_expectation": ok_decision and ok_ref,
        })
        flag = "ok  " if (ok_decision and ok_ref) else "FAIL"
        print(f"  {flag} {name:32s} -> {outcome.decision:7s} "
              f"ref={actual_ref:19s} {list(outcome.reasons)}")

    unset = evaluate(measured["good_sharp_card_present"], PROVISIONAL_THRESHOLDS,
                     require_reference_card=True)
    print(f"\n  unset-threshold policy on a GOOD image -> {unset.decision} {list(unset.reasons)}")
    if unset.decision == "accept":
        mismatches.append({"fixture": "unset_policy", "field": "decision",
                           "expected": "must not accept", "actual": "accept"})
    if not false_rejects:
        mismatches.append({
            "fixture": "false_reject_record",
            "field": "coverage",
            "expected": "at least one known-good limitation recorded for T23",
            "actual": "none",
        })

    doc = {
        "_status": "SYNTHETIC FIXTURES. These exercise the deterministic quality rules. They are "
                   "not photographs of a real kit, and passing them is not validation of "
                   "real-world capture quality.",
        "_no_calibration_claim": "No value here is a water-quality measurement. Quality rules "
                                 "judge the PHOTOGRAPH, never the water. A rejected capture "
                                 "yields reason codes and no class, bin or reading.",
        "rules_version": QUALITY_RULES_VERSION,
        "generated_by": "python ml/quality_fixtures_run.py",
        "reference_card": {
            "protocol": "SYN-COLOR-001",
            "source": "jalsakshi-blueprint/docs/synthetic-demo-protocol.md",
            "swatches": {k: list(v) for k, v in SYN_COLOR_001_SWATCHES.items()},
            "states": ["detected", "partially_occluded", "unreadable", "not_detected"],
        },
        "thresholds": {
            "status": "PROVISIONAL - fitted from the synthetic fixtures below by taking the "
                      "midpoint between the worst good value and the best bad value. These are "
                      "NOT approved limits. T27 approves against real data.",
            "fitted": fitted,
            "unset_policy_behaviour": {
                "decision_on_a_good_image": unset.decision,
                "reasons": list(unset.reasons),
                "skipped_checks": list(unset.skipped_checks),
                "rule": "protocol-schema.md line 79 - a null threshold is skipped and recorded "
                        "as THRESHOLD_UNSET; it must never silently pass as if it succeeded.",
            },
        },
        "fixtures": results,
        "false_rejects_for_T23": false_rejects,
        "false_reject_note": "Synthetic examples expose rule limitations but cannot estimate a "
                             "real false-reject rate; T23 must collect real captures.",
        "mismatches": mismatches,
    }
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "tests", "quality-fixtures.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")

    print(f"\nfitted (provisional): {json.dumps(fitted)}")
    print(f"mismatches: {len(mismatches)}   false-rejects recorded: {len(false_rejects)}")
    print(f"wrote {out}")
    raise SystemExit(1 if mismatches else 0)


if __name__ == "__main__":
    main()
