import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';
import { trackBlock } from '../src/requests.js';

const text = readFileSync(new URL('./fixtures/jra_entry_trackday_before.txt', import.meta.url), 'utf8');
const basic = readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8');
const withPrefix = prefix => text.replace('\t天候：雨', prefix + '天候：雨');

const EXPECTED = {
  weather: '雨',
  turfGoing: '良',
  dirtGoing: '稍重',
  turfNote: '第3回テスト競馬終了後、全面でコース整備を行いました。',
  rail: 'A',
  cushion: 10.1,
  cushionTime: '10月2日（金曜）9時00分',
  turfMoisture: { goal: 12.7, corner4: 11.8 },
  announcedAt: '10月2日（金曜）正午現在',
};

for (const [name, prefix] of [['空白なし', ''], ['タブ', '\t'], ['半角スペース', ' '], ['全角スペース', '　']]) {
  test(`前日の形式：「天候：」の行の先頭が${name}でも馬場状態を読み取る`, () => {
    const P = parse(withPrefix(prefix));
    assert.deepStrictEqual(P.race.track, EXPECTED);
    assert.equal(P.horses.length, 8);
    assert.ok(!P.warnings.some(w => w.startsWith('馬場状態')));
  });
}

test('前日の形式：最後の馬の過去走に末尾の数字行が混ざらない', () => {
  const a = parse(basic).horses, b = parse(text).horses;
  assert.deepStrictEqual(b, a);
});

test('前日の形式：State の track に announced_at が入る', () => {
  const t = trackBlock(derive(parse(text)));
  assert.equal(t.announced_at, '10月2日（金曜）正午現在');
  assert.equal(t.cushion_value, 10.1);
  assert.equal(t.turf_going, '良');
});

test('当日の形式の State には announced_at を含めない', () => {
  assert.ok(!('announced_at' in trackBlock(derive(parse(basic)))));
});

test('馬場状態がない出馬表では既存の警告が出る', () => {
  const P = parse(basic);
  assert.deepStrictEqual(P.race.track, {});
  assert.equal(P.warnings[0], '馬場状態（「天候：」以降）が見つかりません。馬場の情報なしで進みます');
});

test('一部の項目がない末尾：個別の警告が出て、読み取れた項目は残る', () => {
  const cut = text.replace('クッション値\n10.1\n', '');
  const P = parse(cut);
  assert.ok(!P.warnings.includes('馬場状態：クッション値が読み取れません')); // ダートのレースでは出さない
  assert.ok(!P.warnings.some(w => w.startsWith('馬場状態（')));
  const T = P.race.track;
  assert.equal(T.weather, '雨');
  assert.equal(T.turfGoing, '良');
  assert.equal(T.dirtGoing, '稍重');
  assert.equal(T.rail, 'A');
  assert.ok(!('cushion' in T));
  assert.ok(!('cushionTime' in T));
});

test('出走馬の行より前の「天候：」を含む行を馬場状態の開始位置にしない', () => {
  const lines = text.split('\n');
  const i = lines.findIndex(l => l.startsWith('第9回'));
  lines.splice(i, 0, '\t天候：晴（本文中の別の行）');
  const P = parse(lines.join('\n'));
  assert.deepStrictEqual(P.race.track, EXPECTED);
  assert.equal(P.horses.length, 8);
  assert.equal(P.race.name, '第9回テストマイルステークスGⅢ');
});
