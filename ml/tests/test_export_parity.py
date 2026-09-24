"""T25: the bundled ONNX file computes exactly what was trained (CPU parity).

Run from the repo root: python -m unittest discover -s ml/tests -v
"""

from __future__ import annotations

import hashlib
import json
import unittest

import numpy as np
import onnxruntime as ort

from ml import evaluate, golden, train


class ExportParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.artifact = json.loads(train.ARTIFACT_PATH.read_text(encoding="utf-8"))
        cls.manifest = json.loads(golden.MANIFEST_PATH.read_text(encoding="utf-8"))
        cls.session = ort.InferenceSession(str(golden.MODEL_PATH), providers=["CPUExecutionProvider"])
        cls.x = np.vstack([evaluate.matrix(evaluate.records("train")), evaluate.matrix(evaluate.records("val"))])

    def test_onnx_logits_match_the_trained_weights_on_every_development_record(self) -> None:
        onnx_out = self.session.run(["logits"], {"features": self.x.astype(np.float32)})[0]
        reference = train.forward(self.artifact, self.x)
        self.assertLess(float(np.abs(onnx_out - reference).max()), golden.LOGIT_TOLERANCE)
        self.assertTrue((onnx_out.argmax(1) == reference.argmax(1)).all())

    def test_the_manifest_describes_the_file_it_ships_with(self) -> None:
        data = golden.MODEL_PATH.read_bytes()
        self.assertEqual(self.manifest["sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(self.manifest["bytes"], len(data))
        (inp,), (out,) = self.session.get_inputs(), self.session.get_outputs()
        self.assertEqual((inp.name, inp.type, inp.shape[1]), (self.manifest["input"]["name"], "tensor(float)", 3))
        self.assertEqual((out.name, out.shape[1]), (self.manifest["output"]["name"], len(self.manifest["output"]["classes"])))
        self.assertEqual(self.manifest["output"]["classes"], self.artifact["classes"])

    def test_the_file_says_what_it_is(self) -> None:
        meta = self.session.get_modelmeta().custom_metadata_map
        self.assertEqual((meta["status"], meta["data_mode"]), ("research", "synthetic"))

    def test_the_golden_file_matches_the_model_and_calibration_in_the_manifest(self) -> None:
        g = json.loads(golden.GOLDEN_PATH.read_text(encoding="utf-8"))
        self.assertEqual(g["model_sha256"], self.manifest["sha256"])
        self.assertEqual(g["calibration_version"], (self.manifest["calibration"] or {}).get("version"))
        val_ids = {r["record_id"] for r in evaluate.records("val")}
        for v in g["vectors"]:
            self.assertIn(v["record_id"], val_ids, "golden vectors come from validation, never test")
        for v in g["vectors"] + g["probes"]:
            logits = self.session.run(["logits"], {"features": np.array([v["features"]], np.float32)})[0][0]
            self.assertLess(float(np.abs(logits - np.array(v["logits"])).max()), g["logit_tolerance"])
            self.assertEqual(golden.decide(v["logits"], self.manifest, v["features"]), v["expected"])


if __name__ == "__main__":
    unittest.main()
