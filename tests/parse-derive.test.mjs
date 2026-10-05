import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import { derive, zoneCut } from '../src/derive.js';
import { FIXTURE_TEXT_PATH } from './helpers/build-results.mjs';

const plain = v => JSON.parse(JSON.stringify(v));
const P = plain(parse(readFileSync(FIXTURE_TEXT_PATH, 'utf8')));
const D = plain(derive(P));
const horse = n => P.horses.find(h => h.num === n);
const dhorse = n => D.horses.find(h => h.num === n);

test('読み取り：レースと馬の数', () => {
  assert.equal(P.horses.length, 8);
  assert.equal(P.race.distance, 1600);
  assert.equal(P.race.surface, 'ダ');
  assert.equal(P.race.date, '2026-03-01');
  assert.equal(P.race.venue, '東京');
  assert.equal(P.race.raceNo, 11);
});

test('読み取り：警告', () => {
  assert.equal(P.warnings.length, 18);
  assert.equal(P.warnings[0], '馬場状態（「天候：」または「芝のクッション値」以降）が見つかりません。馬場の情報なしで進みます');
  assert.equal(horse(4).past.length, 3);
  assert.ok(P.warnings.includes('4番 テストデルタ：過去走が3件です'));
});

test('読み取り：ブリンカー', () => {
  for (const h of P.horses) assert.equal(h.blinker, h.num === 5 || h.num === 7, `${h.num}番`);
});

test('読み取り：個別の過去走', () => {
  const a = horse(2).past[0];
  assert.equal(a.venue, '園田');
  assert.equal(a.field, 11);
  assert.equal(a.gate, null);
  assert.ok(!('pop' in a));
  assert.ok(!('corners' in a));

  const b = horse(7).past[3];
  assert.equal(b.venue, 'ア首');
  assert.equal(b.bodyWeight, '計不');
  assert.equal(b.rating, 73);

  const c = horse(8).past[3];
  assert.equal(c.grade, '3勝ク');
  assert.ok(!('rating' in c));
  assert.equal(c.bodyWeight, '474kg');

  const d = horse(3).past[1];
  assert.deepEqual(d.corners, [1, 1, 1, 1]);
  assert.equal(d.going, '稍重');

  const e = horse(6).past[0];
  assert.equal(e.dist, 1200);
  assert.equal(e.surface, '芝');
  assert.equal(e.time, '1:08.5');
  assert.equal(e.last3f, 34.1);
});

test('導出：事実', () => {
  const rf = D.raceFacts;
  assert.deepEqual(rf.frontRunners.map(x => x.number), [1, 3]);
  assert.equal(rf.front3fRanking.length, 1);
  assert.equal(rf.front3fRanking[0].number, 6);
  assert.equal(rf.front3fRanking[0].best_front3f, 34.4);

  const f1 = dhorse(1).facts;
  assert.equal(f1.led, 1);
  assert.equal(f1.top2, 2);
  assert.equal(f1.jockeyChange, false);
  assert.equal(f1.daysSinceLast, 21);

  const f2 = dhorse(2).facts;
  assert.equal(f2.jockeyChange, true);
  assert.equal(f2.daysSinceLast, 66);

  assert.deepEqual(dhorse(1).past.map(p => p.firstZone), ['先頭', '中団', '好位', '中団']);
});

test('位置の区分：zoneCut', () => {
  assert.deepEqual(plain(zoneCut(16)), { a: 5, b: 11 });
  assert.deepEqual(plain(zoneCut(8)), { a: 2, b: 6 });
});
