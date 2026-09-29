import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, levelLabel, outlookFromAnswers, outlookFromValues, OUTLOOK_NOTE } from '../src/score.js';
import { parseResponse } from '../src/jev.js';
import { RACE_OUTLOOK } from '../src/contracts.js';
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';

const M = 'jev-1.13.0';
const horses = [{ num: 1, name: 'テストアルファ' }, { num: 3, name: 'テストガンマ' }, { num: 12, name: 'テストラムダ' }];
const sel = (selected, confidence) => ({ kind: 'select', selected, confidence, probabilities: [] });
const truth = probability => ({ kind: 'truth', probability });
const grade = (ps, confidence) => ({ kind: 'grade', confidence, probabilities: ps.map((p, level) => ({ level, p })) });
const P = answers => ({ answeredModel: M, answers });

test('classify：noul の境界値', () => {
  for (const [p, e] of [[0.9, 'high'], [0.89, 'middle'], [0.5, 'middle'], [0.11, 'middle'], [0.1, 'high'], [0, 'high'], [1, 'high']]) {
    assert.equal(classify('truth', truth(p), M), e, String(p));
  }
});
test('classify：select・grade の境界値', () => {
  for (const t of ['select', 'grade']) {
    for (const [c, e] of [[0.9, 'high'], [0.89, 'middle'], [0.5, 'middle'], [0.49, 'unclear']]) {
      assert.equal(classify(t, { confidence: c }, M), e, `${t} ${c}`);
    }
  }
});
test('classify：値がない・数でない場合と未知の版', () => {
  assert.throws(() => classify('truth', {}, M));
  assert.throws(() => classify('truth', { probability: '0.9' }, M));
  assert.throws(() => classify('select', { confidence: null }, M));
  assert.throws(() => classify('grade', {}, M));
  assert.throws(() => classify('truth', { probability: NaN }, M));
  assert.equal(classify('truth', truth(0.95), 'jev-x'), 'high');
});
test('levelLabel', () => {
  assert.deepEqual(['high', 'middle', 'unclear'].map(levelLabel), ['高確信', '中間', '判別不能']);
});

test('expected_leader', () => {
  const f = a => outlookFromAnswers(P({ lead_horse: a }), horses).outlook.expected_leader;
  assert.equal(f(sel('h03', 0.95)), '3番 テストガンマ（確信度：高）');
  assert.equal(f(sel('h12', 0.6)), '12番 テストラムダ（確信度：中間）');
  assert.equal(f(sel('unclear', 0.95)), '特定できない');
  assert.equal(f(sel('h01', 0.49)), '特定できない');
  assert.throws(() => f(sel('h07', 0.95)));
});
test('early_lead_battle', () => {
  const f = p => outlookFromAnswers(P({ early_lead_battle: truth(p) }), horses).outlook.early_lead_battle;
  assert.equal(f(0.91), '激しくなる');
  assert.equal(f(0.9), '激しくなる');
  assert.equal(f(0.5), 'どちらとも言えない');
  assert.equal(f(0.1), '激しくならない');
});
test('pace', () => {
  const f = (ps, c) => outlookFromAnswers(P({ pace: grade(ps, c) }), horses).outlook.pace;
  assert.equal(f([0.1, 0.65, 0.25], 0.6), 'ミドル（確信度：中間）');
  assert.equal(f([0.05, 0.05, 0.9], 0.95), 'ハイ（確信度：高）');
  assert.equal(f([0.7, 0.2, 0.1], 0.9), 'スロー（確信度：高）');
  assert.equal(f([0.45, 0.1, 0.45], 0.9), '判断できない');
  assert.equal(f([0.1, 0.65, 0.25], 0.49), '判断できない');
  assert.throws(() => f([0.5, 0.5], 0.9));
});
test('overrides と null', () => {
  const parsed = P({ lead_horse: sel('h01', 0.95), early_lead_battle: truth(0.95), pace: grade([0.1, 0.65, 0.25], 0.6) });
  const r = outlookFromAnswers(parsed, horses, { pace: 'ハイ', leader: null });
  assert.deepEqual(r.overridden, ['pace']);
  assert.deepEqual(r.outlook, { note: OUTLOOK_NOTE, expected_leader: '1番 テストアルファ（確信度：高）', early_lead_battle: '激しくなる', pace: 'ハイ' });
  const r2 = outlookFromAnswers(parsed, horses, { leader: '特定できない', battle: 'どちらとも言えない' });
  assert.deepEqual(r2.overridden, ['leader', 'battle']);
  assert.equal(r2.outlook.expected_leader, '特定できない');
  assert.equal(r2.outlook.pace, 'ミドル（確信度：中間）');
  assert.deepEqual(outlookFromAnswers(P({}), horses), { outlook: null, overridden: [] });
  assert.deepEqual(outlookFromAnswers(P({}), horses, {}).outlook, null);
});
test('outlookFromValues：選んだ項目だけを含める', () => {
  assert.equal(outlookFromValues({ leader: '', battle: '', pace: '' }), null);
  assert.deepEqual(outlookFromValues({ pace: '判断できない' }), { note: OUTLOOK_NOTE, pace: '判断できない' });
});

test('フィクスチャの STEP3 レスポンスから展開を作る', () => {
  const D = derive(parse(readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8')));
  const raw = readFileSync(new URL('./fixtures/jev_response_race_outlook.json', import.meta.url), 'utf8');
  const parsed = parseResponse(raw, RACE_OUTLOOK.questions(D));
  const r = outlookFromAnswers(parsed, D.horses);
  // lead_horse: h01 が最大だが confidence 0.57 → 中間。先行争い 0.41 → どちらとも言えない。pace: 段階1 が最大、confidence 0.48 → 判断できない
  assert.equal(r.outlook.expected_leader, `1番 ${D.horses.find(h => h.num === 1).name}（確信度：中間）`);
  assert.equal(r.outlook.early_lead_battle, 'どちらとも言えない');
  assert.equal(r.outlook.pace, '判断できない');
  assert.deepEqual(r.overridden, []);
});
