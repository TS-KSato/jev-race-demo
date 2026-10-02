import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';
import { horseRequest } from '../src/requests.js';
import { HORSE_POSITION } from '../src/contracts.js';
import { parseResponse, estimateCostUsd } from '../src/jev.js';
import { handleRelay } from '../src/relay.js';
import { buildRelayBody } from '../src/client.js';
import { runStage4, summarizeStage4, isStale } from '../src/stage4.js';

const KEY = 'dummy-api-key-not-real-0000';
const PASS = 'dummy-password-not-real-0000';
const D = derive(parse(readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8')));
const OL = { note: 'テスト用', expected_leader: '1番 テストアルファ', early_lead_battle: '激しくなる', pace: 'ミドル' };
const clone = v => JSON.parse(JSON.stringify(v));
const buildFor = ol => h => horseRequest(D, h, ol);
const zq = HORSE_POSITION.questions(D, D.horses[0], null);
const parseFn = text => parseResponse(text, zq);

const keys = Object.keys(zq.first_corner.criteria);
function answer(choice = keys[0]) {
  const probabilities = {};
  keys.forEach(k => { probabilities[k] = k === choice ? 0.7 : 0.3 / (keys.length - 1); });
  return { type: 'choice', choice, confidence: 0.7, probabilities, stats: {} };
}
const responseText = (extra = {}) => JSON.stringify({
  model: 'jev-1.13.0', answers: { first_corner: answer(), last_corner: answer(keys[1]) },
  usage: { input_tokens: 1000, output_tokens: 20 }, evaluation_time_ms: 300, ...extra });
const nameOf = ({ state }) => state.target.number;

function mockCall(behaviour = () => responseText()) {
  const log = { order: [], inflight: 0, maxInflight: 0 };
  const callOne = async req => {
    const n = nameOf(req);
    log.order.push(n);
    log.inflight++; log.maxInflight = Math.max(log.maxInflight, log.inflight);
    await new Promise(r => setTimeout(r, 1));
    log.inflight--;
    const b = behaviour(n, log.order.length);
    if (b instanceof Error) throw b;
    return b;
  };
  return { callOne, log };
}
const kindErr = (kind, msg = 'エラー') => Object.assign(new Error(msg), { kind });
const run = (m, opts = {}) => runStage4({ horses: D.horses, buildFor: buildFor(null), callOne: m.callOne, parse: parseFn, ...opts });

test('通し：全頭の本文が handleRelay を通る（race_outlook あり・なし）', async () => {
  assert.equal(D.horses.length, 8);
  for (const ol of [OL, null]) {
    for (const h of D.horses) {
      const { state, questions } = buildFor(ol)(h);
      const bodyText = buildRelayBody(HORSE_POSITION.label, clone(state), clone(questions));
      let sent = 0;
      const out = await handleRelay({ method: 'POST', headers: { 'X-Demo-Password': PASS }, bodyText,
        env: { TYPESAFE_API_KEY: KEY, DEMO_PASSWORD: PASS }, fetchImpl: async () => { sent++; return new Response(responseText(), { status: 200 }); } });
      assert.equal(out.status, 200, `${h.num}番 ${ol ? 'あり' : 'なし'}`);
      assert.equal(sent, 1);
    }
  }
});

test('1頭ずつ順番に、馬番の昇順で呼ばれる', async () => {
  const m = mockCall();
  const shuffled = [...D.horses].reverse();
  await runStage4({ horses: shuffled, buildFor: buildFor(null), callOne: m.callOne, parse: parseFn });
  assert.deepEqual(m.log.order, D.horses.map(h => h.num).sort((a, b) => a - b));
  assert.equal(m.log.maxInflight, 1);
});

test('全頭成功', async () => {
  const events = [];
  const r = await run(mockCall(), { onProgress: e => events.push(e.type) });
  assert.equal(r.results.length, 8);
  assert.ok(r.results.every(x => x.status === 'ok' && x.parsed && x.at && typeof x.raw === 'string'));
  assert.equal(r.aborted, null);
  assert.equal(r.cancelled, false);
  assert.equal(events.filter(t => t === 'start').length, 8);
  assert.equal(events.at(-1), 'finish');
});

test('upstream で1頭失敗しても残りは実行される', async () => {
  const m = mockCall(n => (n === D.horses[2].num ? kindErr('upstream') : responseText()));
  const r = await run(m);
  assert.equal(m.log.order.length, 8);
  assert.deepEqual(r.results.map(x => x.status), ['ok', 'ok', 'failed', 'ok', 'ok', 'ok', 'ok', 'ok']);
  assert.equal(r.results[2].errorKind, 'upstream');
  assert.equal(r.aborted, null);
});

for (const kind of ['auth', 'config', 'contract', 'size', 'rate']) {
  test(`kind ${kind} で全体が中止される`, async () => {
    const m = mockCall(n => (n === D.horses[1].num ? kindErr(kind, '原因') : responseText()));
    const r = await run(m);
    assert.equal(m.log.order.length, 2);
    assert.deepEqual(r.results.map(x => x.status), ['ok', 'failed', ...Array(6).fill('skipped')]);
    assert.equal(r.aborted.kind, kind);
    assert.equal(r.aborted.message, '原因');
  });
}

test('network・other は継続する', async () => {
  const m = mockCall(n => (n === D.horses[0].num ? kindErr('network') : n === D.horses[1].num ? new Error('x') : responseText()));
  const r = await run(m);
  assert.equal(m.log.order.length, 8);
  assert.equal(r.results[0].errorKind, 'network');
  assert.equal(r.results[1].errorKind, 'other');
});

test('first_corner が欠けた応答は other の失敗で、次に進む', async () => {
  const bad = JSON.stringify({ model: 'jev-1.13.0', answers: { last_corner: answer() } });
  const m = mockCall(n => (n === D.horses[0].num ? bad : responseText()));
  const r = await run(m);
  assert.equal(r.results[0].status, 'failed');
  assert.equal(r.results[0].errorKind, 'other');
  assert.equal(r.results[1].status, 'ok');
  assert.equal(r.aborted, null);
});

test('shouldCancel で、実行中の馬の完了後に止まる', async () => {
  const m = mockCall();
  const r = await run(m, { shouldCancel: () => m.log.order.length >= 3 });
  assert.equal(m.log.order.length, 3);
  assert.deepEqual(r.results.map(x => x.status), ['ok', 'ok', 'ok', ...Array(5).fill('skipped')]);
  assert.equal(r.cancelled, true);
});

test('onlyNums の再実行：指定した馬だけ呼ばれ、成功結果は変わらない', async () => {
  const first = await run(mockCall(n => (n === D.horses[3].num ? kindErr('upstream') : responseText())));
  const previous = Object.fromEntries(first.results.map(r => [r.num, r]));
  const m = mockCall();
  const r = await run(m, { previous, onlyNums: [D.horses[3].num] });
  assert.deepEqual(m.log.order, [D.horses[3].num]);
  assert.equal(r.results[3].status, 'ok');
  r.results.forEach((x, i) => { if (i !== 3) assert.equal(x, previous[x.num]); });
});

test('summarizeStage4：評価時間が不明な馬を 0 として足さない', () => {
  const mk = (num, p) => ({ num, name: 'x', status: 'ok', parsed: { inputTokens: 1, outputTokens: 1, ...p } });
  const some = summarizeStage4([mk(1, { evaluationTimeMs: 300 }), mk(2, { evaluationTimeMs: null })], t => t);
  assert.equal(some.evaluationTimeMs, 300);
  assert.equal(some.evaluationTimeKnownCount, 1);
  const none = summarizeStage4([mk(1, { evaluationTimeMs: null })], t => t);
  assert.equal(none.evaluationTimeMs, null);
  assert.equal(none.evaluationTimeKnownCount, 0);
});

test('summarizeStage4：手計算の期待値', () => {
  const mk = (num, status, p) => ({ num, name: 'x', status, parsed: p ?? null });
  const results = [
    mk(1, 'ok', { inputTokens: 1000, outputTokens: 20, evaluationTimeMs: 300 }),
    mk(2, 'ok', { inputTokens: 3000, outputTokens: 40, evaluationTimeMs: 500 }),
    mk(3, 'ok', { inputTokens: null, outputTokens: null, evaluationTimeMs: 100 }),
    mk(4, 'failed'), mk(5, 'skipped'), mk(6, 'skipped'),
  ];
  const s = summarizeStage4(results, t => t * 2);
  assert.deepEqual(s, { okCount: 3, failedCount: 1, skippedCount: 2, inputTokens: 4000, outputTokens: 60, evaluationTimeMs: 900, evaluationTimeKnownCount: 3, costUsd: 8000, excludedCount: 1 });
  const real = summarizeStage4(results, estimateCostUsd);
  assert.ok(Math.abs(real.costUsd - 4000 * 0.042 / 1e6) < 1e-12);
});

test('isStale', () => {
  assert.equal(isStale(clone(OL), clone(OL)), false);
  assert.equal(isStale(OL, { ...OL, pace: 'ハイ' }), true);
  assert.equal(isStale(OL, { note: OL.note, expected_leader: OL.expected_leader }), true);
  assert.equal(isStale(null, null), false);
  assert.equal(isStale(null, OL), true);
  assert.equal(isStale(OL, null), true);
});

test('エラーメッセージ・console に合言葉と応答の全文が出ない', async () => {
  const logged = [];
  const orig = {};
  for (const k of ['log', 'error', 'warn', 'info']) { orig[k] = console[k]; console[k] = (...a) => logged.push(a.join(' ')); }
  const secret = `SECRET-RESPONSE-${PASS}`;
  let r;
  try { r = await run(mockCall(() => secret)); } finally { Object.assign(console, orig); }
  assert.equal(logged.length, 0);
  assert.ok(r.results.every(x => x.status === 'failed'));
  assert.ok(r.results.every(x => !x.errorMessage.includes('SECRET') && !x.errorMessage.includes(PASS) && x.raw === null));
});
