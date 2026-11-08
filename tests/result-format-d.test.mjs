import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResult } from '../src/parse/result.js';

// 結果ページ形式D（架空のデータ）：馬の行、通過順の行、[推定上り]・馬体重(増減)・調教師・単勝人気の行
const ROWS = [
  '1\t枠1白\t1\tアルファテスト\t牡4\t55.0\t山田 太郎\t2:00.0\t\t',
  '3 3 3 3',
  '480(-2)\t鈴木 一郎\t5',
  '2\t枠2黒\t2\tベータサンプル\t牝5\t54.0\t佐藤 花子\t2:00.1\tクビ\t',
  '2 2 2 2',
  '496(0)\t高橋 二郎\t3',
  '3\t枠3赤\t3\tガンマダミー\tせん6\t57.0\t田中 三郎\t2:00.3\t１ 1/4\t',
  '1 1 1 1',
  '510(+4)\t伊藤 四郎\t1',
];
const D = ROWS.join('\n');
const D_EST = ROWS.map((l, i) => i === 2 ? '34.5\t480(-2)\t鈴木 一郎\t5' : l).join('\n');
const pick = h => [h.body_weight, h.body_weight_diff, h.trainer, h.popularity];
const byFinish = (r, f) => r.horses.find(h => h.finish === f);

test('形式D：推定上りなし・増減あり／なし／0 を読む', () => {
  const r = parseResult(D);
  assert.equal(r.source_format, 'D');
  assert.deepStrictEqual(pick(byFinish(r, 1)), [480, -2, '鈴木 一郎', 5]);
  assert.deepStrictEqual(pick(byFinish(r, 2)), [496, 0, '高橋 二郎', 3]);
  assert.deepStrictEqual(pick(byFinish(r, 3)), [510, 4, '伊藤 四郎', 1]);
  assert.ok(r.horses.every(h => h.last_3f_est === null));
  assert.deepStrictEqual(r.horses.map(h => [h.number, h.time, h.margin]), [[1, 120.0, ''], [2, 120.1, 'クビ'], [3, 120.3, '１ 1/4']]);
  assert.deepStrictEqual(r.horses.map(h => h.corner_positions.map(c => c.rank)), [[3, 3, 3, 3], [2, 2, 2, 2], [1, 1, 1, 1]]);
});

test('形式D：推定上りがある馬は推定上りも読む', () => {
  const r = parseResult(D_EST);
  assert.equal(r.source_format, 'D');
  const h = byFinish(r, 1);
  assert.deepStrictEqual(pick(h), [480, -2, '鈴木 一郎', 5]);
  assert.equal(h.last_3f_est, 34.5);
  assert.deepStrictEqual(pick(byFinish(r, 2)), [496, 0, '高橋 二郎', 3]);
  assert.equal(byFinish(r, 2).last_3f_est, null);
});
