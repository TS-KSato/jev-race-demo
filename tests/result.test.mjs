import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseResult } from '../src/parse/result.js';
import { parseCornerLine } from '../src/parse/corners.js';

const read = n => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const A = read('result_a.txt'), B = read('result_b.txt'), C = read('result_c.txt');
const codes = r => r.warnings.map(w => w.code);
const pos = (r, n) => r.positions.find(p => p.number === n);
const zones = (r, key) => Object.fromEntries(r.positions.map(p => [p.number, p[key].zone]));
const strip = r => { const { source_format, ...rest } = r; return rest; };

test('(a) フィクスチャの sha256', () => {
  const sha = t => crypto.createHash('sha256').update(t).digest('hex');
  assert.equal(sha(A), '45590a9bf95fc99e894d796c7da3f78ee808fc3d4d5297c150033867c50d0c7d');
  assert.equal(sha(B), 'b8212743cb0c5f36207deead65d5c353ba5cb332a7ff5ac05fed3e0b22207a8f');
  assert.equal(sha(C), '656e603776b1cd7cf57e9ea80c82de401a8237bf05167baddcd6994f370bb89d');
});

test('(b) 形式 A', () => {
  const r = parseResult(A);
  assert.equal(r.schema, 'race-result@1');
  assert.equal(r.source_format, 'A');
  assert.deepEqual(r.warnings, []);
  const R = r.race;
  assert.deepEqual([R.date, R.venue, R.kai, R.nichi, R.race_no, R.name, R.name_raw, R.grade, R.surface, R.distance, R.turn, R.course_detail, R.weather, R.going.turf, R.going.dirt],
    ['2031-11-02', '東京', 4, 3, 11, 'テストカップ', '第10回テストカップGⅢ', 'G3', '芝', 1600, '左', null, '曇', '良', null]);
  assert.equal(R.starters, 6); assert.equal(R.scratched, 1);
  assert.deepEqual(r.horses.filter(h => h.finish != null).map(h => h.number), [5, 2, 7, 1, 6, 4]);
  const t = r.horses.find(h => h.status === '取消'); assert.equal(t.number, 3); assert.equal(t.finish, null);
  assert.equal(r.pace.furlongs.length, 8);
  assert.deepEqual([r.pace.win_time, r.pace.first_3f, r.pace.last_3f, r.pace.last_4f, r.pace.first_last_diff, r.pace.reported_last_3f, r.pace.reported_last_4f], [94.5, 35.6, 34.9, 46.9, -0.7, 34.9, 46.9]);
  assert.deepEqual(r.corners.map(c => c.corner), [3, 4]);
  const cp = n => r.horses.find(h => h.number === n).corner_positions.map(x => x.rank);
  assert.deepEqual([5, 2, 7, 1, 6, 4].map(cp), [[3, 2], [1, 1], [5, 4], [4, 3], [6, 6], [2, 5]]);
  assert.deepEqual(zones(r, 'first_corner'), { 5: '中団', 2: '先頭', 7: '後方', 1: '中団', 6: '後方', 4: '好位' });
  assert.deepEqual(zones(r, 'last_corner'), { 5: '好位', 2: '先頭', 7: '中団', 1: '中団', 6: '後方', 4: '後方' });
  assert.ok(r.positions.every(p => !p.first_corner.ambiguous && !p.last_corner.ambiguous));
  assert.ok(pos(r, 5).corners.every(c => c.source === 'row' && c.exact));
  assert.equal(r.leader.number, 2);
  const h5 = r.horses.find(h => h.number === 5);
  assert.deepEqual([h5.body_weight, h5.body_weight_diff], [486, 4]);
  assert.equal(r.horses.find(h => h.number === 6).body_weight_diff, -6);
  assert.equal(r.horses.find(h => h.number === 1).sex_age, 'セ6'); // 作業指示は「馬番4」だが、記法の本文では馬番1（テストデルタ）がセ6
});

test('(b) 形式 B', () => {
  const r = parseResult(B);
  assert.equal(r.source_format, 'B');
  assert.deepEqual(r.warnings, []);
  const R = r.race;
  assert.deepEqual([R.date, R.venue, R.kai, R.nichi, R.race_no, R.name, R.grade, R.surface, R.distance, R.turn, R.weather, R.going.turf],
    ['2031-11-09', '京都', 5, 2, 11, 'テスト記念', 'G2', '芝', 2000, '右', '曇', '稍重']);
  assert.equal(R.starters, 6); assert.equal(R.scratched, 1);
  assert.deepEqual(r.horses.filter(h => h.finish != null).map(h => h.number), [8, 3, 6, 5, 1, 4]);
  assert.ok(r.horses.every(h => h.corner_positions === null));
  assert.equal(r.pace.furlongs.length, 10);
  assert.deepEqual([r.pace.win_time, r.pace.first_3f, r.pace.last_3f, r.pace.last_4f, r.pace.first_last_diff], [119.9, 35.8, 35.9, 47.8, 0.1]);
  assert.deepEqual(r.corners.map(c => c.corner), [1, 2, 3, 4]);
  const rng = (n, k) => [pos(r, n)[k].rank_min, pos(r, n)[k].rank_max];
  assert.deepEqual([3, 6, 8, 5, 1, 4].map(n => rng(n, 'first_corner')), [[1, 2], [1, 2], [3, 3], [4, 4], [5, 6], [5, 6]]);
  assert.deepEqual(zones(r, 'first_corner'), { 8: '中団', 3: null, 6: null, 5: '中団', 1: '後方', 4: '後方' });
  assert.ok(pos(r, 3).first_corner.ambiguous && pos(r, 6).first_corner.ambiguous && !pos(r, 8).first_corner.ambiguous);
  assert.deepEqual([6, 3, 8, 5, 1, 4].map(n => rng(n, 'last_corner')), [[1, 1], [2, 2], [3, 3], [4, 5], [4, 5], [6, 6]]);
  assert.deepEqual(zones(r, 'last_corner'), { 8: '中団', 3: '好位', 6: '先頭', 5: null, 1: null, 4: '後方' });
  assert.ok(pos(r, 5).last_corner.ambiguous && pos(r, 1).last_corner.ambiguous);
  assert.ok(pos(r, 8).corners.every(c => c.source === 'notation'));
  assert.equal(pos(r, 8).corners[0].exact, true); assert.equal(pos(r, 3).corners[0].exact, false);
  assert.equal(r.leader.number, null);
  assert.deepEqual([...r.leader.candidates].sort(), [3, 6]);
});

test('(b) 形式 C', () => {
  const r = parseResult(C);
  assert.equal(r.source_format, 'C');
  assert.deepEqual(r.warnings, []);
  const R = r.race;
  assert.deepEqual([R.date, R.venue, R.kai, R.nichi, R.race_no, R.name, R.grade, R.surface, R.distance, R.turn, R.weather, R.going.turf],
    ['2031-11-16', '阪神', 5, 2, 11, 'テストステークス', 'G1', '芝', 1800, '右', '晴', '良']);
  assert.equal(R.starters, 5); assert.equal(R.scratched, 0);
  assert.deepEqual(r.horses.map(h => h.number), [3, 2, 5, 1, 4]);
  assert.equal(r.horses[0].margin, '');
  assert.equal(r.pace.furlongs.length, 9);
  assert.deepEqual([r.pace.win_time, r.pace.first_3f, r.pace.last_3f, r.pace.last_4f, r.pace.first_last_diff], [107.2, 36, 34.6, 46.6, -1.4]);
  assert.deepEqual(r.corners.map(c => c.corner), [1, 2, 3, 4]);
  const want = { 3: '先頭', 1: '好位', 2: '中団', 5: '中団', 4: '後方' };
  assert.deepEqual(zones(r, 'first_corner'), want);
  assert.deepEqual(zones(r, 'last_corner'), want);
  assert.ok(r.positions.every(p => !p.first_corner.ambiguous && !p.last_corner.ambiguous));
  assert.equal(r.leader.number, 3);
});

test('(c) 見出し・表記の違い・空白だけの行があっても同じ読み取り結果', () => {
  const base = strip(parseResult(A));
  assert.deepEqual(strip(parseResult(A.replace('騎手名', '騎手'))), base);
  assert.deepEqual(strip(parseResult(A.replace('ウインファイブ', 'ウインファイヴ'))), base);
  const noBlank = A.split('\n').filter(l => !/^ +$/.test(l)).join('\n');
  assert.notEqual(noBlank, A);
  assert.deepEqual(strip(parseResult(noBlank)), base);
});

test('(d) ハロンタイムが勝ち馬のタイムと合わない', () => {
  const r = parseResult(A.replace('12.6 - 11.2', '12.7 - 11.2'));
  assert.ok(codes(r).includes('furlong_sum_mismatch'));
  assert.equal(r.horses[0].number, 5);
});

test('(e) 馬の行の番手がコーナー行の範囲外', () => {
  const r = parseResult(A.replace('\n3 2\n', '\n6 2\n'));
  assert.ok(codes(r).includes('row_notation_mismatch'));
});

test('(f) コーナー行の馬番が足りない', () => {
  const r = parseResult(B.replace('(*3,6)8,5(1,4)', '(*3,6)8,5(1)'));
  assert.ok(codes(r).includes('corner_set_mismatch'));
});

test('(g) 複数のレース', () => {
  assert.throws(() => parseResult(A + A), /複数のレースが含まれています/);
});

test('(h) 形式を判別できない', () => {
  assert.throws(() => parseResult(read('jra_entry_basic.txt')), /結果ページの形式を判別できません/);
  assert.throws(() => parseResult('これは意味のない文字列です\nabc\t123'), /結果ページの形式を判別できません/);
  assert.throws(() => parseResult(''), /結果ページの形式を判別できません/);
});

test('(i) 障害レース', () => {
  assert.throws(() => parseResult(A.replace('コース：1,600メートル（芝・左）', 'コース：3,000メートル（障害・芝）')), /障害レースは対象外です/);
});

test('(j) コーナー行の読み取り', () => {
  const p = parseCornerLine('(*10,11)(1,15,17)14(6,8)2(9,12,18)3,13(16,5,7)4');
  assert.ok(p.ok);
  assert.deepEqual(p.groups.map(g => g.horses), [[10, 11], [1, 15, 17], [14], [6, 8], [2], [9, 12, 18], [3], [13], [16, 5, 7], [4]]);
  assert.deepEqual(p.groups.map(g => g.sep_after), ['', '', '', '', '', '', ',', '', '', '']);
  assert.deepEqual(p.ranges.map(r => [r.rank_min, r.rank_max]), [[1, 2], [3, 5], [6, 6], [7, 8], [9, 9], [10, 12], [13, 13], [14, 14], [15, 17], [18, 18]]);

  const q = parseCornerLine('2,4(5,1)7-6');
  assert.deepEqual(q.groups.map(g => g.sep_after), [',', '', '', '-', '']);
  assert.deepEqual(q.ranges.map(r => [r.rank_min, r.rank_max]), [[1, 1], [2, 2], [3, 4], [5, 5], [6, 6]]);

  const e = parseCornerLine('3-1(2,5)=4');
  assert.deepEqual(e.groups.map(g => g.sep_after), ['-', '', '=', '']);
  assert.deepEqual(e.ranges.map(r => [r.rank_min, r.rank_max]), [[1, 1], [2, 2], [3, 4], [5, 5]]);

  assert.equal(parseCornerLine('2,4(5,1').ok, false);
  assert.equal(parseCornerLine('2,4(5,1)x').ok, false);
  assert.equal(parseCornerLine('2,4)5').ok, false);
});

test('コーナー行を読めないとき corner_parse_error の警告で続ける', () => {
  const r = parseResult(B.replace('(*3,6)8,5(1,4)', '(*3,6)8,5(1,4'));
  assert.ok(codes(r).includes('corner_parse_error'));
  assert.deepEqual(r.corners.map(c => c.corner), [2, 3, 4]);
});
