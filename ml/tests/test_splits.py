"""T24: leakage-safe splits and the locked test split.

Run from the repo root: python -m unittest discover -s ml/tests -v
"""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from ml import evaluate, feasibility_set, splits


class SplitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = feasibility_set.load()
        cls.assignment = splits.assert_frozen(cls.manifest)
        cls.by_split = splits.split_records(cls.manifest, cls.assignment)

    def test_the_frozen_file_re_derives_from_the_manifest(self) -> None:
        self.assertEqual(splits.assign(self.manifest), self.assignment)

    def test_the_real_splits_are_disjoint(self) -> None:
        splits.check_disjoint(self.by_split)

    def test_a_preparation_duplicated_into_another_split_fails(self) -> None:
        """The deliberate failure the task card asks for."""
        leaked = copy.deepcopy(self.by_split)
        leaked["test"].append(copy.deepcopy(leaked["train"][0]))
        with self.assertRaisesRegex(splits.LeakageError, "appears in both train and test"):
            splits.check_disjoint(leaked)

    def test_a_preparation_renamed_into_another_split_fails(self) -> None:
        """Same physical preparation under a new group_id and record_id is still a leak."""
        leaked = copy.deepcopy(self.by_split)
        clone = copy.deepcopy(leaked["train"][0])
        clone["group_id"], clone["record_id"] = "syn-prep-9999", "00000000-0000-4000-8000-000000000000"
        leaked["val"].append(clone)
        with self.assertRaisesRegex(splits.LeakageError, "preparation .* appears in both train and val"):
            splits.check_disjoint(leaked)

    def test_a_group_mixing_labels_fails(self) -> None:
        broken = copy.deepcopy(self.by_split)
        broken["train"][1]["label"] = "bin_3" if broken["train"][1]["label"] != "bin_3" else "bin_0"
        with self.assertRaisesRegex(splits.LeakageError, "mixes labels or domains"):
            splits.check_disjoint(broken)

    def test_every_capture_of_a_preparation_shares_one_split(self) -> None:
        seen: dict[str, set[str]] = {}
        for split, records in self.by_split.items():
            for r in records:
                seen.setdefault(r["group_id"], set()).add(split)
        self.assertTrue(all(len(s) == 1 for s in seen.values()))

    def test_each_class_and_domain_is_balanced_across_splits(self) -> None:
        counts = Counter((self.assignment[g], r["label"], r["domain"])
                         for g, r in {r["group_id"]: r for r in self.manifest["records"]}.items())
        for (split, _, _), n in counts.items():
            self.assertEqual(n, {"train": 4, "val": 2, "test": 2}[split])

    def test_the_salt_decides_the_split(self) -> None:
        self.assertNotEqual(splits.assign(self.manifest, salt="another-salt"), self.assignment)

    def test_a_changed_manifest_breaks_the_freeze(self) -> None:
        changed = copy.deepcopy(self.manifest)
        changed["records"][0]["features"]["median_r"] += 1
        with self.assertRaisesRegex(splits.LeakageError, "manifest changed"):
            splits.assert_frozen(changed)

    def test_a_hand_edited_assignment_breaks_the_freeze(self) -> None:
        frozen = splits.load_frozen()
        group = next(g for g, s in frozen["assignment"].items() if s == "test")
        frozen["assignment"][group] = "train"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "splits.json"
            path.write_text(json.dumps(frozen), encoding="utf-8")
            with self.assertRaisesRegex(splits.LeakageError, "does not re-derive"):
                splits.assert_frozen(self.manifest, path)


class LockedTestSplitTests(unittest.TestCase):
    def test_the_test_split_is_locked_by_default(self) -> None:
        with self.assertRaises(evaluate.LockedSplitError):
            evaluate.records("test")

    def test_release_evaluation_can_open_it_explicitly(self) -> None:
        self.assertEqual(len(evaluate.records("test", allow_locked_test=True)), 160)


class MetricTests(unittest.TestCase):
    def test_wilson_stays_honest_at_one_hundred_percent(self) -> None:
        low, high = evaluate.wilson(32, 32)
        self.assertEqual(high, 1.0)
        self.assertLess(low, 0.9)

    def test_abstentions_reduce_coverage_not_accuracy(self) -> None:
        recs = [{"label": "a", "group_id": f"g{i}", "domain": "d"} for i in range(4)]
        m = evaluate.metrics(recs, ["a", None, "a", "b"])
        self.assertEqual((m["answered"], m["correct"]), (3, 2))
        self.assertAlmostEqual(m["coverage"], 0.75)
        self.assertAlmostEqual(m["accuracy"], 2 / 3)

    def test_the_baseline_matches_the_app_rule_including_ties(self) -> None:
        classes = [{"key": "bin_0", "fixture_rgb": [0, 0, 0]}, {"key": "bin_1", "fixture_rgb": [2, 0, 0]}]
        predict = evaluate.nearest_reference(classes)
        self.assertEqual(predict(evaluate.np.array([[1.0, 0, 0], [1.6, 0, 0]])), ["bin_0", "bin_1"])


if __name__ == "__main__":
    unittest.main()
