import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreRace } from '../src/score.js';
import { parseResult } from '../src/parse/result.js';

/* 架空の結果（result_a.txt）に、手で作った過去走を持つ馬を当てて、手計算の数と照らす */
const result = parseResult(readFileSync(new URL('./fixtures/result_a.txt', import.meta.url), 'utf8'));
const ZK = ['front', 'forward', 'mid', 'rear'];
const sel = key => ({ kind: 'select', choice: key, level: 'high', confidence: 0.9,
  probabilities: ZK.map(k => ({ key: k, label: k, probability: k === key ? 0.7 : 0.1 })) });
// 予測（first, last）。実際は 1:中団/中団 2:先頭/先頭 4:好位/後方 5:中団/好位 6:後方/後方 7:後方/中団
const PRED = { 1: ['mid', 'rear'], 2: ['front', 'front'], 4: ['forward', 'rear'], 5: ['forward', 'forward'], 6: ['rear', 'mid'], 7: ['mid', 'mid'] };
const stage4 = () => ({ contract: 'horse-position@3', results: Object.entries(PRED).map(([n, [f, l]]) =>
  ({ num: +n, name: `馬${n}`, status: 'ok', firstCorner: sel(f), lastCorner: sel(l) })) });
const run = (f, l) => ({ firstZone: f, lastZone: l });
const HORSES = {
  1: { facts: { ranCount: 5 }, past: [run('中団', '後方'), run('好位', '中団'), run('先頭', '先頭')] },
  2: { facts: { ranCount: 3 }, past: [run('先頭', '先頭'), run('先頭', '先頭'), run('先頭', '先頭')] },
  4: { past: [run('好位', '好位'), run('中団', '後方'), { finish: '取消' }] }, // facts なし：取消を除いて2
  5: { facts: { ranCount: 4 }, past: [run('先頭', '好位'), run('中団', '中団'), run('後方', '後方')] },
  6: { facts: { ranCount: 5 }, past: [run('後方', '後方'), run('後方', '中団'), run('後方', undefined)] }, // first は3走、last は2走
  7: { past: [] },
};
const entry = () => ({
  race: { date: '2031-11-02', venue: '東京', raceNo: 11, distance: 1600, surface: '芝' },
  horses: [1, 2, 3, 4, 5, 6, 7].map(n => ({ num: n, name: `馬${n}`, ...(HORSES[n] ?? { past: [] }) })),
});
const go = (over = {}) => scoreRace({ entry: entry(), stage3: { contract: 'race-outlook@2' }, stage4: stage4(), result, ...over });
const S = (horses, items, jev, largest, wl) => ({ horses, items, jev_correct: jev, always_largest_correct: largest,
  with_last_run: { items: wl[0], jev_correct: wl[1], last_run_correct: wl[2] } });

test('agreement：一致・違い・前走なしの件数と正解数', () => {
  const A = go().strata.agreement;
  assert.deepEqual(A.first_corner, { agree: { items: 4, correct: 4 }, deviate: { items: 1, jev_correct: 0, last_run_correct: 0 }, no_last_run: { items: 1 } });
  assert.deepEqual(A.last_corner, { agree: { items: 3, correct: 2 }, deviate: { items: 2, jev_correct: 1, last_run_correct: 1 }, no_last_run: { items: 1 } });
  assert.deepEqual(A.total, { agree: { items: 7, correct: 6 }, deviate: { items: 3, jev_correct: 1, last_run_correct: 1 }, no_last_run: { items: 2 } });
});

test('実質走数別：2・3・4・5 の馬、facts なし、取消の過去走は数えない', () => {
  const B = go().strata.by_run_count;
  assert.deepEqual(B['0-2'], S(2, 4, 3, 1, [2, 2, 1]));
  assert.deepEqual(B['3'], S(1, 2, 2, 0, [2, 2, 2]));
  assert.deepEqual(B['4+'], S(3, 6, 3, 3, [6, 3, 4]));
});

test('ばらつき別：same・varied・na、コーナーで層が違う馬（6番）', () => {
  const V = go().strata.by_variety;
  assert.deepEqual(V.same, S(2, 3, 3, 0, [3, 3, 3]));
  assert.deepEqual(V.varied, S(2, 4, 2, 3, [4, 2, 2]));
  assert.deepEqual(V.na, S(2, 5, 3, 1, [3, 2, 2]));
});

test('層の項目数の合計は Jev が scored の項目の総数と一致する', () => {
  const r = go(), X = r.strata, sum = g => Object.values(g).reduce((a, s) => a + s.items, 0);
  assert.equal(r.summary.total.scored, 12);
  assert.equal(sum(X.by_run_count), 12);
  assert.equal(sum(X.by_variety), 12);
  assert.equal(X.agreement.total.agree.items + X.agreement.total.deviate.items + X.agreement.total.no_last_run.items, 12);
});

test('contracts・schema・定義・既存の項目', () => {
  const r = go();
  assert.equal(r.schema, 'scoring@2');
  assert.deepEqual(r.contracts, { outlook: 'race-outlook@2', position: 'horse-position@3' });
  assert.deepEqual(Object.keys(r.strata.definitions), ['item', 'last_run', 'run_count', 'variety']);
  assert.deepEqual(go({ stage3: null, stage4: { results: stage4().results } }).contracts, { outlook: null, position: null });
  assert.deepEqual(r.summary.total, { scored: 12, correct: 8, unscorable: 0, missing: 0 });
  assert.equal(r.baselines.last_run.total.no_data, 2);
});

test('失敗時（レースの不一致）は strata・contracts が null', () => {
  const e = entry(); e.race.venue = '京都';
  const r = scoreRace({ entry: e, stage3: null, stage4: stage4(), result });
  assert.equal(r.ok, false);
  assert.equal(r.schema, 'scoring@2');
  assert.equal(r.strata, null);
  assert.equal(r.contracts, null);
});
