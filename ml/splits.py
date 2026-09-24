"""T24: grouped, frozen train/val/test splits.

The unit of assignment is the preparation (`group_id`), never the capture:
every capture of a preparation lands in the same split, so no derivative of a
test preparation is ever trained on. Within each (class, domain) stratum,
preparations are ordered by sha256(salt:group_id) and cut half / quarter /
quarter into train / val / test, so every split keeps the same balance.

The assignment is FROZEN in ml/data/splits.v1.json together with the digest of
the manifest it was made for. assert_frozen() re-derives it and refuses any
drift, so a split cannot be quietly redrawn after test results are seen.

    python -m ml.splits           # (re)freeze - only when the manifest changes
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from pathlib import Path

from ml import feasibility_set

SPLITS_PATH = feasibility_set.ROOT / "ml" / "data" / "splits.v1.json"
SALT = "jalsakshi-splits-v1"
SPLITS = ("train", "val", "test")


class LeakageError(AssertionError):
    pass


def assign(manifest: dict, salt: str = SALT) -> dict[str, str]:
    strata: dict[tuple[str, str], set[str]] = defaultdict(set)
    for record in manifest["records"]:
        strata[(record["label"], record["domain"])].add(record["group_id"])
    out: dict[str, str] = {}
    for key in sorted(strata):
        groups = sorted(strata[key], key=lambda g: hashlib.sha256(f"{salt}:{g}".encode()).hexdigest())
        n_train, n_val = len(groups) // 2, len(groups) // 4
        for i, group in enumerate(groups):
            out[group] = "train" if i < n_train else "val" if i < n_train + n_val else "test"
    return out


def split_records(manifest: dict, assignment: dict[str, str]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {s: [] for s in SPLITS}
    for record in manifest["records"]:
        if record["group_id"] not in assignment:
            raise LeakageError(f"record {record['record_id']} has no split")
        out[assignment[record["group_id"]]].append(record)
    return out


def _preparation_fingerprint(record: dict) -> str:
    return hashlib.sha256(json.dumps(record["render"]["group"], sort_keys=True).encode()).hexdigest()


def check_disjoint(splits: dict[str, list[dict]]) -> None:
    """No preparation, capture or re-labelled copy of a preparation may appear
    in more than one split. Raises LeakageError naming the first overlap."""
    seen: dict[str, dict[str, str]] = {"group_id": {}, "record_id": {}, "preparation": {}}
    group_identity: dict[str, tuple[str, str]] = {}
    for split, records in splits.items():
        for record in records:
            identity = (record["label"], record["domain"])
            if group_identity.setdefault(record["group_id"], identity) != identity:
                raise LeakageError(f"group {record['group_id']} mixes labels or domains")
            for kind, value in (("group_id", record["group_id"]), ("record_id", record["record_id"]),
                                ("preparation", _preparation_fingerprint(record))):
                first = seen[kind].setdefault(value, split)
                if first != split:
                    raise LeakageError(f"{kind} {value} appears in both {first} and {split}")


def freeze(manifest: dict, path: Path = SPLITS_PATH) -> dict:
    assignment = assign(manifest)
    splits = split_records(manifest, assignment)
    check_disjoint(splits)
    frozen = {
        "splits_version": 1,
        "salt": SALT,
        "manifest_digest": feasibility_set.digest(manifest),
        "counts": {s: {"groups": len({r["group_id"] for r in rs}), "records": len(rs)} for s, rs in splits.items()},
        "assignment": dict(sorted(assignment.items())),
    }
    path.write_text(json.dumps(frozen, indent=1) + "\n", encoding="utf-8")
    return frozen


def load_frozen(path: Path = SPLITS_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def assert_frozen(manifest: dict, path: Path = SPLITS_PATH) -> dict[str, str]:
    frozen = load_frozen(path)
    if frozen["manifest_digest"] != feasibility_set.digest(manifest):
        raise LeakageError("the manifest changed since the splits were frozen; re-freeze deliberately")
    if assign(manifest, frozen["salt"]) != frozen["assignment"]:
        raise LeakageError("the frozen assignment does not re-derive from the manifest")
    return frozen["assignment"]


if __name__ == "__main__":
    result = freeze(feasibility_set.load())
    print(json.dumps(result["counts"]))
