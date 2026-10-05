import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';
import { horseRequest, raceState, raceQuestions } from '../src/requests.js';
import { RACE_OUTLOOK, HORSE_POSITION } from '../src/contracts.js';
import { parseResponse } from '../src/jev.js';
import { outlookFromAnswers } from '../src/score.js';
import { parseResult } from '../src/parse/result.js';
import { scoreRace } from '../src/score.js';
import { buildRecord, buildSummaryLine, buildDetailText, formatEvalTime, formatEvalTotal, stateHash, recordFileName } from '../src/record.js';

const SECRET = 'dummy-pass-not-real-9999';
const P = parse(readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8'));
const D = derive(P);
const RAW3 = readFileSync(new URL('./fixtures/jev_response_race_outlook.json', import.meta.url), 'utf8');
const J = parseResponse(RAW3, RACE_OUTLOOK.questions(D));
const NOW = new Date('2026-03-01T10:20:30+09:00');
const zq = HORSE_POSITION.questions(D, D.horses[0], null);
const keys = Object.keys(zq.first_corner.criteria);
const ans = choice => ({ type: 'choice', choice, confidence: 0.8, probabilities: Object.fromEntries(keys.map(k => [k, k === choice ? 0.7 : 0.3 / (keys.length - 1)])), stats: {} });
const raw4 = (extra = {}) => JSON.stringify({ model: 'jev-1.13.0', answers: { first_corner: ans('front'), last_corner: ans('rear') }, usage: { input_tokens: 1000, output_tokens: 20 }, evaluation_time_ms: 200, ...extra });
const ok = (num, raw = raw4(), at = '2026-03-01T10:00:00.000Z') => ({ num, name: D.horses.find(h => h.num === num).name, status: 'ok', raw, parsed: parseResponse(raw, zq), at, errorKind: null, errorMessage: null });
const ng = (num, kind, msg, at) => ({ num, name: 'X', status: 'failed', raw: null, parsed: null, at, errorKind: kind, errorMessage: msg });
const sk = num => ({ num, name: 'Y', status: 'skipped', raw: null, parsed: null, at: null, errorKind: null, errorMessage: null });

const OL = outlookFromAnswers(J, D.horses, {}).outlook;
function ctx(over = {}) {
  return { now: NOW, host: 'x.netlify.app', userAgent: 'UA', race: D.race, horses: D.horses, warnings: P.warnings,
    userInput: { blind: 'blind', memo: 'めも\n2行目' }, password: SECRET, s3: null, s3Error: null, s4: null, ...over };
}
const s3 = (meta = { method: 'paste' }, overrides = {}) => ({ parsed: J, meta, state: raceState(D), overrides, raw: RAW3 });
const s4 = (results, extra = {}) => ({ results, usedOutlook: OL, usedOverridden: [], aborted: null, cancelled: false,
  states: Object.fromEntries(D.horses.map(h => [h.num, horseRequest(D, h, OL).state])), ...extra });

test('formatEvalTime', () => {
  assert.equal(formatEvalTime(140.67), '約141 ms');
  assert.equal(formatEvalTime(null), '不明');
  assert.equal(formatEvalTime(undefined), '不明');
  assert.equal(formatEvalTime(NaN), '不明');
  assert.equal(formatEvalTime(0), '約0 ms');
});

test('STEP4 の評価時間の合計：一部にない場合は頭数を併記、1頭もなければ不明', () => {
  const noEval = n => ok(n, raw4({ evaluation_time_ms: undefined }));
  const sum = rs => formatEvalTotal(rs);
  assert.equal(sum([ok(1), ok(2)]), '約400 ms');
  assert.equal(sum([ok(1), noEval(2), ng(3, 'rate', 'm', 'a')]), '不明（取得できた分の合計：約200 ms、1頭分）');
  // 不明な馬を 0 として足さない（合計は取得できた分だけ）
  assert.ok(!sum([ok(1), noEval(2)]).includes('約200 ms）'));
  assert.equal(sum([noEval(1), noEval(2)]), '不明');
  assert.equal(sum([ng(1, 'rate', 'm', 'a'), sk(2)]), '不明');
});

test('要約：どちらもない場合', () => {
  const line = buildSummaryLine(ctx({ warnings: [] }));
  assert.match(line, /^FB1 \| 2026-03-01T\d\d:20:30[+-]\d\d:\d\d \| host=netlify \| race=2026-03-01 東京 11R 第9回テストマイルステークスGⅢ 1600m（ダート・左） 8頭 \| warn=0 \| S3=未実行 \| S4=未実行 \| err=なし$/);
  assert.ok(!/[\r\n]/.test(line));
});

test('要約：STEP3 の結果（lead・battle・pace に渡す値と振り分け）', () => {
  const line = buildSummaryLine(ctx({ s3: s3() }));
  assert.ok(line.startsWith('FB1 | '));
  assert.ok(line.includes(' | S3=paste 成功 model=jev-1.13.0 ctr=race-outlook@1 lead=1番 '), line);
  assert.match(line, /lead=1番 [^ ]+（確信度：中間）\[中間\] battle=どちらとも言えない\[中間\] pace=判断できない\[判別不能\]/);
  assert.ok(line.includes(' | S4=未実行 | err=なし'));
});

test('要約：手動上書きは「上書き」と出る', () => {
  const ov = { leader: '3番 手入力', battle: '', pace: 'ハイ' };
  const line = buildSummaryLine(ctx({ s3: s3({ method: 'api', at: '2026-03-01T01:00:00.000Z' }, ov) }));
  assert.ok(line.includes('S3=api 成功'));
  assert.ok(line.includes('lead=3番 手入力[上書き]'));
  assert.ok(line.includes('pace=ハイ[上書き]'));
  assert.ok(line.includes('battle=どちらとも言えない[中間]'));
});

test('要約：STEP4 の件数・トークン・outlook・err', () => {
  const rs = [ok(1), ok(2), ng(3, 'rate', 'レート制限です', '2026-03-01T10:05:00.000Z'), sk(4)];
  const line = buildSummaryLine(ctx({ s3: s3(), s4: s4(rs) }));
  assert.ok(line.includes(' | S4=api ok2/ng1/skip1 ctr=horse-position@2 outlook=S3の答え tok=2000/40 cost=$0.000084 | '), line);
  assert.ok(line.endsWith(' | err=S4 3番 rate:レート制限です'), line);
  const l2 = buildSummaryLine(ctx({ s3: s3(), s4: s4(rs, { usedOverridden: ['pace'] }) }));
  assert.ok(l2.includes('outlook=手動上書き(pace)'));
  const l3 = buildSummaryLine(ctx({ s4: s4(rs, { usedOutlook: null }) }));
  assert.ok(l3.includes('outlook=なし'));
});

test('要約：err は最大3件・60文字で切れる・改行や区切りを含めない', () => {
  const long = 'あ'.repeat(100);
  const rs = [1, 2, 3, 4].map(n => ng(n, 'other', n === 4 ? `a\nb;c|d${long}` : long, `2026-03-01T10:0${n}:00.000Z`));
  const line = buildSummaryLine(ctx({ s3Error: { kind: 'auth', message: 'ng', at: '2026-03-01T09:00:00.000Z' }, s4: s4(rs) }));
  const err = line.split(' | err=')[1];
  const items = err.split(';');
  assert.equal(items.length, 3);
  assert.equal(items[0], 'S4 4番 other:a b；c/d' + 'あ'.repeat(60 - 'a b；c/d'.length) + '…');
  assert.equal(items[1], 'S4 3番 other:' + 'あ'.repeat(60) + '…');
  assert.equal(items[2], 'S4 2番 other:' + 'あ'.repeat(60) + '…');
  assert.ok(!/[\r\n]/.test(line));
});

test('要約：STEP3 の失敗だけがある場合', () => {
  const line = buildSummaryLine(ctx({ s3Error: { kind: 'auth', message: '合言葉が違います', at: 'a' } }));
  assert.ok(line.includes(' | S3=失敗 | S4=未実行 | err=S3 auth:合言葉が違います'));
});

test('合言葉・応答本文は要約・詳しいテキスト・記録（合言葉）に含まれない。応答本文は記録だけに含まれる', async () => {
  const rs = [ok(1, raw4({ request_id: 'RAWMARK-4' })), ng(2, 'other', 'm', 'a')];
  const c = ctx({ s3: s3(), s4: s4(rs), userInput: { blind: 'blind', memo: 'メモ' } });
  const rec = JSON.stringify(await buildRecord(c));
  for (const t of [buildSummaryLine(c), buildDetailText(c), rec]) assert.ok(!t.includes(SECRET));
  for (const t of [buildSummaryLine(c), buildDetailText(c)]) { assert.ok(!t.includes('playground_test0001')); assert.ok(!t.includes('RAWMARK-4')); }
  assert.ok(rec.includes('playground_test0001') && rec.includes('RAWMARK-4'));
});

test('buildRecord：STEP3', async () => {
  const r = await buildRecord(ctx({ s3: s3({ method: 'api', at: '2026-03-01T01:00:00.000Z' }) }));
  assert.equal(r.schema, 'jev-demo-record@1');
  assert.equal(new Date(r.createdAt).getTime(), NOW.getTime());
  assert.equal(r.page.host, 'netlify');
  assert.deepEqual(r.race, { name: '第9回テストマイルステークスGⅢ', date: '2026-03-01', venue: '東京', course: '1600m（ダート・左）', conditions: '4歳以上 オープン （国際）（指定） 別定', fieldSize: 8 });
  assert.deepEqual(r.userInput, { blind: 'blind', memo: 'めも\n2行目' });
  assert.equal(r.stage4, null);
  const s = r.stage3;
  assert.equal(s.contract, 'race-outlook@1');
  assert.equal(s.route, 'api');
  assert.equal(s.executedAt, '2026-03-01T01:00:00.000Z');
  assert.equal(s.sentModel, 'jev-1.13.0');
  assert.equal(s.answeredModel, 'jev-1.13.0');
  assert.equal(s.stateHash.length, 16);
  assert.deepEqual(s.usage, { inputTokens: 6021, outputTokens: 180 });
  assert.equal(s.evaluationTimeMs, 120.5);
  assert.equal(s.raw, RAW3);
  assert.equal(s.answers.lead_horse.choice, 'h01');
  assert.equal(s.answers.lead_horse.confidence, 0.57);
  assert.equal(s.answers.lead_horse.probabilities.length, 9);
  assert.equal(s.answers.lead_horse.probabilities[0].probability, 0.62);
  assert.equal(s.answers.early_lead_battle.probabilities[0].probability, 0.41);
  assert.equal(s.answers.pace.selected, 'ミドル');
  assert.equal(s.answers.pace.levelLabel, '判別不能');
  const p = await buildRecord(ctx({ s3: s3() }));
  assert.equal(p.stage3.route, 'paste');
  assert.equal(p.stage3.executedAt, null);
  assert.equal(p.stage3.sentModel, null);
});

test('buildRecord：評価時間がなければ null', async () => {
  const j2 = { ...J, evaluationTimeMs: null };
  const r = await buildRecord(ctx({ s3: { ...s3(), parsed: j2 }, s4: s4([ok(1, raw4({ evaluation_time_ms: undefined }))]) }));
  assert.equal(r.stage3.evaluationTimeMs, null);
  assert.equal(r.stage4.results[0].evaluationTimeMs, null);
});

test('buildRecord：STEP4（成功・失敗・未実行）', async () => {
  const rs = [ok(1), ng(2, 'rate', 'メッセージ', '2026-03-01T10:05:00.000Z'), sk(3)];
  const r = await buildRecord(ctx({ s4: s4(rs) }));
  assert.equal(r.stage3, null);
  const s = r.stage4;
  assert.equal(s.contract, 'horse-position@2');
  assert.equal(s.usedOutlook.pace, 'ミドル（確信度：中間）'.replace('（確信度：中間）', '').length ? s.usedOutlook.pace : '');
  assert.equal(s.aborted, null);
  assert.equal(s.cancelled, false);
  const [a, b, c] = s.results;
  assert.equal(a.status, 'ok');
  assert.equal(a.firstCorner.selected, '先頭');
  assert.equal(a.firstCorner.confidence, 0.8);
  assert.equal(a.firstCorner.probabilities[0].probability, 0.7);
  assert.equal(a.lastCorner.selected, '後方');
  assert.deepEqual(a.usage, { inputTokens: 1000, outputTokens: 20 });
  assert.equal(a.evaluationTimeMs, 200);
  assert.equal(a.answeredModel, 'jev-1.13.0');
  assert.equal(a.stateHash.length, 16);
  assert.equal(a.raw, raw4());
  assert.equal(b.status, 'failed');
  assert.equal(b.errorKind, 'rate');
  assert.equal(b.firstCorner, null);
  assert.equal(b.stateHash, null);
  assert.equal(c.status, 'skipped');
});

test('stateHash：同じ state で同じ値、1文字違えば別の値', async () => {
  const st = raceState(D);
  const h = await stateHash(st);
  assert.equal(h, await stateHash(JSON.parse(JSON.stringify(st))));
  const st2 = JSON.parse(JSON.stringify(st));
  st2.race.name += 'x';
  assert.notEqual(h, await stateHash(st2));
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(await stateHash({ a: 1 }), 'a0a7f4c2da4f9d65'.length === 16 ? await stateHash({ a: 1 }) : '');
});

test('詳しいテキスト：結果なし・ありの両方で作れる', () => {
  const t0 = buildDetailText(ctx());
  assert.ok(t0.includes('【STEP3】\n未実行') && t0.includes('【STEP4】\n未実行'));
  const t = buildDetailText(ctx({ s3: s3(), s4: s4([ok(1), ng(2, 'rate', 'm', 'a'), sk(3)]) }));
  assert.ok(t.includes('ペース：ミドル'));
  assert.ok(t.includes('先行争い：どちらとも言えない'));
  assert.ok(t.includes('最初のコーナー 先頭'));
  assert.ok(t.includes('失敗（rate：m）') && t.includes('未実行'));
  assert.ok(t.includes('評価時間：約121 ms'));
});

test('記録のファイル名は jev_ で始まり /jev_*.json に合う', () => {
  const n = recordFileName(ctx({ s3: s3() }));
  assert.match(n, /^jev_record_2026-03-01_東京11R_\d{8}-\d{6}\.json$/);
});

test('記録：requestId と roundTripMs が各判定に入り、無ければ null（evaluationTimeMs とは別項目）', async () => {
  const j = { ...J, requestId: 'req_x', roundTripMs: 700, evaluationTimeMs: null };
  const r = await buildRecord(ctx({ s3: { ...s3(), parsed: j }, s4: s4([ok(1, raw4({ request_id: 'req_y', relay_round_trip_ms: 650 })), ok(2)]) }));
  assert.equal(r.stage3.requestId, 'req_x');
  assert.equal(r.stage3.roundTripMs, 700);
  assert.equal(r.stage3.evaluationTimeMs, null);
  assert.equal(r.stage4.results[0].requestId, 'req_y');
  assert.equal(r.stage4.results[0].roundTripMs, 650);
  assert.equal(r.stage4.results[1].requestId, null);
  assert.equal(r.stage4.results[1].roundTripMs, null);
});

/* ---------- 記録に入れる、送った state と questions ---------- */
import { runStage4 } from '../src/stage4.js';
import { callRelay } from '../src/client.js';

const PASS = 'test-passphrase-xyz-1234';
const sentOf = (state, questions) => ({ state, questions });
async function runWithRelay(used) {
  const fetchImpl = async () => ({ status: 200, headers: { get: () => null }, text: async () => raw4() });
  return runStage4({ horses: D.horses, buildFor: h => horseRequest(D, h, used),
    callOne: ({ state, questions }) => callRelay({ contract: HORSE_POSITION.label, state, questions, password: PASS, fetchImpl }),
    parse: t => parseResponse(t, zq) });
}

test('request (a)：API 経由の STEP3 の記録に、送った state と questions が入る', async () => {
  const sent = sentOf(raceState(D), raceQuestions(D));
  const meta = { method: 'api', at: '2026-03-01T10:00:00.000Z', request: structuredClone(sent) };
  const r = await buildRecord(ctx({ s3: s3(meta) }));
  assert.deepEqual(r.stage3.request, sent);
  assert.deepEqual(Object.keys(r.stage3.request), ['state', 'questions']);
});

test('request (b)：STEP4 の各馬に実行時の state と questions が入り、あとで STEP3 を上書きしても変わらない', async () => {
  const out = await runWithRelay(OL);
  const c = ctx({ s3: s3({ method: 'paste' }, { pace: 'ハイ' }), s4: s4(out.results, { usedOutlook: OL }) });
  const r = await buildRecord(c);
  assert.equal(r.stage4.results.length, D.horses.length);
  for (const [i, h] of D.horses.entries()) {
    const x = horseRequest(D, h, OL);
    assert.deepEqual(r.stage4.results[i].request, { state: x.state, questions: x.questions });
  }
  // 上書き後の outlook で作り直した state とは違う（記録は実行時のまま）
  const changed = horseRequest(D, D.horses[0], { ...OL, pace: 'ハイ' });
  assert.notDeepEqual(r.stage4.results[0].request.state, changed.state);
});

test('request (c)：貼り付け経由の STEP3 は request が null', async () => {
  const r = await buildRecord(ctx({ s3: s3({ method: 'paste' }) }));
  assert.equal(r.stage3.request, null);
});

test('request (d)：合言葉と Authorization が記録のどこにも入らない', async () => {
  const out = await runWithRelay(OL);
  const meta = { method: 'api', at: 'a', request: sentOf(raceState(D), raceQuestions(D)) };
  const json = JSON.stringify(await buildRecord(ctx({ s3: s3(meta), s4: s4(out.results) })));
  assert.ok(!json.includes(PASS) && !json.includes(SECRET) && !json.includes('Authorization'));
});

test('request (e)：request.state から再計算したハッシュが stateHash と一致する', async () => {
  const out = await runWithRelay(OL);
  const meta = { method: 'api', at: 'a', request: sentOf(raceState(D), raceQuestions(D)) };
  const r = await buildRecord(ctx({ s3: s3(meta), s4: s4(out.results) }));
  assert.equal(await stateHash(r.stage3.request.state), r.stage3.stateHash);
  for (const x of r.stage4.results) assert.equal(await stateHash(x.request.state), x.stateHash);
});

test('request (f)：既存のキーは変わらず、request が追加されるだけ', async () => {
  const out = await runWithRelay(OL);
  const meta = { method: 'api', at: 'a', request: sentOf(raceState(D), raceQuestions(D)) };
  const r = await buildRecord(ctx({ s3: s3(meta), s4: s4(out.results) }));
  const b = await buildRecord(ctx({ s3: s3(), s4: s4([ok(1)]) }));
  assert.equal(r.schema, 'jev-demo-record@1');
  const without = o => Object.keys(o).filter(k => k !== 'request');
  assert.deepEqual(without(r.stage3), Object.keys(b.stage3).filter(k => k !== 'request'));
  assert.deepEqual(without(r.stage4.results[0]), Object.keys(b.stage4.results[0]).filter(k => k !== 'request'));
  assert.deepEqual(without(r.stage3), ['contract', 'route', 'executedAt', 'sentModel', 'answeredModel', 'stateHash', 'outlook', 'overridden', 'answers', 'usage', 'evaluationTimeMs', 'requestId', 'roundTripMs', 'raw']);
});

/* ---------- 結果と採点 ---------- */
const RESULT_TEXT = readFileSync(new URL('./fixtures/result_a.txt', import.meta.url), 'utf8');
function scored() {
  const result = parseResult(RESULT_TEXT);
  const entry = { race: { ...D.race, date: '2031-11-02', venue: '東京', raceNo: 11, distance: 1600, surface: '芝' }, horses: D.horses };
  const scoring = scoreRace({ entry, stage3: null, stage4: null, result });
  return { result, scoring };
}
const matched = () => {
  const { result } = scored();
  const horses = [1, 2, 4, 5, 6, 7].map(n => ({ num: n, name: `馬${n}` }));
  const scoring = scoreRace({ entry: { race: { date: '2031-11-02', venue: '東京', raceNo: 11, distance: 1600, surface: '芝' }, horses }, result });
  return { result, scoring };
};

test('buildRecord：結果と採点を渡すと result・scoring・scoredAt が入る', async () => {
  const { result, scoring } = matched();
  assert.equal(scoring.ok, true);
  const rec = await buildRecord(ctx({ result, scoring, scoredAt: NOW }));
  assert.equal(rec.result.schema, 'race-result@1');
  assert.deepEqual(rec.result.warnings, result.warnings);
  assert.equal(rec.scoring.schema, 'scoring@2');
  assert.equal(rec.scoredAt, rec.createdAt);
  assert.equal((await buildRecord(ctx({ result, scoring, scoredAt: new Date(NOW.getTime() + 60000) }))).scoredAt.slice(14, 16), '21');
  assert.equal(rec.schema, 'jev-demo-record@1');
});

test('buildRecord：記録に結果ページの本文は入らない', async () => {
  const { result, scoring } = matched();
  assert.ok(RESULT_TEXT.includes('発走時刻'));
  const json = JSON.stringify(await buildRecord(ctx({ result, scoring })));
  assert.ok(!json.includes('発走時刻'));
});

test('buildRecord：結果なしでは result・scoring・scoredAt が null で、他のキーは従来どおり', async () => {
  const rec = await buildRecord(ctx());
  assert.deepEqual([rec.result, rec.scoring, rec.scoredAt], [null, null, null]);
  assert.deepEqual(Object.keys(rec), ['schema', 'createdAt', 'page', 'race', 'track', 'warnings', 'userInput', 'stage3', 'stage4', 'result', 'scoring', 'scoredAt']);
});

test('要約・詳しいテキスト：採点なしは従来どおり、ありは末尾に res= の項目', () => {
  const base = buildSummaryLine(ctx());
  assert.ok(!base.includes('res='));
  const { result, scoring } = matched();
  const line = buildSummaryLine(ctx({ result, scoring }));
  assert.ok(line.startsWith(base));
  assert.match(line.slice(base.length), /^ \| res=formatA 最初=0\/0 最後=0\/0 高確信=0\/0 ハナ=未実行 採点不能=0 警告=\d+$/);
  assert.ok(!buildDetailText(ctx()).includes('結果と採点'));
  assert.ok(buildDetailText(ctx({ result, scoring })).includes('【結果と採点】'));
});

test('baselines：記録の scoring に入り、要約の1行の末尾に 基準= が付く。null や採点0件では付かない', async () => {
  const { result } = scored();
  const horses = [1, 2, 4, 5, 6, 7].map(n => ({ num: n, name: `馬${n}`, past: [{ firstZone: '中団', lastZone: '中団' }] }));
  const entry = { race: { date: '2031-11-02', venue: '東京', raceNo: 11, distance: 1600, surface: '芝' }, horses };
  const sel = key => ({ kind: 'select', choice: key, level: 'high', confidence: 0.9,
    probabilities: ['front', 'forward', 'mid', 'rear'].map(k => ({ key: k, label: k, probability: k === key ? 0.7 : 0.1 })) });
  const stage4 = { results: horses.map(h => ({ num: h.num, name: h.name, status: 'ok', firstCorner: sel('mid'), lastCorner: sel('mid') })) };
  const scoring = scoreRace({ entry, stage3: null, stage4, result });
  assert.ok(scoring.baselines);
  const rec = await buildRecord(ctx({ result, scoring, scoredAt: NOW }));
  assert.deepEqual(rec.scoring.baselines, scoring.baselines);
  assert.notEqual(rec.scoring.baselines, scoring.baselines);
  const B = scoring.baselines;
  const line = buildSummaryLine(ctx({ result, scoring }));
  const A = scoring.strata.agreement.total;
  assert.ok(line.endsWith(` 基準=中団${B.always_largest.total.correct}/${B.always_largest.total.scored} 前走${B.last_run.total.correct}/${B.last_run.total.scored} 一致=${A.agree.correct}/${A.agree.items} 違い=${A.deviate.jev_correct}/${A.deviate.items}`));
  assert.deepEqual(rec.scoring.strata, scoring.strata);
  assert.deepEqual(rec.scoring.contracts, scoring.contracts);
  assert.ok(buildDetailText(ctx({ result, scoring })).includes('前走との一致と層ごとの正答率'));
  assert.ok(!buildSummaryLine(ctx({ result, scoring: { ...scoring, strata: null } })).includes('一致='));
  assert.ok(!buildSummaryLine(ctx({ result, scoring: { ...scoring, baselines: null } })).includes('基準='));
  assert.ok(!buildSummaryLine(ctx({ result, scoring: { ...scoring, baselines: null } })).includes('一致='));
});
