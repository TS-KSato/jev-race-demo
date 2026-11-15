import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreRace, consistencyOf, consistencyText, zoneCounts, deviateText } from '../src/score.js';
import { parseResult } from '../src/parse/result.js';
import { scoreHtml, consistencyHtml } from '../src/scoreview.js';

/* ---------- 段階間の矛盾（架空の答え。形は記録の stage3・stage4） ---------- */
const ZK = ['front', 'forward', 'mid', 'rear'];
const sel = key => ({ kind: 'select', choice: key, level: 'high', confidence: 0.9,
  probabilities: ZK.map(k => ({ key: k, label: k, probability: k === key ? 0.7 : 0.1 })) });
const lead = key => ({ contract: 'race-outlook@2', answers: { lead_horse: { kind: 'select', choice: key, level: 'middle', confidence: 0.5,
  probabilities: ['h01', 'h03', 'h05', 'unclear'].map(k => ({ key: k, label: k, probability: k === key ? 0.55 : 0.15 })) } } });
const s4 = firsts => ({ contract: 'horse-position@3', results: Object.entries(firsts).map(([n, f]) => ({ num: +n, status: 'ok', firstCorner: sel(f), lastCorner: sel('mid') })) });

test('STEP3 が3番を先頭とし、STEP4 のどの馬も front と答えない → conflict true', () => {
  const c = consistencyOf(lead('h03'), s4({ 1: 'forward', 3: 'mid', 5: 'rear' }));
  assert.deepStrictEqual(c, { leader_vs_step4_front: { step3_leader: 3, step3_probability: 0.55, step3_level: 'middle', step4_front: [], conflict: true }, step4_front_count: 0 });
  assert.equal(consistencyText(c), 'STEP3 の想定（3番）と STEP4 の答えが一致しません（STEP4 で first_corner が先頭：なし）');
  assert.ok(consistencyHtml(c).includes('STEP3 の想定（3番）と STEP4 の答えが一致しません'));
});

test('STEP4 が3番を front と答える → conflict false', () => {
  const c = consistencyOf(lead('h03'), s4({ 1: 'front', 3: 'front', 5: 'rear' }));
  assert.equal(c.leader_vs_step4_front.conflict, false);
  assert.deepStrictEqual(c.leader_vs_step4_front.step4_front, [1, 3]);
  assert.equal(c.step4_front_count, 2);
  assert.ok(!consistencyHtml(c).includes('一致しません'));
});

test('STEP3 が unclear → step3_leader null、conflict false', () => {
  const c = consistencyOf(lead('unclear'), s4({ 1: 'front' }));
  assert.deepStrictEqual(c.leader_vs_step4_front, { step3_leader: null, step3_probability: null, step3_level: null, step4_front: [1], conflict: false });
});

test('STEP4 が未実行、またはその馬の答えがないときは矛盾とみなさない', () => {
  assert.equal(consistencyOf(lead('h03'), null).leader_vs_step4_front.conflict, false);
  const st = s4({ 1: 'mid' }); st.results.push({ num: 3, status: 'failed', firstCorner: null, lastCorner: null });
  assert.equal(consistencyOf(lead('h03'), st).leader_vs_step4_front.conflict, false);
});

/* ---------- 前走の通過順の個数による層別（scoring@3） ---------- */
const result = parseResult(readFileSync(new URL('./fixtures/result_a.txt', import.meta.url), 'utf8'));
// 予測（first, last）。実際は 1:中団/中団 2:先頭/先頭 4:好位/後方 5:中団/好位 6:後方/後方 7:後方/中団
const PRED = { 1: ['mid', 'rear'], 2: ['front', 'front'], 4: ['forward', 'rear'], 5: ['forward', 'forward'], 6: ['rear', 'mid'], 7: ['mid', 'mid'] };
const stage4 = () => ({ contract: 'horse-position@3', results: Object.entries(PRED).map(([n, [f, l]]) => ({ num: +n, name: `馬${n}`, status: 'ok', firstCorner: sel(f), lastCorner: sel(l) })) });
// 前走の区分に使う過去走の通過順の個数：1番2個、2番3個、4番4個、5番4個、6番 first は2個・last は（2走目の）4個、7番 過去走なし
const HORSES = {
  1: [{ firstZone: '中団', lastZone: '後方', corners: [3, 3] }],
  2: [{ firstZone: '先頭', lastZone: '先頭', corners: [1, 1, 1] }],
  4: [{ firstZone: '好位', lastZone: '後方', corners: [2, 2, 3, 5] }],
  5: [{ firstZone: '先頭', lastZone: '好位', corners: [1, 1, 1, 2] }],
  6: [{ firstZone: '後方', corners: [6, 6] }, { lastZone: '後方', corners: [5, 6, 6, 6] }],
  7: [],
};
const entry = () => ({ race: { date: '2031-11-02', venue: '東京', raceNo: 11, distance: 1600, surface: '芝' },
  horses: [1, 2, 3, 4, 5, 6, 7].map(n => ({ num: n, name: `馬${n}`, past: HORSES[n] ?? [] })) });

test('前走の通過順の個数別：手計算と一致する', () => {
  const r = scoreRace({ entry: entry(), stage3: lead('h02'), stage4: stage4(), result });
  assert.equal(r.schema, 'scoring@3');
  // 3個以下：1f○/前○ 1l×/前× 2f○/前○ 2l○/前○ 6f○/前○ ／ 4個：4f○/前○ 4l○/前○ 5f×/前× 5l○/前○ 6l×/前○ ／ 不明：7f× 7l○
  assert.deepStrictEqual(r.strata.by_last_run_corner_count, {
    '4': { items: 5, jev_correct: 3, last_run_correct: 4 },
    '3-': { items: 5, jev_correct: 4, last_run_correct: 4 },
    unknown: { items: 2, jev_correct: 1, last_run_correct: 0 },
  });
  assert.equal(r.strata.definitions.last_run_corner_count.startsWith('前走の通過順の個数。コーナー別に、前走の区分に使った過去走の通過順の数'), true);
  const h = scoreHtml(r, { result });
  assert.ok(h.includes('前走の通過順の個数別') && h.includes('<td>3個以下</td><td>5</td>'));
});

test('頭数の比較：混同行列から予測と実際の区分ごとの頭数を出す', () => {
  const r = scoreRace({ entry: entry(), stage3: null, stage4: stage4(), result });
  // first：予測 先頭1 好位2 中団2 後方1、実際 先頭1 好位1 中団2 後方2
  assert.deepStrictEqual(zoneCounts(r.summary.confusion.first_corner), { predicted: { front: 1, forward: 2, mid: 2, rear: 1 }, actual: { front: 1, forward: 1, mid: 2, rear: 2 } });
  assert.ok(scoreHtml(r, { result }).includes('予測 先頭1 好位2 中団2 後方1 ／ 実際 先頭1 好位1 中団2 後方2'));
});

test('前走と違えた項目：件数が10未満なら判断できない旨を添える', () => {
  const r = scoreRace({ entry: entry(), stage3: null, stage4: stage4(), result });
  const t = deviateText(r.strata.agreement);
  assert.match(t, /^\d+件、Jev の正解 \d+件、前走の区分の正解 \d+件（件数が少ないため判断できない）$/);
  assert.ok(scoreHtml(r, { result }).includes(`<b>前走と違えた項目</b><span>${t}</span>`));
  assert.ok(!deviateText({ total: { deviate: { items: 10, jev_correct: 4, last_run_correct: 5 } } }).includes('判断できない'));
});

test('scoring@2 の記録（by_last_run_corner_count なし）も表示できる', () => {
  const r = scoreRace({ entry: entry(), stage3: null, stage4: stage4(), result });
  const v2 = { ...structuredClone(r), schema: 'scoring@2', strata: { ...structuredClone(r.strata) } };
  delete v2.strata.by_last_run_corner_count;
  assert.ok(!scoreHtml(v2, { result }).includes('前走の通過順の個数別'));
});

/* ---------- 記録と要約 ---------- */
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';
import { raceState } from '../src/requests.js';
import { RACE_OUTLOOK_V1 } from '../src/contracts.js';
import { parseResponse } from '../src/jev.js';
import { buildRecord, buildSummaryLine, buildDetailText } from '../src/record.js';

test('記録の consistency と、要約（1行・詳しく）の照合の行が同じ値から作られる', async () => {
  const P = parse(readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8')), D = derive(P);
  const RAW = readFileSync(new URL('./fixtures/jev_response_race_outlook.json', import.meta.url), 'utf8');
  const J = parseResponse(RAW, RACE_OUTLOOK_V1.questions(D));
  const ctx = { now: new Date('2026-03-01T10:00:00+09:00'), host: 'localhost', race: D.race, horses: D.horses, warnings: [], userInput: { memo: '' },
    s3: { parsed: J, meta: { method: 'paste' }, state: raceState(D, 'old'), overrides: {}, raw: RAW }, s3Error: null, s4: null };
  const rec = await buildRecord(ctx);
  assert.deepStrictEqual(rec.consistency, consistencyOf(rec.stage3, rec.stage4));
  const L = rec.consistency.leader_vs_step4_front;
  assert.equal(L.conflict, false); // STEP4 未実行は矛盾とみなさない
  assert.ok(buildDetailText(ctx).includes(`【段階間の照合】\n${consistencyText(rec.consistency)}`));
  assert.ok(buildSummaryLine(ctx).includes(` | consist=${L.step3_leader == null ? 'none' : 'na'} lead=${L.step3_leader ?? '-'} s4front=- | `));
});
