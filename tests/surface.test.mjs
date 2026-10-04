import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import { validate } from '../src/parse/validate.js';

const base = readFileSync(new URL('./fixtures/jra_entry_trackday_before.txt', import.meta.url), 'utf8');
const withCourse = (desc, t = base) => t.replace('（ダート・左）', `（${desc}）`);
const CUSHION = '馬場状態：クッション値が読み取れません';
const DIRT = '馬場状態：ダートの状態が読み取れません';

test('馬場種別：障害を含む表記はいずれも障と判定され、エラーで止まる', () => {
  for (const d of ['芝・障害', '障害・芝', '障害']) {
    assert.throws(() => parse(withCourse(d)), /障害レースは対象外です。平地の競走の出馬表を貼り付けてください/, d);
  }
});

test('馬場種別：ダート・右はダ、芝・右 外と芝・左は芝', () => {
  assert.equal(parse(withCourse('ダート・右')).race.surface, 'ダ');
  assert.equal(parse(withCourse('芝・右 外')).race.surface, '芝');
  assert.equal(parse(withCourse('芝・左')).race.surface, '芝');
});

test('馬場種別：判別できない表記は null で警告が出る', () => {
  const P = parse(withCourse('不明・左'));
  assert.equal(P.race.surface, null);
  assert.ok(P.warnings.includes('レース：馬場種別が判別できません'));
});

test('馬場関連の警告：芝は芝のクッション値が無いと警告、ダートは出ない', () => {
  const cut = t => t.replace('クッション値\n10.1\n', '');
  assert.ok(parse(cut(withCourse('芝・左'))).warnings.includes(CUSHION));
  assert.ok(!parse(cut(base)).warnings.includes(CUSHION));
});

test('馬場関連の警告：ダートで dirtGoing が無いと警告が出る', () => {
  const P = parse(base);
  assert.ok(!P.warnings.includes(DIRT));
  const race = { ...P.race, track: { ...P.race.track, dirtGoing: null } };
  assert.ok(validate({ race, horses: [] }).includes(DIRT));
});
