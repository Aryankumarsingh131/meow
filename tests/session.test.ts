/**
 * Login and surface-routing rules.
 *
 * Run:  node tests/session.test.ts
 */

import assert from 'node:assert/strict';

import {
  DEMO_ACCOUNTS,
  SIGN_IN_ERROR,
  continueAsPublic,
  isRealAuthentication,
  signIn,
  surfaceFor,
} from '../apps/mobile/src/session.ts';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (n: string, f: () => void | Promise<void>) => tests.push([n, f]);

test('valid staff credentials route to the field app', () => {
  const r = signIn('worker', 'jalsakshi');
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.session.role === 'worker');
  assert.equal(surfaceFor(r.ok ? r.session : null), 'field');
});

test('username is case-insensitive and trimmed', () => {
  assert.equal(signIn('  WORKER ', 'jalsakshi').ok, true);
});

test('password is NOT case-insensitive', () => {
  // Trimming a username is a usability nicety; loosening a password is not.
  assert.equal(signIn('worker', 'JALSAKSHI').ok, false);
  assert.equal(signIn('worker', ' jalsakshi').ok, false);
});

test('a wrong password and an unknown user are indistinguishable', () => {
  // Distinguishing them tells an attacker which usernames exist.
  const wrongPassword = signIn('worker', 'nope');
  const noSuchUser = signIn('nobody', 'nope');
  assert.equal(wrongPassword.ok, false);
  assert.equal(noSuchUser.ok, false);
  assert.deepEqual(wrongPassword, noSuchUser);
});

test('empty fields are reported separately from a bad credential', () => {
  // Bound to variables so TypeScript can narrow the discriminated union;
  // calling signIn twice inline defeats narrowing.
  const noUser = signIn('', 'x');
  assert.equal(noUser.ok, false);
  assert.equal(noUser.ok === false ? noUser.reason : null, 'empty_username');

  const noPassword = signIn('worker', '');
  assert.equal(noPassword.ok, false);
  assert.equal(noPassword.ok === false ? noPassword.reason : null, 'empty_password');
});

test('every error reason has user-facing text, and none leaks which field matched', () => {
  for (const reason of ['empty_username', 'empty_password', 'unknown_account'] as const) {
    const text = SIGN_IN_ERROR[reason];
    assert.ok(text && text.length > 0, reason);
  }
  assert.ok(!/password.*incorrect|no such user|user not found/i.test(SIGN_IN_ERROR.unknown_account));
});

test('the public portal needs no credentials', () => {
  const visitor = continueAsPublic();
  assert.equal(visitor.kind, 'public');
  assert.equal(surfaceFor(visitor), 'public');
});

test('no session shows neither surface', () => {
  assert.equal(surfaceFor(null), null);
});

test('a demo session is never marked verified', () => {
  // Until OIDC is wired nothing here authenticates anyone, and the UI must be
  // able to say so.
  assert.equal(isRealAuthentication, false);
  const r = signIn('worker', 'jalsakshi');
  assert.equal(r.ok && r.session.verified, false);
});

test('there is no resident account', () => {
  // authorization-matrix.md: a resident is not a user and has no login.
  for (const a of DEMO_ACCOUNTS) {
    assert.notEqual(a.role as string, 'resident');
  }
  assert.equal(signIn('resident', 'jalsakshi').ok, false);
});

test('demo roles are all in the fixed role enum', () => {
  const allowed = ['worker', 'supervisor', 'lab_reviewer', 'admin'];
  for (const a of DEMO_ACCOUNTS) {
    assert.ok(allowed.includes(a.role), `unexpected role ${a.role}`);
  }
});

test('the root routes only to the two product surfaces', async () => {
  const src = await (await import('node:fs/promises')).readFile(
    new URL('../apps/mobile/App.tsx', import.meta.url),
    'utf8',
  );
  // The development harness tabs must not be reachable from the root.
  for (const gone of ['DemoWorkflowScreen', 'SourcesScreen', 'ProtocolScreen', 'CaptureScreen']) {
    assert.ok(!new RegExp(`<${gone}`).test(src), `root still renders ${gone}`);
  }
  assert.ok(/<WorkerApp/.test(src), 'root does not render the field app');
  assert.ok(/<PublicApp/.test(src), 'root does not render the public portal');
  assert.ok(/<LoginScreen/.test(src), 'root has no login gate');
});

test('the underlying task modules still exist and are not deleted', async () => {
  const fs = await import('node:fs/promises');
  for (const f of [
    'sourceCatalog.ts',
    'timer.ts',
    'captureJob.ts',
    'statusLabel.ts',
    'sources.tsx',
    'protocol.tsx',
    'capture.tsx',
    'demo-workflow.tsx',
  ]) {
    await fs.access(new URL(`../apps/mobile/src/${f}`, import.meta.url));
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
