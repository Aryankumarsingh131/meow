/**
 * Login and surface-routing rules.
 *
 * Run:  node tests/session.test.ts
 */

import assert from 'node:assert/strict';

import {
  DEMO_USERNAMES,
  SIGN_IN_ERROR,
  checkSignInInput,
  continueAsPublic,
  hostedSession,
  signInFailureFor,
  staffSession,
  surfaceFor,
  type SignInFailure,
} from '../apps/mobile/src/session.ts';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (n: string, f: () => void | Promise<void>) => tests.push([n, f]);

const AUTH = { token: 'h.p.s', subject: 'user-1', expiresAtMs: 0 };

// Credential matching (case, enumeration resistance) is enforced by the SERVER
// since M1 and tested in tests/dev_issuer_test.py. These are the client's half.

test('a staff session routes to the field app', () => {
  assert.equal(surfaceFor(staffSession('worker', AUTH)), 'field');
});

test('username is normalised; the token is kept as issued', () => {
  const s = staffSession('  WORKER ', AUTH);
  assert.equal(s.username, 'worker');
  assert.equal(s.auth, AUTH);
});

test('empty fields are caught before any network call', () => {
  assert.equal(checkSignInInput('', 'x'), 'empty_username');
  assert.equal(checkSignInInput('   ', 'x'), 'empty_username');
  assert.equal(checkSignInInput('worker', ''), 'empty_password');
  assert.equal(checkSignInInput('worker', 'x'), null);
});

test('password is not trimmed or otherwise loosened on the client', () => {
  assert.equal(checkSignInInput('worker', ' '), null); // sent as-is; server decides
});

test('offline is told apart from wrong details', () => {
  assert.equal(signInFailureFor('auth_required'), 'unknown_account');
  assert.equal(signInFailureFor('offline'), 'offline');
  assert.equal(signInFailureFor('failed'), 'server_error');
  assert.notEqual(SIGN_IN_ERROR.offline, SIGN_IN_ERROR.unknown_account);
});

test('every failure has text, and none leaks which field matched', () => {
  const all: SignInFailure[] = ['empty_username', 'empty_password', 'unknown_account', 'offline', 'server_error'];
  for (const reason of all) assert.ok(SIGN_IN_ERROR[reason].length > 0, reason);
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

test('a session always names its issuer as synthetic', () => {
  // The issuer is ADR-M1-002's dev issuer, not a real identity provider,
  // and the UI must be able to say so.
  assert.equal(staffSession('worker', AUTH).issuer, 'synthetic_dev_issuer');
});

test('the synthetic issuer has no resident user', () => {
  // Residents sign in only through the hosted path (Supabase Auth, 006).
  assert.ok(!(DEMO_USERNAMES as readonly string[]).includes('resident'));
});

test('a hosted sign-in routes by the role the server returned', () => {
  const resident = hostedSession(' A@Example.org ', 'resident', 't');
  assert.deepEqual(resident, { kind: 'resident', email: 'a@example.org', token: 't' });
  assert.equal(surfaceFor(resident), 'resident');
  const worker = hostedSession('w@example.org', 'field_worker', 't');
  assert.equal(surfaceFor(worker), 'staff');
  assert.equal(worker?.kind === 'staff_v2' && worker.role, 'field_worker');
  assert.equal(surfaceFor(hostedSession('s@example.org', 'supervisor', 't')), 'staff');
  assert.equal(hostedSession('x@example.org', 'admin', 't'), null);   // unknown role: no surface
});

test('the session module no longer checks passwords locally', async () => {
  const src = await (await import('node:fs/promises')).readFile(
    new URL('../apps/mobile/src/session.ts', import.meta.url), 'utf8');
  assert.ok(!/password\s*===|===\s*password|DEMO_ACCOUNTS/.test(src), 'local password check is back');
});

test('the root routes only to the product surfaces', async () => {
  const src = await (await import('node:fs/promises')).readFile(
    new URL('../apps/mobile/App.tsx', import.meta.url),
    'utf8',
  );
  // The development harness tabs must not be reachable from the root.
  for (const gone of ['DemoWorkflowScreen', 'SourcesScreen', 'ProtocolScreen', 'CaptureScreen']) {
    assert.ok(!new RegExp(`<${gone}`).test(src), `root still renders ${gone}`);
  }
  assert.ok(/<WorkerApp/.test(src), 'root does not render the field app');
  assert.ok(/<StaffApp/.test(src), 'root does not render the staff app');
  assert.ok(/<ResidentApp/.test(src), 'root does not render the resident app');
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
