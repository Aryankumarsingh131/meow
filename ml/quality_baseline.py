"""T10: deterministic capture-quality rules — reference implementation.

Turns a captured image + ROI into **versioned reason codes** and a
review/retake decision. It is deterministic: no model, no randomness, no
learned component. `modules/capture-native/android/Quality.kt` mirrors it.

## What this must never do

* **Never emit a bin, class, concentration or reading.** A quality verdict is
  about the *photograph*, not the water. `QualityOutcome` has no field that
  could hold one, and a test asserts that. This is acceptance criterion 3,
  "no fabricated class on rejection".
* **Never treat an unset threshold as a pass.** `protocol-schema.md` line 79
  is explicit: `null` means *not yet fitted*; the check is skipped and
  `THRESHOLD_UNSET` is recorded. It does not mean "unlimited".
* **Never guess where the reference card is.** Detection returns a typed
  state; "not found" and "found but unreadable" are different facts and stay
  different (see `ReferenceCardState`).

## Thresholds are PROVISIONAL

Every numeric threshold here was fitted from the synthetic fixtures in
`tests/quality-fixtures.json` by measuring known-good and known-bad images and
choosing a separating value. They are **provisional** and carry that label in
the output. T27 approves them against real data; nothing here is a validated
limit, and none of it is calibrated against any kit.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Literal, Sequence

# Bumped whenever a rule or threshold changes, so a stored observation can be
# traced to the exact rules that produced it.
QUALITY_RULES_VERSION = "quality-rules-v1"

# --- reference card: SYN-COLOR-001 -----------------------------------------
# jalsakshi-blueprint/docs/synthetic-demo-protocol.md. Printer, paper, lighting
# and camera all shift these, which is precisely why a tolerance exists and why
# a mismatch is DEMO_INVALID rather than a water result.
SYN_COLOR_001_SWATCHES: dict[str, tuple[int, int, int]] = {
    "SYN-A": (0x3B, 0x82, 0xF6),
    "SYN-B": (0x10, 0xB9, 0x81),
    "SYN-C": (0xF5, 0x9E, 0x0B),
    "SYN-D": (0xEF, 0x44, 0x44),
}

ReasonCode = Literal[
    "BLUR_SUSPECTED",
    "CLIPPING_EXCESSIVE",
    "GLARE_EXCESSIVE",
    "ROI_TOO_SMALL",
    "REFERENCE_CARD_NOT_DETECTED",
    "REFERENCE_CARD_UNREADABLE",
    "THRESHOLD_UNSET",
]

#: Provisional, fitted from the synthetic fixtures. NOT approved limits.
PROVISIONAL_THRESHOLDS = {
    "min_roi_pixels": 40,
    "max_blur_variance": None,      # filled by fit_thresholds()
    "max_clipped_fraction": None,
    "max_glare_fraction": None,
}


@dataclass(frozen=True)
class ReferenceCardState:
    """Typed reference-card outcome. Four distinct states, never a boolean.

    `not_detected` and `unreadable` are deliberately separate: the first means
    the card is absent or outside the frame (retake with the card), the second
    means it is there but glare/blur makes its swatches unmatchable (retake
    with different lighting). Collapsing them would tell the worker the wrong
    thing to do.
    """

    state: Literal["detected", "partially_occluded", "unreadable", "not_detected"]
    #: Swatches matched within tolerance. Never inferred — only counted.
    swatches_matched: int
    swatches_expected: int
    #: Mean per-channel distance for matched swatches; None when nothing matched.
    mean_distance: float | None


@dataclass(frozen=True)
class QualityMetrics:
    roi_pixel_count: int
    blur_variance: float
    clipped_fraction: float
    glare_fraction: float
    reference_card: ReferenceCardState


@dataclass(frozen=True)
class QualityOutcome:
    """Deterministic verdict.

    Note what is absent: no bin, no class, no reading, no concentration, no
    confidence. A rejected capture yields reason codes and nothing else.
    """

    decision: Literal["accept", "review", "retake"]
    reasons: tuple[ReasonCode, ...]
    metrics: QualityMetrics
    rules_version: str = QUALITY_RULES_VERSION
    thresholds_provisional: bool = True
    #: Checks skipped because their threshold is unset. Never counted as passes.
    skipped_checks: tuple[str, ...] = field(default_factory=tuple)


# --- metrics ---------------------------------------------------------------

Pixel = tuple[int, int, int]
Grid = Sequence[Sequence[Pixel]]


def _luma(p: Pixel) -> float:
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]


def blur_variance(grid: Grid) -> float:
    """Variance of the 4-neighbour Laplacian over luma.

    Low variance = few sharp edges = likely out of focus. This is a relative
    indicator, not a focus measurement in any physical unit.
    """
    h, w = len(grid), len(grid[0])
    if h < 3 or w < 3:
        return 0.0
    values: list[float] = []
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            lap = (
                4 * _luma(grid[y][x])
                - _luma(grid[y - 1][x])
                - _luma(grid[y + 1][x])
                - _luma(grid[y][x - 1])
                - _luma(grid[y][x + 1])
            )
            values.append(lap)
    if not values:
        return 0.0
    mean = sum(values) / len(values)
    return sum((v - mean) ** 2 for v in values) / len(values)


def clipped_fraction(grid: Grid) -> float:
    """Fraction of pixels with any channel at the extremes (0 or 255).

    Clipped channels have lost information irrecoverably; no amount of later
    processing can recover a colour that was saturated at capture.
    """
    total = 0
    clipped = 0
    for row in grid:
        for p in row:
            total += 1
            if any(c <= 0 or c >= 255 for c in p):
                clipped += 1
    return clipped / total if total else 0.0


def glare_fraction(grid: Grid) -> float:
    """Fraction of pixels that look like specular highlight.

    Bright AND desaturated together, not brightness alone — a legitimately
    bright yellow swatch is bright but strongly saturated, and must not be
    counted as glare.
    """
    total = 0
    glare = 0
    for row in grid:
        for p in row:
            total += 1
            mx, mn = max(p), min(p)
            saturation = 0.0 if mx == 0 else (mx - mn) / mx
            if _luma(p) >= 245 and saturation <= 0.10:
                glare += 1
    return glare / total if total else 0.0


def detect_reference_card(
    patches: dict[str, Pixel],
    tolerance: float = 60.0,
    unreadable_tolerance: float = 120.0,
) -> ReferenceCardState:
    """Classify the reference card from sampled swatch patches.

    `patches` maps swatch id -> mean colour sampled at that swatch's expected
    location. A caller that cannot locate the card passes `{}` — this function
    never invents a location, and an empty input yields `not_detected`.

    Tolerances are Euclidean RGB distance and are **provisional**: print, paper,
    lighting and camera all shift the printed colours
    (synthetic-demo-protocol.md), so these must be re-fitted against real
    printed cards before they mean anything.
    """
    if not patches:
        return ReferenceCardState("not_detected", 0, len(SYN_COLOR_001_SWATCHES), None)

    matched: list[float] = []
    near: list[float] = []
    for key, expected in SYN_COLOR_001_SWATCHES.items():
        got = patches.get(key)
        if got is None:
            continue
        dist = math.dist(expected, got)
        if dist <= tolerance:
            matched.append(dist)
        elif dist <= unreadable_tolerance:
            near.append(dist)

    expected_n = len(SYN_COLOR_001_SWATCHES)
    mean_dist = sum(matched) / len(matched) if matched else None

    if len(matched) == expected_n:
        return ReferenceCardState("detected", len(matched), expected_n, mean_dist)
    if matched and len(matched) < expected_n:
        # Some swatches match well, the rest are missing or wrong: the card is
        # there but something covers part of it.
        return ReferenceCardState("partially_occluded", len(matched), expected_n, mean_dist)
    if near:
        # Everything is in roughly the right place but nothing matches within
        # tolerance - washed out or smeared, i.e. present but unreadable.
        return ReferenceCardState("unreadable", 0, expected_n, None)
    return ReferenceCardState("not_detected", 0, expected_n, None)


def compute_metrics(grid: Grid, patches: dict[str, Pixel] | None = None) -> QualityMetrics:
    return QualityMetrics(
        roi_pixel_count=sum(len(r) for r in grid),
        blur_variance=blur_variance(grid),
        clipped_fraction=clipped_fraction(grid),
        glare_fraction=glare_fraction(grid),
        reference_card=detect_reference_card(patches or {}),
    )


# --- rules -----------------------------------------------------------------


def evaluate(
    metrics: QualityMetrics,
    policy: dict,
    require_reference_card: bool = True,
) -> QualityOutcome:
    """Apply the protocol's quality policy to measured metrics.

    A `None` threshold is **skipped and recorded**, never passed:
    protocol-schema.md line 79.
    """
    reasons: list[ReasonCode] = []
    skipped: list[str] = []

    min_roi = policy.get("min_roi_pixels")
    if min_roi is None:
        skipped.append("min_roi_pixels")
    elif metrics.roi_pixel_count < min_roi:
        reasons.append("ROI_TOO_SMALL")

    max_blur = policy.get("max_blur_variance")
    if max_blur is None:
        skipped.append("max_blur_variance")
    elif metrics.blur_variance < max_blur:
        # Lower variance means blurrier, so the threshold is a FLOOR.
        reasons.append("BLUR_SUSPECTED")

    max_clip = policy.get("max_clipped_fraction")
    if max_clip is None:
        skipped.append("max_clipped_fraction")
    elif metrics.clipped_fraction > max_clip:
        reasons.append("CLIPPING_EXCESSIVE")

    max_glare = policy.get("max_glare_fraction")
    if max_glare is None:
        skipped.append("max_glare_fraction")
    elif metrics.glare_fraction > max_glare:
        reasons.append("GLARE_EXCESSIVE")

    if require_reference_card:
        state = metrics.reference_card.state
        if state == "not_detected":
            reasons.append("REFERENCE_CARD_NOT_DETECTED")
        elif state in ("unreadable", "partially_occluded"):
            reasons.append("REFERENCE_CARD_UNREADABLE")

    if skipped:
        reasons.append("THRESHOLD_UNSET")

    # Decision. A skipped threshold can never produce `accept`: an unfitted
    # check is an unknown, and an unknown is not a pass.
    hard = {"ROI_TOO_SMALL", "REFERENCE_CARD_NOT_DETECTED", "REFERENCE_CARD_UNREADABLE"}
    if any(r in hard for r in reasons):
        decision: Literal["accept", "review", "retake"] = "retake"
    elif reasons:
        decision = "review"
    else:
        decision = "accept"

    return QualityOutcome(
        decision=decision,
        reasons=tuple(reasons),
        metrics=metrics,
        skipped_checks=tuple(skipped),
    )


# --- provisional threshold fitting ----------------------------------------


def fit_thresholds(good: list[QualityMetrics], bad: dict[str, list[QualityMetrics]]) -> dict:
    """Fit separating thresholds from measured fixtures.

    Deliberately simple and explainable: take the midpoint between the worst
    acceptable value and the best unacceptable one. A fitted midpoint on a
    handful of synthetic fixtures is **provisional**, and is labelled as such
    everywhere it appears.
    """

    def midpoint(good_vals: list[float], bad_vals: list[float], floor: bool) -> float | None:
        if not good_vals or not bad_vals:
            return None
        if floor:  # good is HIGH (sharp), bad is LOW (blurry)
            return round((min(good_vals) + max(bad_vals)) / 2, 4)
        return round((max(good_vals) + min(bad_vals)) / 2, 6)

    return {
        "min_roi_pixels": 40,
        "max_blur_variance": midpoint(
            [m.blur_variance for m in good],
            [m.blur_variance for m in bad.get("blur", [])],
            floor=True,
        ),
        "max_clipped_fraction": midpoint(
            [m.clipped_fraction for m in good],
            [m.clipped_fraction for m in bad.get("clipping", [])],
            floor=False,
        ),
        "max_glare_fraction": midpoint(
            [m.glare_fraction for m in good],
            [m.glare_fraction for m in bad.get("glare", [])],
            floor=False,
        ),
    }


def outcome_to_dict(o: QualityOutcome) -> dict:
    return {
        "decision": o.decision,
        "reasons": list(o.reasons),
        "rules_version": o.rules_version,
        "thresholds_provisional": o.thresholds_provisional,
        "skipped_checks": list(o.skipped_checks),
        "metrics": {
            "roi_pixel_count": o.metrics.roi_pixel_count,
            "blur_variance": round(o.metrics.blur_variance, 4),
            "clipped_fraction": round(o.metrics.clipped_fraction, 6),
            "glare_fraction": round(o.metrics.glare_fraction, 6),
            "reference_card": {
                "state": o.metrics.reference_card.state,
                "swatches_matched": o.metrics.reference_card.swatches_matched,
                "swatches_expected": o.metrics.reference_card.swatches_expected,
                "mean_distance": (
                    round(o.metrics.reference_card.mean_distance, 3)
                    if o.metrics.reference_card.mean_distance is not None
                    else None
                ),
            },
        },
    }


if __name__ == "__main__":  # pragma: no cover
    print(json.dumps({"rules_version": QUALITY_RULES_VERSION,
                      "swatches": SYN_COLOR_001_SWATCHES}, indent=2))
