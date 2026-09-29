import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import * as jra from '../src/parse/jra.js';
import { validate } from '../src/parse/validate.js';
import { FIXTURE_TEXT_PATH } from './helpers/build-results.mjs';

const text = readFileSync(FIXTURE_TEXT_PATH, 'utf8');
const roundTrip = () => {
  const P = parse(text);
  const orig = P.warnings;
  delete P.warnings;
  return { P: JSON.parse(JSON.stringify(P)), orig };
};

test('validate：JSON を往復させても元の警告と同じ', () => {
  const { P, orig } = roundTrip();
  assert.equal(orig.length, 18);
  assert.deepStrictEqual(validate(P), orig);
});

test('validate：1番の馬に odds を入れると警告が17件になる', () => {
  const { P } = roundTrip();
  P.horses.find(h => h.num === 1).odds = 3.5;
  assert.equal(validate(P).length, 17);
});

test('validate：race.track に weather があれば馬場状態の警告が消える', () => {
  const { P } = roundTrip();
  const has = w => w.startsWith('馬場状態');
  P.race.track = {};
  assert.ok(validate(P).some(has));
  P.race.track = { weather: '晴' };
  assert.ok(!validate(P).some(has));
});

test('せん馬：6番は sex が セ、age が 8', () => {
  const h = parse(text).horses.find(x => x.num === 6);
  assert.equal(h.sex, 'セ');
  assert.equal(h.age, 8);
});

test('detect：枠の行が「天候：」以降にしかなければ false', () => {
  assert.equal(jra.detect('レース名\n天候：晴\n枠1白\t1\nテスト'), false);
  assert.equal(jra.detect('レース名\n枠1白\t1\nテスト'), true);
});
