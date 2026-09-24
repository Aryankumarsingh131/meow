import assert from 'node:assert/strict';
import { overallOf, type Reading } from '../apps/mobile/src/v1Model.ts';

const reading = (rating: Reading['rating']): Reading => ({ key: 'ph', value: '7.2', rating });
assert.equal(overallOf([]), 'not_tested');
assert.equal(overallOf([reading('safe')]), 'safe');
assert.equal(overallOf([reading('safe'), reading('warning')]), 'warning');
assert.equal(overallOf([reading('safe'), reading('unsafe')]), 'unsafe');
console.log('V1 rating precedence and empty-state checks passed');
