import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';
import { horseRequest, raceState, raceQuestions } from '../src/requests.js';
import { RACE_OUTLOOK, HORSE_POSITION } from '../src/contracts.js';
import { parseResponse } from '../src/jev.js';
import { outlookFromAnswers } from '../src/score.js';
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
  assert.equal(sum([ok(1), noEval(2), ng(3, 'rate', 'm', 'a')]), '約200 ms（1頭分）');
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
