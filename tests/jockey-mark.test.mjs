import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';
import { horseRequest, raceState } from '../src/requests.js';

// 架空の出馬表の1番の馬だけ、騎手名を書き換える（今回の騎手と、過去走の騎手）
const basic = readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8');
function withJockeys(today, past) {
  const L = basic.split('\n');
  const start = L.findIndex(l => l.startsWith('枠1白')), end = L.findIndex((l, i) => i > start && /^枠\d/.test(l));
  let k = 0;
  for (let i = start; i < end; i++) {
    if (L[i] === '試験 太郎') L[i] = today;
    else if (/^試験 太郎\t\d+\.\dkg$/.test(L[i])) { L[i] = L[i].replace('試験 太郎', past[k] ?? '山田 太郎'); k++; }
  }
  assert.equal(k, 4);
  return derive(parse(L.join('\n'))).horses.find(h => h.num === 1);
}
const MARKS = ['◇', '★', '▲', '△', '☆'];

for (const m of MARKS) {
  test(`過去走の騎手の先頭に「${m}」：同じ騎手とみなし、記号は jockey_mark に残す`, () => {
    const h = withJockeys('山田 太郎', [`${m}山田 太郎`]);
    assert.equal(h.past[0].jockey, '山田 太郎');
    assert.equal(h.past[0].jockey_mark, m);
    assert.equal(h.past[0].jockeySame, true);
    assert.equal(h.facts.jockeyChange, false);
    assert.ok(!('jockey_mark' in h.past[1])); // 記号のない走には付けない
  });
  test(`過去走の騎手の末尾に「${m}」：同じ騎手とみなす`, () => {
    const h = withJockeys('山田 太郎', [`山田 太郎${m}`]);
    assert.equal(h.past[0].jockey, '山田 太郎');
    assert.equal(h.past[0].jockey_mark, m);
    assert.equal(h.past[0].jockeySame, true);
    assert.equal(h.facts.jockeyChange, false);
  });
  test(`今回の騎手に「${m}」：記号を除いて比べる`, () => {
    const h = withJockeys(`${m}山田 太郎`, []);
    assert.equal(h.jockey, '山田 太郎');
    assert.equal(h.jockey_mark, m);
    assert.ok(h.past.every(p => p.jockeySame === true));
    assert.equal(h.facts.jockeyChange, false);
  });
}

test('記号なしの別人の騎手は、同じ騎手とみなさない', () => {
  const h = withJockeys('山田 太郎', ['佐藤 一郎', '◇佐藤 一郎']);
  assert.deepStrictEqual(h.past.map(p => p.jockeySame), [false, false, true, true]);
  assert.equal(h.facts.jockeyChange, true);
  assert.ok(!('jockey_mark' in h.past[0]));
  assert.equal(h.past[1].jockey_mark, '◇');
});

test('Jev に渡す state に jockey_mark は出ず、値だけが直る', () => {
  const L = basic.split('\n');
  const i = L.findIndex(l => /^試験 太郎\t\d+\.\dkg$/.test(l));
  L[i] = L[i].replace('試験 太郎', '◇試験 太郎');
  const D = derive(parse(L.join('\n'))), D0 = derive(parse(basic));
  for (const set of ['new', 'old']) {
    assert.deepStrictEqual(raceState(D, set), raceState(D0, set));
    assert.deepStrictEqual(horseRequest(D, D.horses[0], null, set).state, horseRequest(D0, D0.horses[0], null, set).state);
  }
  assert.ok(!JSON.stringify(raceState(D)).includes('jockey_mark'));
});
