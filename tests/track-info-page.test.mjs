import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';

const basic = readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8');
const BLOCK = [
    '第9回テスト競馬第3日（2031年11月2日（日曜））',
    '芝のクッション値',
    'クッション値の基礎知識',
    '測定時刻',
    '',
    '11月2日（日曜）7時00分',
    ' 変更',
    'クッション値',
    '10.4',
    '',
    '121087',
    '10.4',
    '硬め やや硬め 標準 やや軟らか 軟らか',
    'クッション値とクッション性との関係性（参考）',
    '芝馬場のクッション値\t馬場表層のクッション性',
    '12以上\t硬め',
    '10から12\tやや硬め',
    '8から10\t標準',
    '7から8\tやや軟らかめ',
    '7以下\t軟らかめ',
    '含水率',
    '含水率に関する基礎知識',
    '測定時刻',
    '',
    '11月2日（日曜）5時30分',
    ' 変更',
    'ゴール前と4コーナーの含水率',
    'ゴール前\t4コーナー',
    '芝\t12.4%\t12.9%',
    'ダート\t4.1%\t4.0%',
    '含水率表',
    '芝コース',
    '含水率\t馬場状態',
    '良\t稍重\t重\t不良',
    '乾燥\t\t\t',
    '12%\t\t\t',
    '15%\t\t\t',
    '湿潤\t\t\t',
    '注記：特になし',
    '週間情報',
    '10月24日（金曜）から11月2日（日曜）\t11月2日（日曜）8時現在',
    '天候\t曇',
    '曇',
    '雨',
    '雨',
    '雨量',
    '（ミリメートル）',
    '0.0\t8.5\t0.5\t4.0\t36.5\t11.5\t0.0\t0.5\t0.0\t0.0',
    '芝コースの散水\tなし\tなし\tなし\tなし\tなし\tなし\tなし\tあり\tあり\tなし',
    'スクロールできます',
    '使用コース',
    'Aコース（内柵を最内に設置）',
    '',
    '芝の状態',
    'テスト用の芝の状態の説明です。全体的に良好な状態です。',
].join('\n');
const NO_TITLE = BLOCK.split('\n').slice(1).join('\n');
const base = parse(basic);
const lastOf = P => P.horses[P.horses.length - 1];
const WEEKLY = '週間情報（天候・雨量・散水）は読み取りません。クッション値・含水率・使用コース・芝の状態だけを使います';
const IGNORED = '馬場情報らしい文字がありますが、読み取れる形式ではありませんでした。「天候：」の行、または「芝のクッション値」の見出しを含めて貼り付けてください';
const EXPECTED_TRACK = {
  cushion: 10.4, cushionTime: '11月2日（日曜）7時00分', turfMoisture: { goal: 12.4, corner4: 12.9 },
  rail: 'A', turfNote: 'テスト用の芝の状態の説明です。全体的に良好な状態です。',
};

for (const [label, blk] of [['題名の行あり', BLOCK], ['題名の行なし', NO_TITLE]]) {
  test(`馬場情報のページ（${label}）：race.track が読み取れる`, () => {
    const P = parse(basic + '\n' + blk);
    assert.deepStrictEqual(P.race.track, EXPECTED_TRACK);
    assert.ok(!P.race.trackTextIgnored);
  });
  test(`馬場情報のページ（${label}）：馬の読み取り結果が変わらない`, () => {
    const P = parse(basic + '\n' + blk);
    assert.deepStrictEqual(P.horses, base.horses);
    assert.deepStrictEqual(lastOf(P).past.at(-1).corners, lastOf(base).past.at(-1).corners);
  });
  test(`馬場情報のページ（${label}）：警告`, () => {
    const W = parse(basic + '\n' + blk).warnings;
    assert.ok(!W.some(w => w.startsWith('馬場状態（') && w.includes('見つかりません')));
    assert.ok(W.includes('馬場状態：天候が読み取れません'));
    assert.ok(W.includes('馬場状態：芝の状態が読み取れません'));
    assert.ok(W.includes('馬場状態：ダートの状態が読み取れません'));
  });
}

test('週間情報の警告：馬場情報のページで1件、行がなければ出ない', () => {
  assert.equal(parse(basic + '\n' + BLOCK).warnings.filter(w => w === WEEKLY).length, 1);
  const noWeekly = BLOCK.split('\n').filter(l => l !== '週間情報').join('\n');
  assert.ok(!parse(basic + '\n' + noWeekly).warnings.includes(WEEKLY));
  const before = readFileSync(new URL('./fixtures/jra_entry_trackday_before.txt', import.meta.url), 'utf8');
  assert.ok(!parse(before).warnings.includes(WEEKLY));
});

test('通過順の妥当性：頭数を超える通過順は読み取らず、警告を出す', () => {
  const src = basic.replace('\n1\t1\n3F 36.2', '\n121087\n3F 36.2');
  assert.notEqual(src, basic);
  const P = parse(src);
  const p = P.horses[0].past[0], q = base.horses[0].past[0];
  assert.equal(p.corners, undefined);
  assert.equal(p.cornersRaw, '121087');
  assert.deepStrictEqual(q.corners, [1, 1]);
  const tag = `${P.horses[0].num}番 ${P.horses[0].name}：${p.date} ${p.race}`;
  assert.equal(P.warnings.filter(w => w === `${tag} の通過順「121087」が頭数（${p.field}）と合わないため、読み取りません`).length, 1);
  assert.ok(!P.warnings.includes(`${tag} に通過順がありません（海外・地方・直線競馬など）`));
  assert.deepStrictEqual(P.horses[0].past.slice(1), base.horses[0].past.slice(1));
});

test('過去走のブロックの終わり：着差の行の後ろの数字の行は読まない', () => {
  const src = basic.replace('(0.4)\n', '(0.4)\n121087\n');
  assert.notEqual(src, basic);
  assert.deepStrictEqual(parse(src).horses, base.horses);
});

test('見出しの形でない行だけでは読み取れず、警告が1件出る', () => {
  const P = parse(basic + '\nクッション値 9.9\n');
  assert.equal(P.race.trackTextIgnored, true);
  assert.equal(P.warnings.filter(w => w === IGNORED).length, 1);
  assert.ok(!parse(basic + '\n' + BLOCK).warnings.includes(IGNORED));
});
