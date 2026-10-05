import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import { derive, gatePosition } from '../src/derive.js';
import { raceState, raceQuestions, horseRequest } from '../src/requests.js';
import { RACE_OUTLOOK, HORSE_POSITION, RACE_OUTLOOK_V1, HORSE_POSITION_V2, CONTRACT_SETS, DEFAULT_SET, setOfLabel, EXTRA_OUTLOOK, EXTRA_POSITION } from '../src/contracts.js';
import { handleRelay } from '../src/relay.js';
import { buildRecord, buildSummaryLine, buildDetailText } from '../src/record.js';
import { buildResults as buildDefault, EXPECTED_PATH, FIXTURE_TEXT_PATH } from './helpers/build-results.mjs';
import { buildRequest } from '../src/jev.js';

const EXPECTED_V1_PATH = new URL('./fixtures/jra_entry_basic.v1.expected.json', import.meta.url);
const OUTLOOK_FIXED = { note: 'STEP3でJevが推定した展開。確定した事実ではない', expected_leader: '1番 テストアルファ', early_lead_battle: '激しくなる', pace: 'ミドル' };
const jevForm = ({ state, questions }) => ({ state, questions: buildRequest(state, questions).questions });
// set を指定して、基準結果と同じ形の結果を組み立てる（既定の組は helpers の buildResults と一致することも確かめる）
function buildResults(set) {
  if (set === undefined) return buildDefault();
  const P = parse(readFileSync(FIXTURE_TEXT_PATH, 'utf8')), Dv = derive(P);
  return { parsed: P, derived: Dv, raceRequest: jevForm({ state: raceState(Dv, set), questions: raceQuestions(Dv, set) }),
    horseRequests: { noOutlook: Dv.horses.map(h => jevForm(horseRequest(Dv, h, null, set))), withOutlook: Dv.horses.map(h => jevForm(horseRequest(Dv, h, OUTLOOK_FIXED, set))) } };
}

const plain = v => JSON.parse(JSON.stringify(v));
const clone = plain;
const D = derive(parse(readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8')));

test('旧版の組で組み立てた結果が、変更前の基準結果と完全に一致する', () => {
  const v1 = JSON.parse(readFileSync(EXPECTED_V1_PATH, 'utf8'));
  const old = plain(buildResults('old'));
  assert.deepStrictEqual(old.raceRequest, v1.raceRequest);
  assert.deepStrictEqual(old.horseRequests, v1.horseRequests);
  // 導出の既存の値は変えない（新しい導出の項目を除いて一致）
  const strip = o => { const c = clone(o); for (const h of c.derived.horses) { delete h.facts.gatePos; delete h.facts.ranCount; for (const p of h.past) { delete p.gatePos; delete p.jockeySame; delete p.daysBefore; } } return c; };
  assert.deepStrictEqual(strip(old).derived, v1.derived);
  assert.deepStrictEqual(old.parsed, v1.parsed);
});

test('新版の基準結果と、既定（新）で組み立てた結果が一致する。差分は追加項目だけ', () => {
  const nw = plain(buildResults()), expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'));
  assert.deepStrictEqual(nw, expected);
  const v1 = JSON.parse(readFileSync(EXPECTED_V1_PATH, 'utf8'));
  const dropHorse = h => { const c = clone(h); delete c.gate_position; delete c.effective_run_count; delete c.recent_races_scope; c.recent_races.forEach(p => { delete p.gate_position; delete p.jockey_same_as_today; delete p.days_before_today; }); return c; };
  const dropState = st => { const c = clone(st); if (c.horses) c.horses = c.horses.map(dropHorse); if (c.target) c.target = dropHorse(c.target); return c; };
  const same = (a, b) => { assert.deepStrictEqual(dropState(a.state), b.state); };
  same(nw.raceRequest, v1.raceRequest);
  nw.horseRequests.noOutlook.forEach((r, i) => same(r, v1.horseRequests.noOutlook[i]));
  nw.horseRequests.withOutlook.forEach((r, i) => same(r, v1.horseRequests.withOutlook[i]));
  assert.equal(DEFAULT_SET, 'new');
  assert.deepStrictEqual(plain(buildResults('new')), expected);
});

test('gatePosition の境界', () => {
  assert.equal(gatePosition(6, 18), '内');
  assert.equal(gatePosition(7, 18), '中');
  assert.equal(gatePosition(12, 18), '中');
  assert.equal(gatePosition(13, 18), '外');
  // 3区分に分けるには3頭以上が要るので、3頭未満は null
  assert.equal(gatePosition(1, 1), null);
  assert.equal(gatePosition(1, 2), null);
  assert.deepEqual([1, 2, 3].map(n => gatePosition(n, 3)), ['内', '中', '外']);
  for (const [n, f] of [[0, 18], [-1, 18], [19, 18], [null, 18], [3, null], [undefined, 18], [1.5, 18]]) assert.equal(gatePosition(n, f), null, `${n},${f}`);
});

const mk = (past, jockey = '甲') => derive({ race: { date: '2026-03-01' }, horses: [{ num: 1, name: 'テスト', jockey, past }, ...Array.from({ length: 5 }, (_, i) => ({ num: i + 2, name: 'x' + i, past: [] }))] });
const run = (o = {}) => ({ date: '2026-02-01', field: 12, gate: 2, jockey: '甲', finish: 3, corners: [1, 1], ...o });

test('過去走の導出：出走せずは gatePos・jockeySame が null、daysBefore は値が入る', () => {
  const p = mk([run({ finish: '取消' }), run()]).horses[0].past;
  assert.equal(p[0].gatePos, null); assert.equal(p[0].jockeySame, null); assert.equal(p[0].daysBefore, 28);
  assert.equal(p[1].gatePos, '内'); assert.equal(p[1].jockeySame, true); assert.equal(p[1].daysBefore, 28);
});

test('騎手が同じ・違う・不明で true・false・null', () => {
  const p = mk([run({ jockey: '甲' }), run({ jockey: '乙' }), run({ jockey: null })]).horses[0].past;
  assert.deepEqual(p.map(x => x.jockeySame), [true, false, null]);
});

test('effective_run_count：取消・除外を数えず、中止・失格を数える', () => {
  const h = mk([run({ finish: '取消' }), run({ finish: '除外' }), run({ finish: '中止' }), run({ finish: '失格' }), run()]).horses[0];
  assert.equal(h.facts.ranCount, 3);
  assert.equal(h.facts.gatePos, '内');
});

test('新版の state は新しい項目を持ち、旧版は持たない', () => {
  const hn = raceState(D).horses[0], ho = raceState(D, 'old').horses[0];
  for (const k of ['gate_position', 'effective_run_count', 'recent_races_scope']) { assert.ok(k in hn, k); assert.ok(!(k in ho), k); }
  for (const k of ['gate_position', 'jockey_same_as_today', 'days_before_today']) { assert.ok(hn.recent_races.every(r => k in r), k); assert.ok(ho.recent_races.every(r => !(k in r)), k); }
  const r = horseRequest(D, D.horses[0], null);
  assert.ok('gate_position' in r.state.target);
  assert.deepEqual(Object.keys(r.state), ['race', 'track', 'target', 'others']);
  assert.ok(!('gate_position' in r.state.others[0]));
  assert.deepEqual(Object.keys(raceState(D)), ['race', 'track', 'race_facts', 'horses']);
});

test('新版の instructions に EXTRA が入り、旧版は変更前と同一', () => {
  const h = D.horses[0], oq = RACE_OUTLOOK.questions(D), o1 = RACE_OUTLOOK_V1.questions(D);
  assert.ok(oq.lead_horse.instructions.includes(EXTRA_OUTLOOK));
  assert.ok(oq.lead_horse.instructions.includes('を根拠にする。' + EXTRA_OUTLOOK + '根拠が足りない場合は unclear を選ぶ。'));
  assert.ok(!o1.lead_horse.instructions.includes('effective_run_count'));
  assert.equal(oq.lead_horse.instructions.replace(EXTRA_OUTLOOK, ''), o1.lead_horse.instructions);
  assert.deepStrictEqual(oq.early_lead_battle, o1.early_lead_battle);
  assert.deepStrictEqual(oq.pace, o1.pace);
  assert.deepStrictEqual(oq.lead_horse.criteria, o1.lead_horse.criteria);
  const pq = HORSE_POSITION.questions(D, h, null), p2 = HORSE_POSITION_V2.questions(D, h, null);
  for (const k of ['first_corner', 'last_corner']) {
    assert.ok(pq[k].instructions.includes('を根拠にする。' + EXTRA_POSITION + '`race_outlook` の項目が'));
    assert.equal(pq[k].instructions.replace(EXTRA_POSITION, ''), p2[k].instructions);
    assert.ok(!p2[k].instructions.includes('effective_run_count'));
    assert.deepStrictEqual(pq[k].criteria, p2[k].criteria);
    assert.equal(pq[k].kind, p2[k].kind);
  }
});

test('契約の組と setOfLabel', () => {
  assert.equal(CONTRACT_SETS.new.outlook, RACE_OUTLOOK); assert.equal(CONTRACT_SETS.old.position, HORSE_POSITION_V2);
  assert.equal(setOfLabel('race-outlook@2'), 'new'); assert.equal(setOfLabel('horse-position@3'), 'new');
  assert.equal(setOfLabel('race-outlook@1'), 'old'); assert.equal(setOfLabel('horse-position@2'), 'old');
  assert.equal(setOfLabel('race-outlook@3'), null); assert.equal(setOfLabel(undefined), null);
});

/* ---------- relay ---------- */
const ENV = { TYPESAFE_API_KEY: 'dummy-api-key-not-real-0000', DEMO_PASSWORD: 'dummy-password-not-real-0000' };
const OL = { note: 'テスト用', expected_leader: '1番 テストアルファ', early_lead_battle: '激しくなる', pace: 'ミドル' };
async function relay(body) {
  let calls = 0;
  const out = await handleRelay({ method: 'POST', headers: { 'x-demo-password': ENV.DEMO_PASSWORD }, bodyText: JSON.stringify(body), env: ENV,
    fetchImpl: async () => { calls++; return new Response('{"answers":{}}', { status: 200 }); } });
  return { status: out.status, calls };
}
const body3 = set => ({ contract: CONTRACT_SETS[set].outlook.label, state: clone(raceState(D, set)), questions: clone(raceQuestions(D, set)) });
const body4 = (set, ol = OL) => { const r = horseRequest(D, D.horses[0], ol, set); return { contract: CONTRACT_SETS[set].position.label, state: clone(r.state), questions: clone(r.questions) }; };

test('relay：4つのラベルのリクエストがそれぞれ通る', async () => {
  for (const b of [body3('old'), body3('new'), body4('old'), body4('new'), body4('new', null), body4('old', null)]) {
    const r = await relay(b); assert.equal(r.status, 200, b.contract); assert.equal(r.calls, 1);
  }
});

test('relay：ラベルの取り違え・未知のラベル・質問の1文字変更は 400', async () => {
  const cases = [
    { ...body3('new'), contract: 'horse-position@3' }, { ...body3('old'), contract: 'horse-position@2' },
    { ...body4('new'), contract: 'race-outlook@2' }, { ...body4('old'), contract: 'race-outlook@1' },
    { ...body3('new'), contract: 'race-outlook@3' }, { ...body4('new'), contract: 'horse-position@4' },
    // 新版の state に旧版のラベル（質問は新版のまま）→ 質問が合わない
    { ...body3('new'), contract: 'race-outlook@1' }, { ...body4('new'), contract: 'horse-position@2' },
  ];
  for (const b of cases) { const r = await relay(b); assert.equal(r.status, 400, b.contract); assert.equal(r.calls, 0); }
  for (const set of ['old', 'new']) {
    const b = body3(set); b.questions.lead_horse.instructions += '。';
    let r = await relay(b); assert.equal(r.status, 400);
    const c = body4(set); c.questions.first_corner.instructions = c.questions.first_corner.instructions.slice(1);
    r = await relay(c); assert.equal(r.status, 400);
  }
});

test('relay：質問の再計算は、新しい state の項目（gate_position など）に依存しない', async () => {
  const b = body3('new');
  for (const h of b.state.horses) { delete h.gate_position; h.recent_races.forEach(p => { p.gate_position = 'X'; p.days_before_today = 999; }); h.effective_run_count = 99; }
  assert.equal((await relay(b)).status, 200);
});

/* ---------- record ---------- */
test('record：実際に使ったラベルが記録・サマリー・詳細に出る。ラベルがなければ旧ラベル', async () => {
  const raw = readFileSync(new URL('./fixtures/jev_response_race_outlook.json', import.meta.url), 'utf8');
  const { parseResponse } = await import('../src/jev.js');
  const J = parseResponse(raw, RACE_OUTLOOK.questions(D));
  const mkCtx = (c3, c4) => ({ now: new Date('2026-03-01T10:20:30+09:00'), host: 'x', userAgent: 'UA', race: D.race, horses: D.horses, warnings: [],
    userInput: { blind: 'blind', memo: '' }, s3Error: null,
    s3: { parsed: J, meta: { method: 'paste' }, state: raceState(D), overrides: {}, raw, ...(c3 ? { contract: c3 } : {}) },
    s4: { results: [], usedOutlook: null, usedOverridden: [], aborted: null, cancelled: false, states: {}, ...(c4 ? { contract: c4 } : {}) } });
  const a = mkCtx('race-outlook@2', 'horse-position@3');
  const rec = await buildRecord(a);
  assert.equal(rec.stage3.contract, 'race-outlook@2'); assert.equal(rec.stage4.contract, 'horse-position@3');
  const line = buildSummaryLine(a);
  assert.ok(line.includes('ctr=race-outlook@2') && line.includes('ctr=horse-position@3'), line);
  const det = buildDetailText(a);
  assert.ok(det.includes('契約：race-outlook@2') && det.includes('契約：horse-position@3'));
  const b = mkCtx(null, null);
  const rb = await buildRecord(b);
  assert.equal(rb.stage3.contract, 'race-outlook@1'); assert.equal(rb.stage4.contract, 'horse-position@2');
  assert.ok(buildSummaryLine(b).includes('ctr=race-outlook@1'));
});
