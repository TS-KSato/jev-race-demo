import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, checkLimits } from '../src/jev.js';
import { buildResults } from './helpers/build-results.mjs';
import { RACE_OUTLOOK } from '../src/contracts.js';

const R = buildResults();

test('buildRequest の model', () => {
  assert.equal(buildRequest({}, {}).model, 'jev-1.13.0');
});
test('kind が type に変わり、type が最初のキーになる', () => {
  const q = buildRequest({}, RACE_OUTLOOK.questions(R.derived)).questions;
  assert.deepEqual(Object.values(q).map(x => x.type), ['choice', 'noul', 'score']);
  assert.deepEqual(Object.keys(q.lead_horse), ['type', 'instructions', 'criteria']);
  assert.deepEqual(Object.keys(q.early_lead_battle), ['type', 'instructions']);
  assert.ok(Object.values(q).every(x => !('kind' in x)));
});
test('未知の kind でエラー', () => {
  assert.throws(() => buildRequest({}, { x: { kind: 'other', instructions: 'a' } }));
});
test('架空の出馬表のリクエストは上限内', () => {
  assert.equal(checkLimits(R.raceRequest).ok, true);
  for (const r of [...R.horseRequests.noOutlook, ...R.horseRequests.withOutlook]) assert.equal(checkLimits(r).ok, true);
});
test('非常に大きな state は上限超過', () => {
  const c = checkLimits({ state: 'x'.repeat(70000), questions: {} });
  assert.equal(c.ok, false);
});
