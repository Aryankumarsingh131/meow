// T23: the feasibility-set manifest conforms to ml/data/manifest.schema.json,
// and the schema itself refuses the things T23 forbids.
//
// Run: node tests/ml-manifest.test.ts

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Ajv2020 } from "ajv/dist/2020.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf-8"));
const schema = read("../ml/data/manifest.schema.json");
const manifest = read("../ml/data/syn-color-001.feasibility.v1.json");

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`PASS  ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  ${label}`, detail ?? "");
  }
}

check("the generated manifest validates", validate(manifest) === true, validate.errors);
check("record_count matches the records", manifest.record_count === manifest.records.length);

function mutated(change: (record: Record<string, any>) => void) {
  const copy = structuredClone(manifest);
  change(copy.records[0]);
  return validate(copy);
}

check("a model-produced label is refused", mutated((r) => { r.label_source = "model_prediction"; }) === false);
check("a synthetic record cannot claim a lab reference label", mutated((r) => { r.label_source = "reference_method"; }) === false);
check("real data must carry recorded consent", mutated((r) => {
  r.data_mode = "operational"; r.label_source = "reference_method"; r.permissions.consent = "not_applicable_synthetic";
}) === false);
check("a feature outside 0..255 is refused", mutated((r) => { r.features.median_r = 300; }) === false);
check("an unknown feature schema is refused", mutated((r) => { r.features.schema_version = 2; }) === false);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall manifest checks passed");
