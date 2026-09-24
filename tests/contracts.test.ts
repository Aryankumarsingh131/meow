// T05 contract test harness.
//
// Exact future test commands (also recorded in docs/agent-workflow/handoff-T05.md):
//   1. Regenerate schemas after editing services/api/app/schemas.py:
//        python -c "from services.api.app.main import app; import json; json.dump(app.openapi(), open('contracts/openapi.json','w'), indent=2)"
//   2. Regenerate the TS client (NEVER hand-edit contracts/client.ts):
//        npx openapi-typescript contracts/openapi.json -o contracts/client.ts
//   3. Run this file:
//        node tests/contracts.test.ts
//   4. Run the Python schema unit tests:
//        python -m unittest services.api.app.tests.test_schemas -v
//
// This file does two things for real, not by inspection:
//   (a) runtime-validates synthetic fixtures against the ACTUAL generated
//       contracts/openapi.json component schemas via ajv (2020-12), proving
//       the discriminators reject invalid data and a valid fixture round
//       trips;
//   (b) statically type-checks (via `satisfies`) that the same valid
//       fixtures conform to the generated contracts/client.ts types, so a
//       drift between the two generated artifacts would be a compile error,
//       not a silent mismatch.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { components } from "../contracts/client.ts";

// ajv-formats' CJS default-export shape doesn't type-check cleanly under
// NodeNext + esModuleInterop; require() sidesteps the interop mismatch
// rather than fighting it with an `any` cast.
const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

type OpenApiDoc = { components: { schemas: Record<string, unknown> } };

const openapiPath = new URL("../contracts/openapi.json", import.meta.url);
const doc: OpenApiDoc = JSON.parse(readFileSync(openapiPath, "utf-8"));

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv); // without this, "format": "uuid"/"date-time" are silently ignored, not enforced
ajv.addSchema({ $id: "openapi.json", ...doc });

function schemaFor(name: string) {
  const validate = ajv.getSchema(`openapi.json#/components/schemas/${name}`);
  if (!validate) throw new Error(`no compiled schema for ${name} - check contracts/openapi.json`);
  return validate;
}

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`, detail ?? "");
  }
}

// --- synthetic fixtures (data_mode: "synthetic", never operational) -------

const validSample = {
  schema_version: 1,
  sample_id: "11111111-1111-4111-8111-111111111111",
  source_id: "22222222-2222-4222-8222-222222222222",
  // SYN-COLOR-001 v1 (protocols/SYN-COLOR-001.v1.json) — the canonical M1
  // synthetic protocol adopted by ADR-M1-001, not a placeholder id.
  protocol: { id: "f96bdca3-5020-5313-b65a-072967c46292", version: 1 },
  kit_lot_id: "d839e38e-3e34-529a-820f-996d5e64e099",
  captured_at_device: "2026-09-25T10:00:00Z",
  // Discriminated timing (T05 review, 2026-09-24). 30 s is in_window for
  // SYN-COLOR-001's synthetic read window (30 s +/- 15 s).
  timing: { state: "in_window", elapsed_ms: 30000, valid: true },
  method: "assisted",
  observation: {
    machine_bin: "bin_2",
    manual_bin: null,
    selected_bin: "bin_2",
    indicative_flag: "review",
    quality_reasons: [],
    model_version: "research-0",
    calibration_version: null,
    confidence: null,
  },
  evidence_ids: [],
  client_build: "demo-build-id",
  data_mode: "synthetic",
} satisfies components["schemas"]["CanonicalSampleV1"];

const validPushRequest = {
  device_id: "55555555-5555-4555-8555-555555555555",
  events: [
    {
      event_id: "66666666-6666-4666-8666-666666666666",
      kind: "sample.create",
      schema_version: 1,
      payload: validSample,
    },
  ],
} satisfies components["schemas"]["PushRequest"];

const validCloseCommand = {
  command_id: "77777777-7777-4777-8777-777777777777",
  expected_version: 3,
  type: "close",
  payload: {
    verified_report_id: null,
    verified_report_exemption_reason: "lab access unavailable, supervisor exemption on file",
    retest_sample_id: "88888888-8888-4888-8888-888888888888",
    retest_exemption_reason: null,
    action_ids: ["99999999-9999-4999-8999-999999999999"],
    action_exemption_reason: null,
    communication_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    disposition: "resolved, resident notified",
    policy_version: 1,
  },
} satisfies components["schemas"]["CloseCommand"];

// --- (a) synthetic fixture round trip: valid data is ACCEPTED -------------

check(
  "valid PushRequest passes schema validation (round trip)",
  schemaFor("PushRequest")(validPushRequest) === true,
  ajv.errors,
);
check(
  "valid CloseCommand passes schema validation (round trip)",
  schemaFor("CloseCommand")(validCloseCommand) === true,
  ajv.errors,
);

// --- (b) discriminators reject invalid data --------------------------------

const unknownKindEvent = {
  ...validPushRequest,
  events: [{ ...validPushRequest.events[0], kind: "sample.delete" }],
};
check(
  "unknown sample event 'kind' is REJECTED",
  schemaFor("PushRequest")(unknownKindEvent) === false,
);

const missingPayloadFieldSample = {
  ...validPushRequest,
  events: [
    {
      ...validPushRequest.events[0],
      payload: { ...validSample, sample_id: undefined },
    },
  ],
};
check(
  "sample.create missing required sample_id is REJECTED",
  schemaFor("PushRequest")(missingPayloadFieldSample) === false,
);

const unknownCommandType = { ...validCloseCommand, type: "delete_case" };
check("unknown case command 'type' is REJECTED", schemaFor("CloseCommand")(unknownCommandType) === false);

// close without verified_report_id AND without exemption reason - business
// rule enforced by the Pydantic model_validator, must show up as a schema
// failure too (Pydantic validators surface as required/anyOf constraints in
// the generated JSON Schema only when expressible; this specific
// cross-field rule is NOT expressible in plain JSON Schema, so this case is
// intentionally checked against the Python leg instead - see
// services/api/app/tests/test_schemas.py::test_close_requires_report_or_exemption.
// Documented here rather than silently assumed to be covered by ajv.

const malformedUuidSample = {
  ...validPushRequest,
  events: [{ ...validPushRequest.events[0], event_id: "not-a-uuid" }],
};
check(
  "malformed event_id (not a UUID) is REJECTED",
  schemaFor("PushRequest")(malformedUuidSample) === false,
);

const negativeExpectedVersion = { ...validCloseCommand, expected_version: 0 };
check(
  "expected_version < 1 is REJECTED",
  schemaFor("CloseCommand")(negativeExpectedVersion) === false,
);

const oversizeBatch = {
  ...validPushRequest,
  events: Array.from({ length: 51 }, (_, i) => ({
    ...validPushRequest.events[0],
    event_id: `66666666-6666-4666-8666-6666666666${String(i).padStart(2, "0")}`,
  })),
};
check(
  "push batch over 50 events is REJECTED (api-contracts.md batch bound)",
  schemaFor("PushRequest")(oversizeBatch) === false,
);

// --- (c) discriminated timing (T05 review, 2026-09-24) ---------------------
//
// The original v1 Timing was `{elapsed_ms: int>=0, valid: bool}`. It could not
// record a rebooted test without inventing `elapsed_ms=0`, and `valid: bool`
// made late / expired / indeterminate indistinguishable.

const withTiming = (timing: unknown) => ({
  ...validPushRequest,
  events: [{ ...validPushRequest.events[0], payload: { ...validSample, timing } }],
});

check(
  "indeterminate timing (reboot) is ACCEPTED with no invented elapsed time",
  schemaFor("PushRequest")(withTiming({ state: "indeterminate", reason: "reboot" })) === true,
  ajv.errors,
);
check(
  "indeterminate timing carrying a guessed elapsed_ms is REJECTED",
  schemaFor("PushRequest")(withTiming({ state: "indeterminate", reason: "reboot", elapsed_ms: 0 })) === false,
);
check(
  "the pre-review timing shape (no discriminator) is REJECTED",
  schemaFor("PushRequest")(withTiming({ elapsed_ms: 60000, valid: true })) === false,
);
check(
  "an unknown indeterminate reason is REJECTED",
  schemaFor("PushRequest")(withTiming({ state: "indeterminate", reason: "the_dog_ate_it" })) === false,
);
// NOT attempted here, deliberately: "state=expired, valid=true" is a
// cross-field rule (valid must equal state=='in_window'). JSON Schema cannot
// express it, so ajv would accept it; the server's pydantic model_validator
// rejects it. Covered by services/api/app/tests/test_schemas.py
// TimingDiscriminatorTests. Same situation as the close-command rule above.

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
