import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseResponse, estimateCostUsd } from '../src/jev.js';
import { buildResults } from './helpers/build-results.mjs';
import { RACE_OUTLOOK } from '../src/contracts.js';

const Q = RACE_OUTLOOK.questions(buildResults().derived);
const TEXT = readFileSync(new URL('./fixtures/jev_response_race_outlook.json', import.meta.url), 'utf8');
const fresh = () => JSON.parse(TEXT);

test('正常系：オブジェクトと JSON 文字列で同じ結果', () => {
  assert.deepEqual(parseResponse(TEXT, Q), parseResponse(fresh(), Q));
});
test('正常系：共通の項目', () => {
  const r = parseResponse(fresh(), Q);
  assert.equal(r.answeredModel, 'jev-1.13.0');
  assert.equal(r.requestId, 'playground_test0001');
  assert.equal(r.evaluationTimeMs, 120.5);
  assert.equal(r.inputTokens, 6021);
  assert.equal(r.outputTokens, 180);
});
test('正常系：select', () => {
  const a = parseResponse(fresh(), Q).answers.lead_horse;
  assert.equal(a.kind, 'select');
  assert.equal(a.selected, 'h01');
  assert.equal(a.confidence, 0.57);
  assert.equal(a.probabilities.length, 9);
  assert.deepEqual(a.probabilities.slice(0, 3), [{ option: 'h01', p: 0.62 }, { option: 'h03', p: 0.3 }, { option: 'unclear', p: 0.05 }]);
});
test('正常系：select の 0 の選択肢は criteria の順', () => {
  const a = parseResponse(fresh(), Q).answers.lead_horse;
  assert.deepEqual(a.probabilities.slice(4).map(x => x.option), ['h02', 'h04', 'h06', 'h07', 'h08']);
});
test('正常系：truth と grade', () => {
  const r = parseResponse(fresh(), Q).answers;
  assert.deepEqual(r.early_lead_battle, { kind: 'truth', probability: 0.41 });
  assert.deepEqual(r.pace, {
    kind: 'grade', selectedLevel: 1, confidence: 0.48,
    probabilities: [{ level: 0, p: 0.1 }, { level: 1, p: 0.65 }, { level: 2, p: 0.25 }],
  });
});
test('model がなければ answeredModel は null', () => {
  const j = fresh(); delete j.model;
  assert.equal(parseResponse(j, Q).answeredModel, null);
});

const bad = (name, mut) => test(`エラー：${name}`, () => {
  const j = fresh(); mut(j);
  assert.throws(() => parseResponse(j, Q), Error);
});
test('エラー：JSON として読めない', () => assert.throws(() => parseResponse('{not json', Q), /JSON/));
bad('pace がない', j => { delete j.answers.pace; });
bad('余分なキー', j => { j.answers.extra = { type: 'noul', noul: 0.5 }; });
bad('type の不一致', j => { j.answers.lead_horse.type = 'score'; });
bad('choice が選択肢にない', j => { j.answers.lead_horse.choice = 'h99'; });
bad('probabilities に h08 がない', j => { delete j.answers.lead_horse.probabilities.h08; });
bad('score の probabilities に "3"', j => { j.answers.pace.probabilities['3'] = 0; });
bad('noul が範囲外', j => { j.answers.early_lead_battle.noul = 1.2; });
bad('score の合計が 0.9', j => { j.answers.pace.probabilities['1'] = 0.55; });
bad('confidence がない', j => { delete j.answers.lead_horse.confidence; });

test('estimateCostUsd', () => {
  assert.ok(Math.abs(estimateCostUsd(13812) - 0.000580104) < 1e-12);
  assert.equal(estimateCostUsd(null), null);
});
