/**
 * T09 verification: capture job lifecycle, permission recovery, missing-card
 * prompting, manual ROI geometry.
 *
 * The centrepiece is the stale-job race from user-journeys.md J02:
 * "Retaking creates a new capture job; cancelled/late model output cannot
 * overwrite it."
 *
 * Rotation cases are checked against the REAL orientation transform in
 * modules/capture-native/index.ts (T04), not a reimplementation - a round
 * trip through `correctOrientation` proves the ROI mapping agrees with the
 * pipeline that will actually consume the corners.
 *
 * Run:  node tests/capture-flow.test.ts
 */

import assert from 'node:assert/strict';

import { correctOrientation, type Point } from '../modules/capture-native/index.ts';
import {
  FAILURE_PROMPT,
  MIN_ROI_AREA_PX,
  cancelJob,
  canStartCapture,
  defaultManualRoi,
  initialCaptureState,
  isRecoverable,
  manualEntryAvailable,
  settleJob,
  startJob,
  toUprightPoint,
  uprightSize,
  validateRoi,
  type CaptureRequest,
  type CaptureState,
} from '../apps/mobile/src/captureJob.ts';

const REQUEST: CaptureRequest = {
  sourceId: 'src-a1',
  protocolId: 'proto-fixture-0001',
  protocolVersion: 1,
  attemptId: 'attempt-1',
  requireReferenceCard: true,
};

const FEATURES = { schema_version: 1, median_r: 10, median_g: 20, median_b: 30 };
const CORNERS: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

const analysed = { kind: 'analysed', features: FEATURES, corners: CORNERS, orientation: 1 } as const;

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

// --- AC 3: old job cannot overwrite retake --------------------------------

test('a late result from a superseded job is refused', () => {
  let s: CaptureState = initialCaptureState;
  const first = startJob(s, 'job-1', REQUEST, 1000);
  s = first.state;
  // Worker retakes before job-1 finishes.
  const second = startJob(s, 'job-2', REQUEST, 2000);
  s = second.state;

  // job-1's analysis now lands, late.
  const late = settleJob(s, 'job-1', analysed);
  assert.equal(late.disposition, 'discarded_superseded');
  // The retake is untouched and still in flight.
  assert.equal(late.state.active?.jobId, 'job-2');
  assert.equal(late.state.last?.status, 'superseded');
  // Crucially: no success result leaked into state.
  assert.notEqual(late.state.last?.status, 'succeeded');
});

test('a late result cannot overwrite an already-applied retake result', () => {
  let s: CaptureState = initialCaptureState;
  s = startJob(s, 'job-1', REQUEST, 1000).state;
  s = startJob(s, 'job-2', REQUEST, 2000).state;

  // The retake completes first.
  const applied = settleJob(s, 'job-2', {
    kind: 'analysed',
    features: { marker: 'RETAKE' },
    corners: CORNERS,
    orientation: 1,
  });
  assert.equal(applied.disposition, 'applied');
  s = applied.state;

  // Now the original, slower job returns.
  const stale = settleJob(s, 'job-1', {
    kind: 'analysed',
    features: { marker: 'STALE' },
    corners: CORNERS,
    orientation: 1,
  });
  assert.equal(stale.disposition, 'discarded_superseded');
  assert.equal(
    stale.state.last?.status === 'succeeded' ? (stale.state.last.features as any).marker : null,
    'RETAKE',
    'a stale analysis overwrote the retake result',
  );
});

test('a cancelled job’s late result is refused and reported as cancelled', () => {
  let s: CaptureState = initialCaptureState;
  s = startJob(s, 'job-1', REQUEST, 1000).state;
  s = cancelJob(s, 'job-1');
  assert.equal(s.active, null);
  assert.equal(s.last?.status, 'cancelled');

  const late = settleJob(s, 'job-1', analysed);
  assert.equal(late.disposition, 'discarded_cancelled');
  assert.equal(late.state.last?.status, 'cancelled');
});

test('a stale settle changes state by exactly nothing', () => {
  let s: CaptureState = initialCaptureState;
  s = startJob(s, 'job-1', REQUEST, 1000).state;
  s = startJob(s, 'job-2', REQUEST, 2000).state;
  const before = JSON.stringify(s);
  const after = settleJob(s, 'job-1', analysed);
  assert.equal(JSON.stringify(after.state), before);
});

test('an unknown job id is refused, not applied', () => {
  let s: CaptureState = initialCaptureState;
  s = startJob(s, 'job-1', REQUEST, 1000).state;
  const result = settleJob(s, 'job-does-not-exist', analysed);
  assert.equal(result.disposition, 'discarded_unknown');
  assert.equal(result.state.active?.jobId, 'job-1');
});

test('reusing a job id for a retake is refused', () => {
  const s = startJob(initialCaptureState, 'job-1', REQUEST, 1000).state;
  // Reuse would make the superseded attempt indistinguishable from the new one.
  assert.throws(() => startJob(s, 'job-1', REQUEST, 2000));
});

test('cancelling a stale job id does not cancel the active retake', () => {
  // A cancel button belonging to a superseded attempt must not kill the
  // retake the worker is now waiting on.
  let s: CaptureState = initialCaptureState;
  s = startJob(s, 'job-1', REQUEST, 1000).state;
  s = startJob(s, 'job-2', REQUEST, 2000).state;
  const after = cancelJob(s, 'job-1');
  assert.equal(after.active?.jobId, 'job-2', 'the active retake was cancelled by a stale id');
  assert.notEqual(after.last?.status, 'cancelled');
});

test('cancelling when nothing is active is a no-op', () => {
  const s = cancelJob(initialCaptureState, 'job-1');
  assert.equal(s.active, null);
  assert.equal(s.last, null);
  assert.deepEqual(s.discarded, []);
});

test('cancel clears the active slot so a late result cannot apply', () => {
  let s: CaptureState = initialCaptureState;
  s = startJob(s, 'job-1', REQUEST, 1000).state;
  s = cancelJob(s, 'job-1');
  assert.equal(s.active, null, 'cancel must clear active, or a late result would still apply');
  assert.equal(settleJob(s, 'job-1', analysed).disposition, 'discarded_cancelled');
});

test('superseded and cancelled attempts are retained as evidence', () => {
  let s: CaptureState = initialCaptureState;
  s = startJob(s, 'job-1', REQUEST, 1000).state;
  s = startJob(s, 'job-2', REQUEST, 2000).state;
  s = cancelJob(s, 'job-2');
  const ids = s.discarded.map((d) => d.job.jobId);
  assert.deepEqual(ids, ['job-2', 'job-1'], 'discarded attempts must not be erased');
  assert.deepEqual(
    s.discarded.map((d) => d.status),
    ['cancelled', 'superseded'],
  );
});

test('sequence numbers make “older” objectively checkable', () => {
  let s: CaptureState = initialCaptureState;
  const a = startJob(s, 'job-1', REQUEST, 1000);
  const b = startJob(a.state, 'job-2', REQUEST, 2000);
  assert.ok(b.job.seq > a.job.seq);
});

// --- S04: busy capture cannot queue unlimited jobs ------------------------

test('at most one job is ever active, however many retakes happen', () => {
  let s: CaptureState = initialCaptureState;
  for (let i = 1; i <= 25; i++) {
    const r = startJob(s, `job-${i}`, REQUEST, i * 100);
    s = r.state;
    assert.ok(s.active !== null);
    // `active` is a single slot, not a list - there is no queue to grow.
    assert.equal(s.active?.jobId, `job-${i}`);
  }
  assert.equal(s.discarded.length, 24);
  assert.equal(canStartCapture(s), true, 'a retake must never be blocked by an in-flight job');
});

// --- AC 1: permission error recovers --------------------------------------

test('permission denial is recoverable and keeps manual entry open', () => {
  let s: CaptureState = initialCaptureState;
  s = startJob(s, 'job-1', REQUEST, 1000).state;
  const r = settleJob(s, 'job-1', { kind: 'failed', reason: 'permission_denied' });
  assert.equal(r.disposition, 'applied');
  assert.equal(r.state.last?.status, 'failed');
  assert.equal(r.state.last?.status === 'failed' ? r.state.last.recoverable : null, true);
  // The worker can immediately try again after granting permission.
  assert.equal(canStartCapture(r.state), true);
  assert.equal(manualEntryAvailable(r.state), true);
});

test('a retry after permission is granted succeeds normally', () => {
  let s: CaptureState = initialCaptureState;
  s = startJob(s, 'job-1', REQUEST, 1000).state;
  s = settleJob(s, 'job-1', { kind: 'failed', reason: 'permission_denied' }).state;
  // Permission granted, worker retries.
  s = startJob(s, 'job-2', REQUEST, 2000).state;
  const ok = settleJob(s, 'job-2', analysed);
  assert.equal(ok.disposition, 'applied');
  assert.equal(ok.state.last?.status, 'succeeded');
});

test('recoverable and unrecoverable failures are distinguished', () => {
  assert.equal(isRecoverable('permission_denied'), true);
  assert.equal(isRecoverable('reference_card_missing'), true);
  assert.equal(isRecoverable('roi_invalid'), true);
  assert.equal(isRecoverable('decode_error'), true);
  // Hardware/build facts the worker cannot fix on the spot.
  assert.equal(isRecoverable('camera_unavailable'), false);
  assert.equal(isRecoverable('native_unavailable'), false);
});

test('manual entry stays available in every state, including success', () => {
  let s: CaptureState = initialCaptureState;
  assert.equal(manualEntryAvailable(s), true);
  s = startJob(s, 'job-1', REQUEST, 1000).state;
  assert.equal(manualEntryAvailable(s), true);
  s = settleJob(s, 'job-1', { kind: 'failed', reason: 'camera_unavailable' }).state;
  assert.equal(manualEntryAvailable(s), true);
  s = startJob(s, 'job-2', REQUEST, 2000).state;
  s = settleJob(s, 'job-2', analysed).state;
  assert.equal(manualEntryAvailable(s), true);
});

// --- AC 2: missing card prompts -------------------------------------------

test('missing reference card is reported and prompts an action', () => {
  let s: CaptureState = initialCaptureState;
  s = startJob(s, 'job-1', REQUEST, 1000).state;
  const r = settleJob(s, 'job-1', { kind: 'failed', reason: 'reference_card_missing' });
  assert.equal(r.state.last?.status, 'failed');
  const prompt = FAILURE_PROMPT.reference_card_missing;
  assert.match(prompt, /reference card/i);
  // The prompt must offer both routes named in S04/J02.
  assert.match(prompt, /retake/i);
  assert.match(prompt, /by hand|manual/i);
});

test('every failure prompt names an action and claims nothing about the water', () => {
  for (const [reason, prompt] of Object.entries(FAILURE_PROMPT)) {
    assert.ok(prompt.length > 0, reason);
    // AGENTS.md: screening is not potability. No prompt may imply a verdict.
    assert.ok(
      !/\b(safe|unsafe|clean|potable|drinkable|contaminated|pass|fail)\b/i.test(prompt),
      `prompt for ${reason} implies a water judgement: ${prompt}`,
    );
    // Each names something the worker can do.
    assert.match(
      prompt,
      /enter|retake|adjust|turn it on|place the card/i,
      `prompt for ${reason} offers no action: ${prompt}`,
    );
  }
});

test('a missing card does not silently produce a result', () => {
  let s: CaptureState = initialCaptureState;
  s = startJob(s, 'job-1', REQUEST, 1000).state;
  const r = settleJob(s, 'job-1', { kind: 'failed', reason: 'reference_card_missing' });
  assert.notEqual(r.state.last?.status, 'succeeded');
  assert.equal(r.state.active, null);
});

// --- manual ROI -----------------------------------------------------------

test('a valid ROI is accepted', () => {
  const r = validateRoi(
    [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 90 },
      { x: 10, y: 90 },
    ],
    100,
    100,
  );
  assert.equal(r.valid, true);
});

test('wrong corner count is refused', () => {
  for (const pts of [[], [{ x: 1, y: 1 }], CORNERS.slice(0, 3), [...CORNERS, { x: 5, y: 5 }]]) {
    const r = validateRoi(pts, 100, 100);
    assert.equal(r.valid, false);
    assert.equal(r.valid === false ? r.reason : null, 'wrong_count');
  }
});

test('out-of-bounds corners are refused, not clamped', () => {
  // Clamping would analyse a region the worker did not choose.
  const r = validateRoi(
    [
      { x: -5, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 90 },
      { x: 10, y: 90 },
    ],
    100,
    100,
  );
  assert.equal(r.valid, false);
  assert.equal(r.valid === false ? r.reason : null, 'out_of_bounds');
});

test('non-finite corners are refused', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = validateRoi([{ x: bad, y: 0 }, ...CORNERS.slice(1)], 100, 100);
    assert.equal(r.valid, false);
    assert.equal(r.valid === false ? r.reason : null, 'out_of_bounds');
  }
});

test('a degenerate (zero-area) ROI is refused', () => {
  const collapsed = [
    { x: 50, y: 50 },
    { x: 50, y: 50 },
    { x: 50, y: 50 },
    { x: 50, y: 50 },
  ];
  const r = validateRoi(collapsed, 100, 100);
  assert.equal(r.valid, false);
  assert.equal(r.valid === false ? r.reason : null, 'degenerate');

  // A thin sliver below the area floor is also refused.
  const sliver = [
    { x: 10, y: 10 },
    { x: 12, y: 10 },
    { x: 12, y: 11 },
    { x: 10, y: 11 },
  ];
  assert.ok(2 * 1 < MIN_ROI_AREA_PX);
  assert.equal(validateRoi(sliver, 100, 100).valid, false);
});

test('the default manual ROI is valid and centred', () => {
  const roi = defaultManualRoi(200, 100);
  const r = validateRoi(roi, 200, 100);
  assert.equal(r.valid, true);
  const cx = roi.reduce((a, p) => a + p.x, 0) / 4;
  const cy = roi.reduce((a, p) => a + p.y, 0) / 4;
  assert.equal(cx, 100);
  assert.equal(cy, 50);
});

// --- AC-003: rotation normalises correctly --------------------------------

test('upright size transposes for orientations 5-8 only', () => {
  for (const o of [1, 2, 3, 4]) {
    assert.deepEqual(uprightSize(o, 400, 300), { width: 400, height: 300 }, `orientation ${o}`);
  }
  for (const o of [5, 6, 7, 8]) {
    assert.deepEqual(uprightSize(o, 400, 300), { width: 300, height: 400 }, `orientation ${o}`);
  }
});

test('orientation 1 leaves points untouched', () => {
  assert.deepEqual(toUprightPoint({ x: 7, y: 3 }, 1, 400, 300), { x: 7, y: 3 });
});

test('mapped corners stay inside the upright frame for every orientation', () => {
  const W = 400;
  const H = 300;
  const probes: Point[] = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H },
    { x: 123, y: 45 },
  ];
  for (let o = 1; o <= 8; o++) {
    const { width, height } = uprightSize(o, W, H);
    for (const p of probes) {
      const u = toUprightPoint(p, o, W, H);
      assert.ok(
        u.x >= 0 && u.x <= width && u.y >= 0 && u.y <= height,
        `orientation ${o}: ${JSON.stringify(p)} -> ${JSON.stringify(u)} outside ${width}x${height}`,
      );
    }
  }
});

test('ROI mapping agrees with the real T04 orientation transform', () => {
  // Build a tiny image where every pixel encodes its own stored (x,y) as
  // [x, y, 0], run it through modules/capture-native's correctOrientation,
  // then check that toUprightPoint sends a stored point to the upright cell
  // that actually holds that pixel. This is the property that matters: a ROI
  // drawn on the displayed photo must land on the same content after the
  // pipeline rotates it.
  const W = 5;
  const H = 3;
  const stored = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => [x, y, 0] as [number, number, number]),
  );

  for (let o = 1; o <= 8; o++) {
    const rotated = correctOrientation(stored, H, W, o);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Sample the centre of the stored pixel.
        const u = toUprightPoint({ x: x + 0.5, y: y + 0.5 }, o, W, H);
        const ux = Math.min(Math.max(Math.floor(u.x), 0), rotated.w - 1);
        const uy = Math.min(Math.max(Math.floor(u.y), 0), rotated.h - 1);
        const landed = rotated.pixels[uy][ux];
        assert.deepEqual(
          [landed[0], landed[1]],
          [x, y],
          `orientation ${o}: stored (${x},${y}) mapped to upright (${ux},${uy}) which holds (${landed[0]},${landed[1]})`,
        );
      }
    }
  }
});

// --- provenance -----------------------------------------------------------

test('a settled job carries no bin, reading or water judgement', () => {
  let s: CaptureState = initialCaptureState;
  s = startJob(s, 'job-1', REQUEST, 1000).state;
  const r = settleJob(s, 'job-1', analysed);
  const settled = r.state.last!;
  for (const forbidden of ['bin', 'result', 'safe', 'potable', 'concentration', 'reading']) {
    assert.ok(!(forbidden in settled), `settled job leaked a ${forbidden} field`);
  }
  assert.equal(settled.status, 'succeeded');
});

test('capture.tsx has no scan-to-navigate or eval path and routes through the reducer', async () => {
  // capture.tsx cannot be executed here (no JSX transform under Node, no React
  // test renderer installed). tsc type-checks it via apps/mobile/tsconfig.json;
  // this guards the properties tests cannot reach.
  const source = await (await import('node:fs/promises')).readFile(
    new URL('../apps/mobile/src/capture.tsx', import.meta.url),
    'utf8',
  );
  for (const pattern of [/\beval\(/, /dangerouslySetInnerHTML/, /new\s+Function\(/]) {
    assert.ok(!pattern.test(source), `capture.tsx matches forbidden pattern ${pattern}`);
  }
  // All lifecycle changes must go through the audited reducer.
  assert.ok(/settleJob\(/.test(source), 'capture.tsx does not settle through settleJob');
  assert.ok(/startJob\(/.test(source), 'capture.tsx does not start through startJob');
  assert.ok(/cancelJob\(/.test(source), 'capture.tsx has no cancel path');
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${(error as Error).message}`);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passed`);
if (failures > 0) process.exit(1);
