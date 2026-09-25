/**
 * Guards the user-facing vocabulary of BOTH app surfaces.
 *
 * The supplied product mockups contained "Safe / Acceptable — Low risk of
 * contamination", "Safe to drink", "Confidence 96%" and "Boil water if
 * unsure". Each is forbidden by AGENTS.md. These tests make the replacement
 * wording enforceable, so the prohibited phrasing cannot quietly return via a
 * later copy edit.
 *
 * Run:  node tests/status-label.test.ts
 */

import assert from 'node:assert/strict';

import {
  BANNED_WORDS,
  assistedAvailability,
  labParameterTone,
  labSummary,
  qualityReasonText,
  recordAgeLabel,
  screeningPresentation,
  type IndicativeFlag,
} from '../apps/mobile/src/statusLabel.ts';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (n: string, f: () => void | Promise<void>) => tests.push([n, f]);

const FLAGS: IndicativeFlag[] = ['no_flag', 'review', 'uncertain', 'invalid'];

function assertNoBannedWords(text: string, where: string) {
  for (const w of BANNED_WORDS) {
    assert.ok(
      !new RegExp(`\\b${w}\\b`, 'i').test(text),
      `${where} contains the banned word "${w}": ${text}`,
    );
  }
}

test('no screening outcome is ever worded as safe or potable', () => {
  for (const flag of FLAGS) {
    const p = screeningPresentation(flag);
    assertNoBannedWords(p.title, `screening ${flag} title`);
    assertNoBannedWords(p.detail, `screening ${flag} detail`);
  }
});

test('the best screening outcome still disclaims being a lab test', () => {
  // This is the case the mockup labelled "Safe / Acceptable".
  const p = screeningPresentation('no_flag');
  assert.match(p.detail, /not a laboratory test/i);
  assert.match(p.detail, /not a drinking-water decision/i);
  assert.equal(p.title, 'No review triggered');
});

test('invalid and uncertain are distinct outcomes, not merged', () => {
  const invalid = screeningPresentation('invalid');
  const uncertain = screeningPresentation('uncertain');
  assert.notEqual(invalid.title, uncertain.title);
  assert.notEqual(invalid.tone, uncertain.tone);
});

test('no confidence percentage is emitted while no model is approved', () => {
  const a = assistedAvailability(false);
  assert.equal(a.available, false);
  // The mockup showed "Confidence 96%". With no approved model any number
  // would be fabricated.
  assert.ok(!/\d+\s*%/.test(a.label + a.detail), 'a confidence percentage was emitted');
  assert.match(a.detail, /no analysis model has been approved/i);
});

test('even an enabled model is labelled a suggestion a person decides on', () => {
  const a = assistedAvailability(true);
  assert.match(a.label, /suggestion/i);
  assert.match(a.detail, /a person still decides/i);
  assertNoBannedWords(a.label + ' ' + a.detail, 'assisted availability');
});

test('quality reason text never implies a water judgement', () => {
  for (const code of [
    'BLUR_SUSPECTED',
    'CLIPPING_EXCESSIVE',
    'GLARE_EXCESSIVE',
    'ROI_TOO_SMALL',
    'REFERENCE_CARD_NOT_DETECTED',
    'REFERENCE_CARD_UNREADABLE',
    'THRESHOLD_UNSET',
    'SOME_UNKNOWN_CODE',
  ]) {
    assertNoBannedWords(qualityReasonText(code), `quality ${code}`);
  }
});

test('lab summary states what was measured, never that water is safe', () => {
  const ok = labSummary(true, '24 Apr 2025', 'Riverside District Water Lab');
  // This is the case the mockup labelled "Safe — safe for drinking".
  assertNoBannedWords(ok.title, 'lab summary title');
  assertNoBannedWords(ok.detail, 'lab summary detail');
  assert.match(ok.title, /within limits/i);
  // Must scope the claim to what was actually tested.
  assert.match(ok.detail, /only the parameters listed were tested/i);
  assert.match(ok.detail, /Riverside District Water Lab/);
  assert.match(ok.detail, /24 Apr 2025/);
});

test('an absent lab report is its own state, not an implied pass', () => {
  const none = labSummary(null, '', '');
  assert.equal(none.tone, 'unknown');
  assert.match(none.title, /no verified laboratory result/i);
});

test('a breach is reported without diagnosis or remediation advice', () => {
  const bad = labSummary(false, '24 Apr 2025', 'Riverside District Water Lab');
  assertNoBannedWords(bad.title + ' ' + bad.detail, 'lab breach');
  // The mockup's "Boil water if unsure" is a remediation instruction.
  assert.ok(!/\bboil\b/i.test(bad.detail), 'emitted a remediation instruction');
  assert.ok(!/\bdo not drink\b/i.test(bad.detail));
  assert.match(bad.detail, /supervisor/i);
});

test('an unmeasured parameter is unknown, not within-limit', () => {
  assert.equal(labParameterTone({ name: 'pH', value: '', unit: null, limitText: '', withinLimit: null }), 'unknown');
  assert.equal(labParameterTone({ name: 'pH', value: '7.2', unit: null, limitText: '', withinLimit: true }), 'ok');
  assert.equal(labParameterTone({ name: 'pH', value: '9.9', unit: null, limitText: '', withinLimit: false }), 'watch');
});

test('record age is stated, and a future date is flagged not hidden', () => {
  const now = Date.parse('2026-09-23T00:00:00Z');
  assert.match(recordAgeLabel('2026-09-23T00:00:00Z', now), /today/i);
  assert.match(recordAgeLabel('2026-09-22T00:00:00Z', now), /yesterday/i);
  assert.match(recordAgeLabel('2026-09-01T00:00:00Z', now), /22 days ago/i);
  // A device clock in the future must not render as "today".
  assert.match(recordAgeLabel('2026-12-01T00:00:00Z', now), /device clock may be wrong/i);
  assert.match(recordAgeLabel('not-a-date', now), /unknown/i);
});

test('neither screen writes status strings inline', async () => {
  // The whole point of statusLabel.ts is that wording lives in one auditable
  // place. If a screen hardcodes a verdict, this catches it.
  const fs = await import('node:fs/promises');
  for (const f of ['workerApp.tsx', 'publicApp.tsx', 'modelCheck.tsx', 'pluccy.tsx', 'staffApp.tsx', 'residentApp.tsx']) {
    const src = await fs.readFile(new URL(`../apps/mobile/src/${f}`, import.meta.url), 'utf8');
    for (const w of ['Safe to drink', 'safe for drinking', 'Low risk of contamination']) {
      assert.ok(!src.includes(w), `${f} hardcodes the banned phrase "${w}"`);
    }
    assert.ok(!/Confidence\s*\d+\s*%/i.test(src), `${f} renders a confidence percentage`);
    assert.ok(!/\bBoil water\b/i.test(src), `${f} gives a remediation instruction`);
  }
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${(e as Error).message}`);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passed`);
if (failures > 0) process.exit(1);
