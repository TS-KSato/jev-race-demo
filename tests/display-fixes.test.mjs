import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';
import { formatMoisture } from '../src/util.js';
import { buildDetailText, buildSummaryLine } from '../src/record.js';
import { leaderHtml } from '../src/scoreview.js';

const basic = readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8');

/* ---------- (3-2) 芝の含水率の表示 ---------- */
test('含水率の表示：両方・片方・なし', () => {
  assert.equal(formatMoisture({ goal: 13.8, corner4: 12.1 }), 'ゴール前 13.8% ／ 4コーナー 12.1%');
  assert.equal(formatMoisture({ goal: 13.8 }), 'ゴール前 13.8%');
  assert.equal(formatMoisture({ corner4: 12.1 }), '4コーナー 12.1%');
  assert.equal(formatMoisture(null), '—');
  assert.equal(formatMoisture({}), '—');
});

test('詳しいテキスト：含水率が [object Object] にならない', () => {
  const P = parse(basic), D = derive(P);
  const race = { ...D.race, track: { cushion: 10.4, turfMoisture: { goal: 13.8, corner4: 12.1 } } };
  const t = buildDetailText({ now: new Date('2031-11-02T10:00:00+09:00'), host: 'localhost', race, horses: D.horses, warnings: [], userInput: { memo: '' }, s3: null, s3Error: null, s4: null });
  assert.ok(!t.includes('[object Object]'));
  assert.ok(t.includes('turfMoisture=ゴール前 13.8% ／ 4コーナー 12.1%'));
});

/* ---------- (3-1) ハナの表記 ---------- */
const leaderScoring = (predicted_status, status) => ({ leader: { predicted: null, predicted_status, actual: 1, candidates: [1], status, correct: null } });
test('ハナの表記：特定できないと回答と、回答なしを区別する', () => {
  assert.ok(leaderHtml(leaderScoring('abstain', 'abstain'), null).includes('特定できないと回答'));
  const noAns = leaderHtml(leaderScoring('missing', 'missing'), null, { answers: { lead_horse: { error: '読めません' } } });
  assert.ok(noAns.includes('回答なし') && !noAns.includes('特定できない'));
  assert.ok(leaderHtml(leaderScoring('missing', 'missing'), null, null).includes('未実行'));
});

test('要約の1行：ハナが abstain なら「特定できないと回答」（「答えなし」は使わない）', () => {
  const P = parse(basic), D = derive(P);
  const result = { source_format: 'A', warnings: [], pace: {}, race: {} };
  const scoring = { ok: true, leader: { status: 'abstain' }, summary: { total: { unscorable: 0 }, by_corner: { first_corner: { correct: 0, scored: 0 }, last_corner: { correct: 0, scored: 0 } }, by_level: { high: { correct: 0, scored: 0 } } } };
  const line = buildSummaryLine({ now: new Date(), host: 'localhost', race: D.race, horses: D.horses, warnings: [], userInput: { memo: '' }, s3: null, s3Error: null, s4: null, result, scoring });
  assert.ok(line.includes('ハナ=特定できないと回答'));
  assert.ok(!line.includes('答えなし'));
});

/* ---------- (3-3) 馬場の警告の3種類（芝のレースにして、含水率・クッション値も求める） ---------- */
const turf = basic.replace('（ダート・左）', '（芝・左）');
const READ = '。読めた項目：クッション値、使用コース';
test('馬場の警告：見出しなし', () => {
  const W = parse(turf + '\n芝のクッション値\nクッション値\n10.4\n使用コース\nAコース\n').warnings;
  assert.ok(W.includes('貼った文字に『天候』が含まれていません' + READ));
  assert.ok(W.includes('貼った文字に『含水率』が含まれていません' + READ));
  assert.ok(W.includes('貼った文字に『芝の状態の説明』が含まれていません' + READ));
});
test('馬場の警告：見出しはあるが値がない', () => {
  const W = parse(turf + '\n芝のクッション値\nクッション値\n10.4\n含水率\n測定時刻\n使用コース\nAコース\n芝の状態\n').warnings;
  assert.ok(W.includes('『含水率』は読み取れませんでした' + READ));
  assert.ok(W.includes('『芝の状態の説明』は読み取れませんでした' + READ));
});
test('馬場の警告：何も読めない見出しだけのときは「読めた項目」を付けない', () => {
  const W = parse(turf + '\n芝のクッション値\n測定時刻\n').warnings;
  assert.ok(W.includes('『クッション値』は読み取れませんでした'));
  assert.ok(W.includes('貼った文字に『天候』が含まれていません'));
});
