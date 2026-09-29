import test from 'node:test';
import assert from 'node:assert/strict';
import { zoneCut, zoneRanges } from '../src/derive.js';
import { HORSE_POSITION } from '../src/contracts.js';

test('zoneRanges：n=1〜18 で 1〜n をすき間なく重なりなく覆う', () => {
  for (let n = 1; n <= 18; n++) {
    let next = 1;
    for (const z of zoneRanges(n)) {
      assert.equal(z.from, next, `n=${n} ${z.key}`);
      assert.ok(z.to >= z.from, `n=${n} ${z.key} が空`);
      next = z.to + 1;
    }
    assert.equal(next, n + 1, `n=${n}`);
  }
});

test('zoneRanges：少頭数の区分', () => {
  const keys = n => zoneRanges(n).map(z => z.key);
  assert.deepEqual(keys(1), ['front']);
  assert.deepEqual(keys(2), ['front', 'forward']);
  assert.deepEqual(keys(3), ['front', 'forward', 'mid']);
});

test('zoneCut：4〜18頭では修正前の式と同じ', () => {
  for (let n = 4; n <= 18; n++) {
    assert.deepEqual(zoneCut(n), { a: Math.max(2, Math.round(0.3 * n)), b: Math.max(3, Math.round(0.7 * n)) });
  }
});

test('HORSE_POSITION：3頭立ての選択肢は front・forward・mid だけ', () => {
  const horses = [1, 2, 3].map(num => ({ num, name: 'テスト' + num }));
  const q = HORSE_POSITION.questions({ horses }, horses[0], null);
  assert.deepEqual(Object.keys(q.first_corner.criteria), ['front', 'forward', 'mid']);
  assert.deepEqual(Object.keys(q.last_corner.criteria), ['front', 'forward', 'mid']);
});
