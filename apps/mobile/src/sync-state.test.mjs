import assert from 'node:assert/strict';
import test from 'node:test';

import { nextSyncStep } from './sync-state.ts';

test('metadata acknowledgement never implies photo availability', () => {
  assert.equal(nextSyncStep('PENDING', 'PENDING'), 'METADATA');
  assert.equal(nextSyncStep('SYNCED', 'PENDING'), 'PHOTO');
  assert.equal(nextSyncStep('SYNCED', 'AVAILABLE'), 'DONE');
});
