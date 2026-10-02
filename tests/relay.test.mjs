import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';
import { raceState, raceQuestions, horseRequest } from '../src/requests.js';
import { RACE_OUTLOOK, HORSE_POSITION } from '../src/contracts.js';
import { ENDPOINT, MODEL_ID } from '../src/jev.js';
import { handleRelay } from '../src/relay.js';

const KEY = 'dummy-api-key-not-real-0000';
const PASS = 'dummy-password-not-real-0000';
const ENV = { TYPESAFE_API_KEY: KEY, DEMO_PASSWORD: PASS };
const UPSTREAM_BODY = '{"answers":{},"secret_upstream_marker":"UPSTREAM-ONLY-TEXT"}';

const D = derive(parse(readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8')));
const clone = v => JSON.parse(JSON.stringify(v));
const outlookBody = () => ({ contract: RACE_OUTLOOK.label, state: clone(raceState(D)), questions: clone(raceQuestions(D)) });
const OL = { note: 'テスト用', expected_leader: '1番 テストアルファ', early_lead_battle: '激しくなる', pace: 'ミドル' };
const horseBody = (ol = OL) => { const r = horseRequest(D, D.horses[0], ol); return { contract: HORSE_POSITION.label, state: clone(r.state), questions: clone(r.questions) }; };

function mock(res) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return typeof res === 'function' ? res() : res; };
  return { calls, fetchImpl };
}
const ok = () => new Response(UPSTREAM_BODY, { status: 200 });

async function relay(body, { method = 'POST', password = PASS, env = ENV, res = ok(), raw } = {}) {
  const m = mock(res);
  const headers = password == null ? {} : { 'X-Demo-Password': password };
  const out = await handleRelay({ method, headers, bodyText: raw ?? JSON.stringify(body), env, fetchImpl: m.fetchImpl });
  return { out, calls: m.calls };
}

test('STEP3 のリクエストが通り、固定の版・送信先・認証で転送される', async () => {
  const { out, calls } = await relay(outlookBody());
  assert.equal(out.status, 200);
  assert.equal(out.body, UPSTREAM_BODY);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENDPOINT);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.model, MODEL_ID);
  assert.equal(sent.questions.pace.type, 'score');
});

test('horse-position@2 のリクエスト（展開あり・なし）が通る', async () => {
  for (const ol of [OL, null]) {
    const { out, calls } = await relay(horseBody(ol));
    assert.equal(out.status, 200);
    assert.equal(calls.length, 1);
  }
});

test('本文の model は無視され、MODEL_ID で送られる', async () => {
  const b = outlookBody(); b.model = 'jev-latest';
  const { calls } = await relay(b);
  assert.equal(JSON.parse(calls[0].init.body).model, MODEL_ID);
});

test('GET は 405、合言葉なし・誤りは 401、環境変数不足は 500', async () => {
  let r = await relay(outlookBody(), { method: 'GET' });
  assert.equal(r.out.status, 405); assert.equal(r.calls.length, 0);
  r = await relay(outlookBody(), { password: null });
  assert.equal(r.out.status, 401); assert.equal(r.calls.length, 0);
  r = await relay(outlookBody(), { password: 'wrong' });
  assert.equal(r.out.status, 401); assert.equal(r.calls.length, 0);
  for (const env of [{ DEMO_PASSWORD: PASS }, { TYPESAFE_API_KEY: KEY }, {}]) {
    r = await relay(outlookBody(), { env });
    assert.equal(r.out.status, 500); assert.equal(r.calls.length, 0);
  }
});

test('壊れた JSON・項目欠落・未知の契約は 400', async () => {
  let r = await relay(null, { raw: '{broken' });
  assert.equal(r.out.status, 400); assert.equal(r.calls.length, 0);
  for (const k of ['contract', 'state', 'questions']) {
    const b = outlookBody(); delete b[k];
    r = await relay(b);
    assert.equal(r.out.status, 400, k); assert.equal(r.calls.length, 0);
  }
  r = await relay({ ...outlookBody(), contract: 'race-outlook@2' });
  assert.equal(r.out.status, 400); assert.equal(r.calls.length, 0);
});

test('契約に合わない質問は 400', async () => {
  const mutations = {
    'instructions を1文字変える': b => { b.questions.pace.instructions += '。'; },
    'instructions を1文字削る': b => { b.questions.lead_horse.instructions = b.questions.lead_horse.instructions.slice(1); },
    'criteria に余計なキー': b => { b.questions.lead_horse.criteria.extra = 'x'; },
    'grade の criteria に段階を足す': b => { b.questions.pace.criteria.push('x'); },
    '質問を1つ消す': b => { delete b.questions.pace; },
    '質問を1つ足す': b => { b.questions.other = { kind: 'truth', instructions: 'x' }; },
    '種類を変える': b => { b.questions.pace.kind = 'select'; },
    '余計な項目': b => { b.questions.early_lead_battle.type = 'noul'; },
    'state の馬名と質問が食い違う': b => { b.state.horses[0].name = '別の名前'; },
  };
  for (const [label, f] of Object.entries(mutations)) {
    const b = outlookBody(); f(b);
    const { out, calls } = await relay(b);
    assert.equal(out.status, 400, label); assert.equal(calls.length, 0, label);
  }
  const hm = {
    'instructions': b => { b.questions.first_corner.instructions += ' '; },
    'criteria に余計なキー': b => { b.questions.last_corner.criteria.extra = 'x'; },
    'キーを消す': b => { delete b.questions.last_corner; },
    'キーを足す': b => { b.questions.third = clone(b.questions.first_corner); },
    '種類': b => { b.questions.first_corner.kind = 'grade'; },
    '展開の有無と質問が食い違う': b => { delete b.state.race_outlook; },
  };
  for (const [label, f] of Object.entries(hm)) {
    const b = horseBody(); f(b);
    const { out, calls } = await relay(b);
    assert.equal(out.status, 400, label); assert.equal(calls.length, 0, label);
  }
});

test('400 の本文にリクエストの内容を含めない', async () => {
  const b = outlookBody(); b.questions.pace.instructions = 'LEAK-MARKER';
  const { out } = await relay(b);
  assert.match(out.body, /pace/);
  assert.ok(!out.body.includes('LEAK-MARKER'));
});

test('512KB 超は 413、Jev の上限超過も 413', async () => {
  let r = await relay(null, { raw: 'x'.repeat(512 * 1024 + 1) });
  assert.equal(r.out.status, 413); assert.equal(r.calls.length, 0);
  const b = outlookBody();
  b.state.race_facts.pad = 'あ'.repeat(40000); // 契約の形の検査は通るが state が大きい
  r = await relay(b);
  assert.equal(r.out.status, 413); assert.equal(r.calls.length, 0);
});

test('上流 429 は Retry-After つきで返す', async () => {
  const { out } = await relay(outlookBody(), { res: new Response('rate', { status: 429, headers: { 'Retry-After': '7' } }) });
  assert.equal(out.status, 429);
  assert.equal(out.headers['retry-after'], '7');
});

test('上流 500 は 502 で、上流の本文を返さない', async () => {
  const { out } = await relay(outlookBody(), { res: new Response('UPSTREAM-ONLY-TEXT', { status: 500 }) });
  assert.equal(out.status, 502);
  assert.ok(!out.body.includes('UPSTREAM-ONLY-TEXT'));
  assert.match(out.body, /500/);
});

test('ネットワークエラーは 502、タイムアウトは 504', async () => {
  let r = await relay(outlookBody(), { res: () => { throw new TypeError('fetch failed'); } });
  assert.equal(r.out.status, 502);
  r = await relay(outlookBody(), { res: () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } });
  assert.equal(r.out.status, 504);
});

test('応答・ログにキーと合言葉が含まれない', async () => {
  const logs = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.join(' '));
  const outs = [];
  try {
    outs.push((await relay(outlookBody())).out);
    outs.push((await relay(outlookBody(), { password: 'wrong' })).out);
    outs.push((await relay(outlookBody(), { res: new Response('boom', { status: 500 }) })).out);
    outs.push((await relay(outlookBody(), { res: () => { throw new Error(`fail ${KEY} ${PASS}`); } })).out);
    const b = outlookBody(); b.questions.pace.instructions = 'x';
    outs.push((await relay(b)).out);
  } finally { Object.assign(console, orig); }
  for (const o of outs) {
    const s = JSON.stringify(o);
    assert.ok(!s.includes(KEY) && !s.includes(PASS));
  }
  const all = logs.join('\n');
  assert.ok(logs.length > 0);
  assert.ok(!all.includes(KEY) && !all.includes(PASS) && !all.includes('UPSTREAM-ONLY-TEXT') && !all.includes('テストアルファ'));
});
