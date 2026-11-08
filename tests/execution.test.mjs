import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';
import { postTimeIso, classifyExecution, executionTimes, executionNotice, executionFromRecord, executionText, buildRecord, buildDetailText, buildSummaryLine } from '../src/record.js';

const RACE = { date: '2026-11-08', postTime: '15時30分' };
const JST = hm => `2026-11-08T${hm}:00+09:00`;

test('発走日時：race.date と「15時30分」から日本時間の ISO を作る', () => {
  assert.equal(postTimeIso(RACE), '2026-11-08T15:30:00+09:00');
  assert.equal(postTimeIso({ date: '2026-11-08', postTime: '9時05分' }), '2026-11-08T09:05:00+09:00');
  assert.equal(postTimeIso({ date: '2026-11-08' }), null);
  assert.equal(postTimeIso({ postTime: '15時30分' }), null);
  assert.equal(postTimeIso({ date: '2026-11-08', postTime: '未定' }), null);
});

test('区分：発走前は blind、発走後は non-blind、発走時刻なしは unknown', () => {
  assert.equal(classifyExecution(RACE, [JST('15:11')]).blindClass, 'blind');
  assert.equal(classifyExecution(RACE, [JST('15:31')]).blindClass, 'non-blind');
  assert.equal(classifyExecution(RACE, [JST('15:30')]).blindClass, 'non-blind'); // 発走日時ちょうどは「以後」
  assert.equal(classifyExecution({ date: '2026-11-08' }, [JST('15:11')]).blindClass, 'unknown');
  assert.equal(classifyExecution(RACE, []).blindClass, 'unknown');
  assert.equal(classifyExecution(RACE, ['読めない']).blindClass, 'unknown');
});

test('区分：STEP3 は発走前、STEP4 の1頭が発走後なら non-blind', () => {
  const ctx = { race: RACE, s3: { meta: { method: 'api', at: '2026-11-08T06:11:00.000Z' } },
    s4: { results: [{ status: 'ok', at: '2026-11-08T06:20:00.000Z' }, { status: 'failed', at: '2026-11-08T06:31:00.000Z' }, { status: 'skipped', at: null }] } };
  const e = classifyExecution(RACE, executionTimes(ctx));
  assert.deepStrictEqual(e, { blindClass: 'non-blind', rule: 'all-executions-before-post-time', postTime: '15時30分', postTimeIso: '2026-11-08T15:30:00+09:00',
    firstExecutedAt: '2026-11-08T06:11:00.000Z', lastExecutedAt: '2026-11-08T06:31:00.000Z', clock: 'browser' });
  ctx.s4.results.pop(); ctx.s4.results.pop();
  assert.equal(classifyExecution(RACE, executionTimes(ctx)).blindClass, 'blind');
});

test('区分：時刻の分からない実行（Playground への貼り付け）があると unknown。発走後の実行があれば non-blind', () => {
  const paste = { meta: { method: 'paste' } };
  assert.equal(classifyExecution(RACE, executionTimes({ s3: paste, s4: { results: [{ status: 'ok', at: JST('15:00') }] } })).blindClass, 'unknown');
  assert.equal(classifyExecution(RACE, executionTimes({ s3: paste, s4: { results: [{ status: 'ok', at: JST('15:40') }] } })).blindClass, 'non-blind');
});

test('ブラウザの時差設定（UTC・JST）によらず同じ区分と予告になる', () => {
  const code = `import('./src/record.js').then(m=>{const R={date:'2026-11-08',postTime:'15時30分'};
    console.log(JSON.stringify([m.classifyExecution(R,['2026-11-08T15:11:00+09:00']).blindClass,m.classifyExecution(R,['2026-11-08T06:31:00.000Z']).blindClass,
      m.executionNotice(R,new Date('2026-11-08T06:11:00.000Z')),m.executionNotice(R,new Date('2026-11-08T15:31:00+09:00'))]));});`;
  const run = TZ => execFileSync(process.execPath, ['-e', code], { cwd: new URL('..', import.meta.url), env: { ...process.env, TZ }, encoding: 'utf8' }).trim();
  const utc = run('UTC'), jst = run('Asia/Tokyo');
  assert.equal(utc, jst);
  assert.deepStrictEqual(JSON.parse(utc).slice(0, 2), ['blind', 'non-blind']);
});

test('実行前の予告：3通り', () => {
  assert.equal(executionNotice(RACE, new Date(JST('15:11'))), '発走前です。この実行は『ブラインド』として記録されます。');
  assert.equal(executionNotice(RACE, new Date(JST('15:31'))), '発走時刻（15:30）を過ぎています。結果が出ている可能性があるため、この実行は『非ブラインド』として記録されます。');
  assert.equal(executionNotice({ date: '2026-11-08' }, new Date(JST('15:11'))), '発走時刻が読み取れないため、区分は『判定不能』として記録されます。');
});

/* ---------- 記録 @2 ---------- */
const P = parse(readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8'));
const D = derive(P);
const sent = (num, at) => ({ num, name: D.horses.find(h => h.num === num).name, status: 'failed', raw: null, parsed: null, at, errorKind: 'rate', errorMessage: 'm', request: null });
const ctx = (over = {}) => ({ now: new Date('2026-03-01T16:00:00+09:00'), host: 'localhost', userAgent: 'UA', race: D.race, horses: D.horses, warnings: [],
  userInput: { memo: 'めも' }, s3: null, s3Error: null,
  s4: { results: [sent(1, '2026-03-01T15:40:00+09:00'), sent(2, '2026-03-01T15:44:00+09:00')], usedOutlook: null, usedOverridden: [], aborted: null, cancelled: false, states: {} }, ...over });

test('記録 @2：execution が入り、userInput は memo だけ', async () => {
  const r = await buildRecord(ctx());
  assert.equal(r.schema, 'jev-demo-record@2');
  assert.deepStrictEqual(r.userInput, { memo: 'めも' });
  assert.deepStrictEqual(r.execution, { blindClass: 'blind', rule: 'all-executions-before-post-time', postTime: '15時45分', postTimeIso: '2026-03-01T15:45:00+09:00',
    firstExecutedAt: '2026-03-01T15:40:00+09:00', lastExecutedAt: '2026-03-01T15:44:00+09:00', clock: 'browser' });
});

test('記録 @2：採点のあと（_scored）も execution は同じ。作る時刻が発走後でも変わらない', async () => {
  const a = await buildRecord(ctx());
  const b = await buildRecord(ctx({ now: new Date('2026-03-02T09:00:00+09:00'), result: { schema: 'race-result@1', warnings: [] }, scoring: { ok: true }, scoredAt: new Date('2026-03-02T09:00:00+09:00') }));
  assert.deepStrictEqual(b.execution, a.execution);
});

test('要約：実行の区分を execution から作り、実行時刻と発走時刻を併記する', () => {
  const t = buildDetailText(ctx());
  assert.ok(t.includes('実行の区分：ブラインド（実行：2026-03-01T15:40:00+09:00〜2026-03-01T15:44:00+09:00 ／ 発走：2026-03-01T15:45:00+09:00）'));
  assert.ok(buildSummaryLine(ctx()).includes(' | exec=blind 実行=2026-03-01T15:40:00+09:00〜2026-03-01T15:44:00+09:00 発走=2026-03-01T15:45:00+09:00 | '));
});

test('@1 の記録（blind／non-blind／未指定）を読んでも、エラーにならず区分の表示が作れる', () => {
  const v1 = blind => ({ schema: 'jev-demo-record@1', userInput: blind === undefined ? { memo: '' } : { blind, memo: '' } });
  assert.equal(executionText(executionFromRecord(v1('blind'))), 'ブラインド（レース前に実行）（旧形式の記録。利用者の設定による）');
  assert.equal(executionText(executionFromRecord(v1('non-blind'))), '非ブラインド（結果を知ったあとに実行）（旧形式の記録。利用者の設定による）');
  assert.equal(executionText(executionFromRecord(v1(undefined))), '未指定（旧形式の記録。利用者の設定による）');
  assert.equal(executionText(executionFromRecord(v1('unspecified'))), '未指定（旧形式の記録。利用者の設定による）');
});

test('@2 の記録を読むと execution をそのまま使う', async () => {
  const r = await buildRecord(ctx());
  assert.equal(executionText(executionFromRecord(JSON.parse(JSON.stringify(r)))), 'ブラインド（実行：2026-03-01T15:40:00+09:00〜2026-03-01T15:44:00+09:00 ／ 発走：2026-03-01T15:45:00+09:00）');
});

test('画面：ブラインドの選択欄がなく、予告の欄がある', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('fb-blind'));
  assert.ok(html.includes('id="x-when"') && html.includes('id="x4-when"') && html.includes('id="fb-memo"'));
});
