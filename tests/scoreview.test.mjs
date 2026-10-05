import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreRace } from '../src/score.js';
import { parseResult } from '../src/parse/result.js';
import { formatRate, scoreHtml, paceHtml, summaryHtml } from '../src/scoreview.js';

const readResult = name => parseResult(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const ZK = ['front', 'forward', 'mid', 'rear'];
const ZL = { front: '先頭', forward: '好位', mid: '中団', rear: '後方' };
const answer = (key, level, confidence) => ({
  kind: 'select', selected: ZL[key], choice: key, level, levelLabel: level, confidence,
  probabilities: ZK.map(k => ({ key: k, label: ZL[k], probability: k === key ? 0.7 : 0.1 })),
});
const okRec = (num, first, last) => ({ num, name: `馬${num}`, status: 'ok', firstCorner: first, lastCorner: last });
const lead = (key, p = 0.6) => {
  const keys = ['h01', 'h02', 'h04', 'h05', 'h06', 'h07', 'unclear'];
  return { answers: { lead_horse: { kind: 'select', choice: key, level: 'middle', confidence: 0.6,
    probabilities: keys.map(k => ({ key: k, label: k, probability: k === key ? p : (1 - p) / (keys.length - 1) })) } } };
};
const FIRST_A = { 2: ['front', 'high'], 4: ['forward', 'high'], 5: ['forward', 'middle'], 1: ['mid', 'high'], 7: ['mid', 'middle'], 6: ['rear', 'unclear'] };
const LAST_A = { 2: ['front', 'high'], 5: ['forward', 'high'], 1: ['rear', 'high'], 7: ['mid', 'middle'], 4: ['rear', 'middle'], 6: ['mid', 'unclear'] };
const stage4A = () => ({ results: Object.keys(FIRST_A).map(Number).map(n => okRec(n, answer(FIRST_A[n][0], FIRST_A[n][1], 0.9), answer(LAST_A[n][0], LAST_A[n][1], 0.9))) });
const stage3 = () => ({ ...lead('h05'), answers: { ...lead('h05').answers,
  pace: { selected: 'ハイ', level: 'middle', levelLabel: '中間' }, early_lead_battle: { selected: '激しくなる', level: 'high', levelLabel: '高確信' } } });
const entryA = (name = n => `馬${n}`, over = {}) => ({
  race: { date: '2031-11-02', venue: '東京', raceNo: 11, distance: 1600, surface: '芝', ...over },
  horses: [1, 2, 3, 4, 5, 6, 7].map(n => ({ num: n, name: name(n) })),
});
const resultA = readResult('result_a.txt');
const scoringA = () => scoreRace({ entry: entryA(), stage3: stage3(), stage4: stage4A(), result: resultA });
const htmlA = () => scoreHtml(scoringA(), { stage3: stage3(), result: resultA });

test('(a) formatRate', () => {
  assert.equal(formatRate(5, 6), '5/6（83%）');
  assert.equal(formatRate(0, 0), '—（採点なし）');
  assert.equal(formatRate(1, 3), '1/3（33%）');
  assert.equal(formatRate(2, 3), '2/3（67%）');
});

test('(b) 全体と level 別の正答率', () => {
  const h = summaryHtml(scoringA());
  for (const t of ['8/12（67%）', '5/6（83%）', '2/4（50%）', '1/2（50%）', '高確信', '中間', '判別不能']) assert.ok(h.includes(t), t);
  assert.ok(h.includes(NOTE));
});
const NOTE = 'この採点は1レースの結果で、判定は互いに独立ではありません。一般的な正答率を示すものではありません。';

test('(c) 高確信で外れた馬の一覧', () => {
  const h = htmlA(), i = h.indexOf('高確信で外れた馬');
  assert.ok(i >= 0);
  const row = h.slice(i).match(/<tr><td>1<\/td>.*?<\/tr>/)[0];
  assert.ok(row.includes('最後のコーナー') && row.includes('<td>後方</td><td>中団</td>'));
});

test('(d) ペースと先行争いの欄は事実だけで、採点の表示を含まない', () => {
  const h = paceHtml(scoringA(), stage3());
  for (const t of ['ペースと先行争いは採点しません', '35.6', '34.9', '−0.7', 'ハイ', '激しくなる']) assert.ok(h.includes(t), t);
  for (const t of ['正解', '○', '×']) assert.ok(!h.includes(t), t);
  assert.ok(paceHtml(scoringA(), null).includes('STEP3 が未実行'));
});

test('(e) 馬名の HTML の特殊文字はエスケープされる', () => {
  const evil = n => (n === 1 ? '<script>alert(1)</script>' : `馬${n}`);
  const s4 = stage4A();
  s4.results.forEach(r => { r.name = evil(r.num); });
  const res = structuredClone(resultA);
  res.horses.forEach(h => { h.name = evil(h.number); });
  const sc = scoreRace({ entry: entryA(evil), stage3: stage3(), stage4: s4, result: res });
  const h = scoreHtml(sc, { stage3: stage3(), result: res });
  assert.ok(!h.includes('<script>'));
  assert.ok(h.includes('&lt;script&gt;'));
});

test('(f) 形式 B：採点不能が出て、割り算が NaN・Infinity にならない', () => {
  const entry = { race: { date: '2031-11-09', venue: '京都', raceNo: 11, distance: 2000, surface: '芝' }, horses: [1, 3, 4, 5, 6, 8].map(n => ({ num: n, name: `馬${n}` })) };
  const stage4 = { results: entry.horses.map(h => okRec(h.num, answer('mid', 'middle', 0.6), answer('mid', 'middle', 0.6))) };
  const result = readResult('result_b.txt');
  const h = scoreHtml(scoreRace({ entry, stage3: lead('h01'), stage4, result }), { stage3: null, result });
  assert.ok(h.includes('採点不能'));
  assert.ok(h.includes('確定できません'));
  assert.ok(!/NaN|Infinity|undefined|null/.test(h));
  assert.ok(h.includes('—（採点なし）'));
});

test('(g) race_mismatch：採点しないメッセージと違う項目', () => {
  const sc = scoreRace({ entry: entryA(undefined, { raceNo: 12 }), stage3: stage3(), stage4: stage4A(), result: resultA });
  assert.equal(sc.ok, false);
  const h = scoreHtml(sc, { result: resultA });
  assert.ok(h.includes('採点しません'));
  assert.ok(h.includes('レース番号'));
  assert.ok(!h.includes('集計'));
});
