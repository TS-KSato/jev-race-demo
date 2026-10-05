import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';
import { raceState } from '../src/requests.js';
import { parseResult, NAME_MARKERS, splitName } from '../src/parse/result.js';
import { FIXTURE_TEXT_PATH } from './helpers/build-results.mjs';

const text = readFileSync(FIXTURE_TEXT_PATH, 'utf8');
const DATE_LINE = /^\d{4}年\d{1,2}月\d{1,2}日/;
const ROW_LINE = /^枠\d/;
const WINNER_LINE = /\(-?\d+\.\d\)$/;

// num 番の馬の、最初の count 件の過去走を、出走せず（word）の構造に書き換える
function toDnr(src, num, count, word) {
  const L = src.split('\n');
  const start = L.findIndex(l => ROW_LINE.test(l) && l.split('\t')[1].trim() === String(num));
  assert.ok(start >= 0);
  let done = 0;
  for (let i = start + 1; i < L.length && done < count; i++) {
    if (ROW_LINE.test(L[i])) break;
    if (!DATE_LINE.test(L[i])) continue;
    const end = L.findIndex((l, k) => k > i && WINNER_LINE.test(l));
    assert.ok(end > i);
    const race = L[i + 1];
    const winner = L[end].replace(/\(-?\d+\.\d\)$/, '');
    L.splice(i + 1, end - i, race, `${word}\t17頭5番`, winner);
    done++;
  }
  assert.equal(done, count);
  return L.join('\n');
}
const horse = (P, n) => P.horses.find(h => h.num === n);
const days = (a, b) => Math.round((Date.UTC(...a.split('-').map((v, i) => i === 1 ? v - 1 : +v)) - Date.UTC(...b.split('-').map((v, i) => i === 1 ? v - 1 : +v))) / 864e5);
const orig = parse(text);
const o1 = horse(orig, 1);
const dateOfRace = orig.race.date;

test('(a) 除外の過去走：件数は変わらず、finish と tags が出走せず', () => {
  const P = parse(toDnr(text, 1, 1, '除外'));
  const h = horse(derive(P), 1);
  assert.equal(h.past.length, o1.past.length);
  assert.equal(h.past[0].finish, '除外');
  assert.ok(h.past[0].tags.includes('出走せず（除外）'));
  assert.ok(!h.past[0].tags.includes('通過順なし'));
  assert.equal(h.past[0].firstZone, undefined);
});

test('(b) jockeyChange と daysSinceLast は2つ目の過去走が基準', () => {
  const h = horse(derive(parse(toDnr(text, 1, 1, '除外'))), 1);
  const base = o1.past[1];
  assert.equal(h.facts.daysSinceLast, days(dateOfRace, base.date));
  assert.equal(h.facts.jockeyChange, base.jockey.replace(/\s+/g, '') !== o1.jockey.replace(/\s+/g, ''));
  // 加工前は1つ目が基準
  const h0 = horse(derive(orig), 1);
  assert.equal(h0.facts.daysSinceLast, days(dateOfRace, o1.past[0].date));
});

test('(c) 除外が連続すると3つ目が基準、全部なら null', () => {
  const h2 = horse(derive(parse(toDnr(text, 1, 2, '除外'))), 1);
  assert.equal(h2.facts.daysSinceLast, days(dateOfRace, o1.past[2].date));
  assert.equal(h2.facts.jockeyChange, o1.past[2].jockey.replace(/\s+/g, '') !== o1.jockey.replace(/\s+/g, ''));
  const hAll = horse(derive(parse(toDnr(text, 1, o1.past.length, '除外'))), 1);
  assert.equal(hAll.facts.daysSinceLast, null);
  assert.equal(hAll.facts.jockeyChange, null);
});

test('(d) 取消も同じ。中止・失格は前走として数える', () => {
  const hc = horse(derive(parse(toDnr(text, 1, 1, '取消'))), 1);
  assert.ok(hc.past[0].tags.includes('出走せず（取消）'));
  assert.equal(hc.facts.daysSinceLast, days(dateOfRace, o1.past[1].date));
  for (const w of ['中止', '失格']) {
    const h = horse(derive(parse(toDnr(text, 1, 1, w))), 1);
    assert.equal(h.past[0].finish, w);
    assert.ok(!h.past[0].tags.some(t => t.startsWith('出走せず')));
    assert.equal(h.facts.daysSinceLast, days(dateOfRace, o1.past[0].date));
  }
});

test('(e) 警告：出走せずは専用の1件、走ったが通過順なしは従来の警告', () => {
  const noCorner = w => w.includes('に通過順がありません');
  const base = parse(text).warnings;
  const P = parse(toDnr(text, 1, 1, '除外'));
  const date = o1.past[0].date, race = o1.past[0].race;
  const tag = `1番 ${o1.name}`;
  assert.ok(!P.warnings.includes(`${tag}：${date} ${race} に通過順がありません（海外・地方・直線競馬など）`));
  const dnrW = P.warnings.filter(w => w.includes('出走せず'));
  assert.deepEqual(dnrW, [`${tag}：${date} ${race} は出走せず（除外）のため、前走として数えません`]);
  assert.equal(P.warnings.filter(noCorner).length, base.filter(noCorner).length);
  assert.equal(P.warnings.length, base.length + 1);
  assert.ok(parse(toDnr(text, 1, 1, '取消')).warnings.some(w => w.includes('出走せず（取消）のため')));
  // 走ったが通過順がない過去走（通過順の行だけ消す）
  const L = text.split('\n');
  const s = L.findIndex(l => ROW_LINE.test(l) && l.split('\t')[1].trim() === '1');
  const d = L.findIndex((l, k) => k > s && DATE_LINE.test(l));
  const c = L.findIndex((l, k) => k > d && /^\d+(\t\d+)*$/.test(l) && /^3F/.test(L[k + 1] || ''));
  assert.ok(c > d);
  L.splice(c, 1);
  const W = parse(L.join('\n')).warnings;
  assert.ok(W.includes(`${tag}：${date} ${race} に通過順がありません（海外・地方・直線競馬など）`));
  assert.ok(!W.some(w => w.includes('出走せず')));
});

test('(f) 馬名の付記マルガイ：name・markers・name_raw', () => {
  const t = text.replace(`\n${o1.name}\n`, `\nマルガイ${o1.name}\n`);
  assert.notEqual(t, text);
  const P = parse(t);
  const h = horse(P, 1);
  assert.deepEqual([h.name, h.markers, h.name_raw], [o1.name, ['マルガイ'], `マルガイ${o1.name}`]);
  assert.deepEqual(horse(P, 2).markers, []);
  assert.equal(horse(P, 2).name_raw, horse(P, 2).name);
  assert.ok(!P.warnings.some(w => w.includes('マルガイ')));
  assert.equal(horse(derive(P), 1).name, o1.name);
  assert.deepEqual(splitName('カクガイテスト').markers, ['カクガイ']);
  assert.ok(!NAME_MARKERS.prefix.includes('マルチ'));
  assert.deepEqual(splitName('マルガイ'), { name: 'マルガイ', markers: [] });
});

test('(g) 結果ページ：マルガイ付きの馬名も分ける', () => {
  const T = '\t';
  const t = readFileSync(new URL('./fixtures/result_a.txt', import.meta.url), 'utf8')
    .replace(`2${T}枠2黒${T}2${T}テストベータ${T}`, `2${T}枠2黒${T}2${T}マルガイテストベータ${T}`);
  const h = parseResult(t).horses.find(x => x.number === 2);
  assert.deepEqual([h.name, h.markers, h.name_raw], ['テストベータ', ['マルガイ'], 'マルガイテストベータ']);
});

test('(h) recent_races[].notes に出走せずが載る', () => {
  const D = derive(parse(toDnr(text, 1, 1, '除外')));
  const r = raceState(D).horses.find(h => h.number === 1).recent_races;
  assert.ok(r[0].notes.includes('出走せず（除外）'));
  assert.ok(!r[0].notes.includes('通過順なし'));
  assert.ok(!r[1].notes || !r[1].notes.some(n => n.startsWith('出走せず')));
});
