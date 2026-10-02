import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';
import { raceState, raceQuestions } from '../src/requests.js';
import { RACE_OUTLOOK } from '../src/contracts.js';
import { handleRelay } from '../src/relay.js';
import { buildRelayBody, callRelay, isRelayAvailable } from '../src/client.js';

const PASS = 'dummy-password-not-real-0000';
const KEY = 'dummy-api-key-not-real-0000';
const D = derive(parse(readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8')));
const state = raceState(D), questions = raceQuestions(D);
const OK_BODY = '{"answers":{},"marker":"ANSWER-TEXT"}';

function seq(...items) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const it = items[Math.min(calls.length - 1, items.length - 1)];
    if (it instanceof Error) throw it;
    return it();
  };
  return { calls, fetchImpl };
}
const resp = (status, body = '', headers = {}) => () => new Response(body, { status, headers });
async function run(items, opts = {}) {
  const m = seq(...items), sleeps = [];
  const p = callRelay({ contract: RACE_OUTLOOK.label, state, questions, password: PASS, fetchImpl: m.fetchImpl, sleepImpl: async ms => { sleeps.push(ms); }, ...opts });
  return { m, sleeps, p };
}
async function failure(items, opts) {
  const { m, sleeps, p } = await run(items, opts);
  const e = await p.then(() => null, e => e);
  assert.ok(e, 'エラーになるはず');
  return { e, m, sleeps };
}

test('buildRelayBody の出力が relay の handleRelay で 400 にならず通る', async () => {
  const bodyText = buildRelayBody(RACE_OUTLOOK.label, state, questions);
  assert.ok(!('model' in JSON.parse(bodyText)));
  let forwarded = 0;
  const out = await handleRelay({
    method: 'POST', headers: { 'X-Demo-Password': PASS }, bodyText,
    env: { TYPESAFE_API_KEY: KEY, DEMO_PASSWORD: PASS },
    fetchImpl: async () => { forwarded++; return new Response(OK_BODY, { status: 200 }); },
  });
  assert.equal(out.status, 200);
  assert.equal(forwarded, 1);
});

test('callRelay：200 で本文がそのまま返り、送信先・ヘッダ・本文が正しい', async () => {
  const { m, p } = await run([resp(200, OK_BODY)]);
  assert.equal(await p, OK_BODY);
  assert.equal(m.calls.length, 1);
  const { url, init } = m.calls[0];
  assert.equal(url, '/.netlify/functions/jev');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['X-Demo-Password'], PASS);
  assert.equal(init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(init.body);
  assert.ok(!('model' in body));
  assert.equal(body.contract, 'race-outlook@1');
});

test('429（Retry-After: 2）の次に 200 → 2秒待って成功する', async () => {
  const retries = [];
  const { m, sleeps, p } = await run([resp(429, '{}', { 'Retry-After': '2' }), resp(200, OK_BODY)], { onRetry: (n, max) => retries.push([n, max]) });
  assert.equal(await p, OK_BODY);
  assert.deepEqual(sleeps, [2000]);
  assert.equal(m.calls.length, 2);
  assert.deepEqual(retries, [[1, 3]]);
});

test('429 が4回続くと kind rate。再試行は3回', async () => {
  const { e, m, sleeps } = await failure([resp(429, '{}', { 'Retry-After': '1' })]);
  assert.equal(e.kind, 'rate');
  assert.match(e.message, /利用制限/);
  assert.equal(m.calls.length, 4);
  assert.equal(sleeps.length, 3);
});

test('Retry-After が 120 なら 60秒に切り詰め、なければ 5秒', async () => {
  const a = await run([resp(429, '{}', { 'Retry-After': '120' }), resp(200, OK_BODY)]);
  await a.p;
  assert.deepEqual(a.sleeps, [60000]);
  const b = await run([resp(429), resp(200, OK_BODY)]);
  await b.p;
  assert.deepEqual(b.sleeps, [5000]);
});

const CASES = [
  [401, '{"error":"x"}', 'auth', /合言葉が違います/],
  [400, '{"error":"質問 pace の text が契約と一致しません"}', 'contract', /契約と合いません.*質問 pace の text/],
  [413, '', 'size', /大きすぎます/],
  [500, '', 'config', /設定が不足/],
  [502, '', 'upstream', /エラー/],
  [504, '', 'upstream', /タイムアウト/],
  [404, '', 'other', /想定外です（状態：404）/],
  [405, '', 'other', /想定外です（状態：405）/],
];
for (const [status, body, kind, re] of CASES) {
  test(`状態 ${status} は kind ${kind}。再試行しない`, async () => {
    const { e, m, sleeps } = await failure([resp(status, body)]);
    assert.equal(e.kind, kind);
    assert.match(e.message, re);
    assert.equal(m.calls.length, 1);
    assert.equal(sleeps.length, 0);
    assert.ok(!e.message.includes(PASS));
  });
}

test('ネットワークエラーは kind network。再試行しない', async () => {
  const { e, m } = await failure([new TypeError('Failed to fetch')]);
  assert.equal(e.kind, 'network');
  assert.equal(m.calls.length, 1);
  assert.ok(!e.message.includes(PASS));
});

test('タイムアウトは「応答がありませんでした」', async () => {
  const fetchImpl = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const e = await callRelay({ contract: RACE_OUTLOOK.label, state, questions, password: PASS, fetchImpl, sleepImpl: async () => {}, timeoutMs: 20 }).then(() => null, e => e);
  assert.equal(e.kind, 'network');
  assert.equal(e.message, '応答がありませんでした');
});

test('エラーメッセージとコンソール出力に合言葉が含まれない', async () => {
  const logs = [];
  const saved = {};
  for (const k of ['log', 'error', 'warn', 'info', 'debug']) { saved[k] = console[k]; console[k] = (...a) => logs.push(a.join(' ')); }
  const msgs = [];
  try {
    for (const [status] of CASES) { const { e } = await failure([resp(status, `{"error":"${PASS}"}`.replace(PASS, 'reason')) ]); msgs.push(e.message); }
    msgs.push((await failure([new TypeError('Failed to fetch')])).e.message);
    msgs.push((await failure([resp(429)])).e.message);
  } finally { for (const k in saved) console[k] = saved[k]; }
  assert.ok(msgs.length > 5);
  assert.ok(msgs.every(m => !m.includes(PASS)));
  assert.ok(logs.every(l => !l.includes(PASS)));
  assert.equal(logs.length, 0);
});

test('isRelayAvailable', () => {
  assert.equal(isRelayAvailable({ protocol: 'https:', hostname: 'foo.github.io' }), false);
  assert.equal(isRelayAvailable({ protocol: 'https:', hostname: 'bar.netlify.app' }), true);
  assert.equal(isRelayAvailable({ protocol: 'http:', hostname: 'localhost' }), true);
  assert.equal(isRelayAvailable({ protocol: 'file:', hostname: '' }), false);
});
