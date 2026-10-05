import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreRace } from '../src/score.js';
import { zoneRanges } from '../src/derive.js';
import { parseResult } from '../src/parse/result.js';

const readResult = name => parseResult(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const ZK = ['front', 'forward', 'mid', 'rear'];
const ZL = { front: '先頭', forward: '好位', mid: '中団', rear: '後方' };

/* record.js の describe() が作る答えの形（probabilities は { key, label, probability }） */
const answer = (key, level, confidence, keys = ZK) => ({
  kind: 'select', selected: ZL[key] ?? key, choice: key, level, levelLabel: level, confidence,
  probabilities: keys.map(k => ({ key: k, label: ZL[k] ?? k, probability: k === key ? 0.7 : 0.1 })),
});
const okRec = (num, first, last) => ({ num, name: `馬${num}`, status: 'ok', firstCorner: first, lastCorner: last });
const lead = (key, p = 0.6) => {
  const keys = ['h01', 'h02', 'h04', 'h05', 'h06', 'h07', 'unclear'];
  return { answers: { lead_horse: { kind: 'select', choice: key, level: 'middle', confidence: 0.6,
    probabilities: keys.map(k => ({ key: k, label: k, probability: k === key ? p : (1 - p) / (keys.length - 1) })) } } };
};

const entryA = (over = {}) => ({
  race: { date: '2031-11-02', venue: '東京', raceNo: 11, distance: 1600, surface: '芝', ...over },
  horses: [1, 2, 3, 4, 5, 6, 7].map(n => ({ num: n, name: `馬${n}` })),
});
const FIRST_A = { 2: ['front', 'high'], 4: ['forward', 'high'], 5: ['forward', 'middle'], 1: ['mid', 'high'], 7: ['mid', 'middle'], 6: ['rear', 'unclear'] };
const LAST_A = { 2: ['front', 'high'], 5: ['forward', 'high'], 1: ['rear', 'high'], 7: ['mid', 'middle'], 4: ['rear', 'middle'], 6: ['mid', 'unclear'] };
const stage4A = () => ({ results: Object.keys(FIRST_A).map(Number).map(n =>
  okRec(n, answer(...[FIRST_A[n][0], FIRST_A[n][1], 0.9]), answer(LAST_A[n][0], LAST_A[n][1], 0.9))) });
const resultA = readResult('result_a.txt');
const run = (over = {}) => scoreRace({ entry: entryA(), stage3: lead('h05'), stage4: stage4A(), result: resultA, ...over });
const item = (r, n, c) => r.horses.find(h => h.number === n)[c];

test('(a) 形式 A：馬ごと・集計・取消', () => {
  const r = run();
  assert.equal(r.schema, 'scoring@1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.horses.map(h => h.number), [1, 2, 4, 5, 6, 7]);
  const fc = r.summary.by_corner.first_corner, lc = r.summary.by_corner.last_corner;
  assert.deepEqual([fc.scored, fc.correct], [6, 4]);
  assert.deepEqual([lc.scored, lc.correct], [6, 4]);
  for (const n of [2, 4, 1, 6]) assert.equal(item(r, n, 'first_corner').correct, true);
  for (const n of [5, 7]) assert.deepEqual([item(r, n, 'first_corner').correct, item(r, n, 'first_corner').distance], [false, 1]);
  for (const n of [2, 5, 7, 4]) assert.equal(item(r, n, 'last_corner').correct, true);
  for (const n of [1, 6]) assert.deepEqual([item(r, n, 'last_corner').correct, item(r, n, 'last_corner').distance], [false, 1]);
  assert.deepEqual(r.summary.total, { scored: 12, correct: 8, unscorable: 0, missing: 0 });
  assert.deepEqual(r.summary.by_level, { high: { scored: 6, correct: 5 }, middle: { scored: 4, correct: 2 }, unclear: { scored: 2, correct: 1 } });
  assert.deepEqual(r.summary.high_confidence_misses, [{ number: 1, name: '馬1', corner: 'last_corner', predicted: 'rear', actual: 'mid', confidence: 0.9 }]);
  const cf = r.summary.confusion.first_corner, n = { front: 0, forward: 0, mid: 0, rear: 0 };
  assert.deepEqual(cf, { front: { ...n, front: 1 }, forward: { ...n, forward: 1 }, mid: { ...n, forward: 1, mid: 1 }, rear: { ...n, mid: 1, rear: 1 } });
  assert.deepEqual(r.warnings.map(w => w.code), ['horse_not_started', 'starters_changed']);
  assert.equal(r.n_entry, 7); assert.equal(r.n_result, 6);
  assert.equal(r.facts.pace, resultA.pace);
});

test('(a) 件数の合計は 採点対象の馬 × 2 と一致する', () => {
  const t = run().summary.total;
  assert.equal(t.scored + t.unscorable + t.missing, 6 * 2);
});

test('(b) ハナ：予測と実際、unclear は abstain', () => {
  const r = run();
  assert.deepEqual([r.leader.predicted, r.leader.actual, r.leader.correct, r.leader.status, r.leader.probability], [5, 2, false, 'scored', 0.6]);
  assert.deepEqual(r.leader.step4_front, [2]);
  const u = run({ stage3: lead('unclear') });
  assert.equal(u.leader.predicted, null);
  assert.equal(u.leader.predicted_status, 'abstain');
  assert.equal(u.leader.status, 'abstain');
  assert.equal(u.leader.correct, null);
  const ok = run({ stage3: lead('h02') });
  assert.equal(ok.leader.correct, true);
  assert.equal(run({ stage3: null }).leader.predicted_status, 'missing');
});

test('(c) 形式 B：確定できない区分は unscorable_actual', () => {
  const entry = { race: { date: '2031-11-09', venue: '京都', raceNo: 11, distance: 2000, surface: '芝' }, horses: [1, 3, 4, 5, 6, 8].map(n => ({ num: n, name: `馬${n}` })) };
  const stage4 = { results: entry.horses.map(h => okRec(h.num, answer('mid', 'middle', 0.6), answer('mid', 'middle', 0.6))) };
  const r = scoreRace({ entry, stage3: lead('h01'), stage4, result: readResult('result_b.txt') });
  assert.equal(r.ok, true);
  for (const n of [3, 6]) assert.equal(item(r, n, 'first_corner').status, 'unscorable_actual');
  for (const n of [5, 1]) assert.equal(item(r, n, 'last_corner').status, 'unscorable_actual');
  assert.equal(r.summary.total.unscorable, 4);
  const t = r.summary.total;
  assert.equal(t.scored + t.unscorable + t.missing, 6 * 2);
  assert.equal(r.leader.status, 'unscorable_actual');
  assert.deepEqual(r.leader.candidates, [3, 6]);
});

test('(d) レースが違えば採点しない', () => {
  const r = run({ entry: entryA({ raceNo: 12 }) });
  assert.equal(r.ok, false);
  assert.equal(r.reasons[0].code, 'race_mismatch');
  assert.match(r.reasons[0].message, /レース番号/);
  assert.deepEqual(r.horses, []);
});

test('(e) STEP4 の結果がない馬は missing', () => {
  const s4 = stage4A();
  s4.results = s4.results.filter(x => x.num !== 7);
  const r = run({ stage4: s4 });
  assert.equal(item(r, 7, 'first_corner').status, 'missing');
  assert.equal(item(r, 7, 'last_corner').status, 'missing');
  assert.equal(r.summary.total.missing, 2);
  assert.equal(r.summary.total.scored, 10);
  const failed = stage4A();
  failed.results.find(x => x.num === 7).status = 'failed';
  assert.equal(run({ stage4: failed }).summary.total.missing, 2);
});

test('(f) 確率が同じで最大が2つなら unscorable_predicted', () => {
  const s4 = stage4A();
  const tie = answer('front', 'middle', 0.5);
  tie.probabilities = ZK.map((k, i) => ({ key: k, label: k, probability: i < 2 ? 0.4 : 0.1 }));
  s4.results.find(x => x.num === 2).firstCorner = tie;
  const r = run({ stage4: s4 });
  assert.deepEqual([item(r, 2, 'first_corner').status, item(r, 2, 'first_corner').predicted], ['unscorable_predicted', null]);
  assert.equal(r.summary.total.unscorable, 1);
  assert.equal(r.summary.total.scored, 11);
});

test('未知の選択肢キーは警告して unscorable_predicted', () => {
  const s4 = stage4A();
  s4.results.find(x => x.num === 2).firstCorner = answer('xxx', 'high', 0.9, ['xxx', 'front']);
  const r = run({ stage4: s4 });
  assert.equal(item(r, 2, 'first_corner').status, 'unscorable_predicted');
  assert.ok(r.warnings.some(w => w.code === 'unknown_choice_key'));
});

test('(g) 取消以外の欠けと、出馬表にいない馬の警告', () => {
  const entry = entryA();
  entry.horses = entry.horses.filter(h => h.num !== 3 && h.num !== 6).concat([{ num: 9, name: '馬9' }]);
  const r = run({ entry });
  const codes = r.warnings.map(w => w.code);
  assert.ok(codes.includes('horse_not_started'));
  assert.ok(codes.includes('horse_not_in_entry'));
  assert.ok(r.warnings.find(w => w.code === 'horse_not_in_entry').message.includes('6番'));
  assert.ok(!r.horses.some(h => h.number === 6 || h.number === 9));
});

test('(h) 頭数が違えば starters_changed', () => {
  const r = run();
  const w = r.warnings.find(x => x.code === 'starters_changed');
  assert.ok(w);
  assert.match(w.message, /7頭/);
  assert.match(w.message, /6頭/);
  assert.ok(!run({ entry: { ...entryA(), horses: entryA().horses.filter(h => h.num !== 3) } }).warnings.some(x => x.code === 'starters_changed'));
});

/* ---------- baselines（簡単な基準との比較） ---------- */
const PAST_A = { 2: ['先頭', '先頭'], 4: ['中団', '後方'], 5: ['中団', '中団'], 1: ['好位', '中団'], 7: [null, '中団'], 6: ['後方', null] };
const entryWithPast = (over = {}) => {
  const e = entryA(over);
  for (const h of e.horses) if (PAST_A[h.num]) h.past = [{ firstZone: PAST_A[h.num][0], lastZone: PAST_A[h.num][1] }];
  return e;
};
const runB = (over = {}) => scoreRace({ entry: entryWithPast(), stage3: lead('h05'), stage4: stage4A(), result: resultA, ...over });

test('baselines (a) always_largest：7頭では中団。最初 2/6、最後 2/6', () => {
  const b = runB().baselines.always_largest;
  assert.equal(b.zone, 'mid');
  assert.deepEqual(b.first_corner, { scored: 6, correct: 2 });
  assert.deepEqual(b.last_corner, { scored: 6, correct: 2 });
  assert.deepEqual(b.total, { scored: 12, correct: 4 });
});

test('baselines (b) last_run：過去走に区分がない馬は no_data', () => {
  const b = runB().baselines.last_run;
  assert.deepEqual(b.first_corner, { scored: 5, correct: 3, no_data: 1 });
  assert.deepEqual(b.last_corner, { scored: 5, correct: 4, no_data: 1 });
  assert.deepEqual(b.total, { scored: 10, correct: 7, no_data: 2 });
});

test('baselines (c) jev_same_items：last_run と同じ項目に限った Jev の結果', () => {
  const b = runB().baselines.jev_same_items;
  assert.deepEqual(b.first_corner, { scored: 5, correct: 4 });
  assert.deepEqual(b.last_corner, { scored: 5, correct: 4 });
  assert.deepEqual(b.total, { scored: 10, correct: 8 });
});

test('baselines (d) 実際が確定できない項目は、すべての基準で採点しない', () => {
  const entry = { race: { date: '2031-11-09', venue: '京都', raceNo: 11, distance: 2000, surface: '芝' }, horses: [1, 3, 4, 5, 6, 8].map(n => ({ num: n, name: `馬${n}`, past: [{ firstZone: '中団', lastZone: '中団' }] })) };
  const stage4 = { results: entry.horses.map(h => okRec(h.num, answer('mid', 'middle', 0.6), answer('mid', 'middle', 0.6))) };
  const r = scoreRace({ entry, stage3: lead('h01'), stage4, result: readResult('result_b.txt') });
  const b = r.baselines, t = r.summary.total;
  assert.equal(r.summary.total.unscorable, 4);
  assert.equal(b.always_largest.total.scored, t.scored);
  assert.ok(b.always_largest.total.scored <= t.scored);
  assert.ok(b.last_run.total.scored + b.last_run.total.no_data <= t.scored);
  assert.ok(b.jev_same_items.total.scored <= t.scored);
});

test('baselines (e) 番手の数が最大の区分が複数のとき、順序で先の区分', () => {
  // 6頭：先頭1、好位1、中団2、後方2 で、中団と後方が同数
  assert.deepEqual(zoneRanges(6).map(z => z.to - z.from + 1), [1, 1, 2, 2]);
  const e = { race: entryA().race, horses: [1, 2, 4, 5, 6, 7].map(k => ({ num: k, name: `馬${k}` })) };
  assert.equal(scoreRace({ entry: e, stage3: lead('h05'), stage4: stage4A(), result: resultA }).baselines.always_largest.zone, 'mid');
});

test('baselines (f) ok:false のとき null', () => {
  const r = runB({ entry: entryWithPast({ raceNo: 12 }) });
  assert.equal(r.ok, false);
  assert.equal(r.baselines, null);
});
