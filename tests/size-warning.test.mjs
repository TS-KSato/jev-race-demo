import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';
import { raceState, raceQuestions, horseRequest } from '../src/requests.js';
import { RACE_OUTLOOK, HORSE_POSITION } from '../src/contracts.js';
import { buildRequest, checkLimits, limitWarning, LIMITS, parseResponse } from '../src/jev.js';
import { handleRelay } from '../src/relay.js';
import { callRelay } from '../src/client.js';
import { runStage4 } from '../src/stage4.js';

const KEY = 'dummy-api-key-not-real-0000', PASS = 'dummy-password-not-real-0000';
const ENV = { TYPESAFE_API_KEY: KEY, DEMO_PASSWORD: PASS };
const D = derive(parse(readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8')));
const clone = v => JSON.parse(JSON.stringify(v));
// 架空の大きな state（契約の形は保ったまま、目安だけを上限超過にする）
const bigState = () => { const s = clone(raceState(D)); s.race_facts.pad = 'あ'.repeat(LIMITS.stateAndLongestQuestionTokens); return s; };

test('目安が上限を超えると、検査は超過を返し、警告に目安の値・上限・多めである旨が入る', () => {
  const c = checkLimits(buildRequest(bigState(), raceQuestions(D)));
  assert.equal(c.ok, false);
  assert.ok(c.stateAndLongest > LIMITS.stateAndLongestQuestionTokens);
  const w = limitWarning(c);
  assert.ok(w.includes(`${c.total}／${LIMITS.requestTokens}`));
  assert.ok(w.includes(`${c.stateAndLongest}／${LIMITS.stateAndLongestQuestionTokens}`));
  assert.ok(w.includes('目安は実際より多めで、実際に超えているとは限らない'));
  assert.ok(w.includes('送信は止めません'));
  assert.equal(limitWarning(checkLimits(buildRequest(raceState(D), raceQuestions(D)))), null);
});

// 中継関数 → 上流（Jev）をモックでつないで、ブラウザ側の callRelay から呼ぶ
function chain(upstream) {
  const up = [];
  const fetchImpl = async (url, init) => {
    const out = await handleRelay({ method: init.method, headers: init.headers, bodyText: init.body, env: ENV,
      fetchImpl: async (u, i) => { up.push(JSON.parse(i.body)); return upstream(); } });
    return new Response(out.body, { status: out.status, headers: out.headers });
  };
  return { up, fetchImpl };
}
const OK = () => new Response(JSON.stringify({ model: 'jev-1.13.0', answers: {}, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });

test('STEP3：目安が超過でも送信が呼ばれ、上流まで届く', async () => {
  const st = bigState();
  assert.equal(checkLimits(buildRequest(st, raceQuestions(D))).ok, false);
  const c = chain(OK);
  const text = await callRelay({ contract: RACE_OUTLOOK.label, state: st, questions: raceQuestions(D), password: PASS, fetchImpl: c.fetchImpl, sleepImpl: async () => {} });
  assert.equal(c.up.length, 1);
  assert.equal(c.up[0].state.race_facts.pad, st.race_facts.pad);
  assert.equal(JSON.parse(text).model, 'jev-1.13.0');
});

test('STEP4：一部の馬だけ目安が超過でも、その馬の送信は止めない', async () => {
  const sent = [];
  const big = D.horses[1].num;
  const out = await runStage4({ horses: D.horses.slice(0, 3),
    buildFor: h => { const r = horseRequest(D, h, null); if (h.num === big) r.state.target.pad = 'あ'.repeat(LIMITS.stateAndLongestQuestionTokens); return r; },
    callOne: async ({ state, questions }) => { sent.push({ num: state.target.number, ok: checkLimits(buildRequest(state, questions)).ok }); return 'x'; },
    parse: () => ({ answers: { first_corner: {}, last_corner: {} } }) });
  assert.deepStrictEqual(sent.map(s => s.num), D.horses.slice(0, 3).map(h => h.num));
  assert.equal(sent.find(s => s.num === big).ok, false);
  assert.ok(out.results.every(r => r.status === 'ok'));
});

test('上流（Jev）がエラーを返したら、その状態が表示用のメッセージに残る', async () => {
  const c = chain(() => new Response('{"error":"too many tokens"}', { status: 400 }));
  const e = await callRelay({ contract: RACE_OUTLOOK.label, state: bigState(), questions: raceQuestions(D), password: PASS, fetchImpl: c.fetchImpl, sleepImpl: async () => {} }).then(() => null, x => x);
  assert.equal(c.up.length, 1);
  assert.equal(e.kind, 'upstream');
  assert.match(e.message, /Jev がエラーを返しました（status 400）/);
  assert.ok(!e.message.includes(PASS) && !e.message.includes(KEY));
});

test('STEP4：上流のエラーは、その馬の errorMessage に残る', async () => {
  const c = chain(() => new Response('', { status: 413 }));
  const h = D.horses[0];
  const zq = HORSE_POSITION.questions(D, h, null);
  const out = await runStage4({ horses: [h], buildFor: x => horseRequest(D, x, null),
    callOne: ({ state, questions }) => callRelay({ contract: HORSE_POSITION.label, state, questions, password: PASS, fetchImpl: c.fetchImpl, sleepImpl: async () => {} }),
    parse: t => parseResponse(t, zq) });
  assert.equal(out.results[0].status, 'failed');
  assert.match(out.results[0].errorMessage, /status 413/);
});
