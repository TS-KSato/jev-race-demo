import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';

const SRC = readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8');
const NAME = 'テストアルファ';
const withName = raw => {
  const t = SRC.replace(`\n${NAME}\n`, `\n${raw}\n`);
  assert.notEqual(t, SRC);
  return parse(t);
};
const nameWarnings = P => P.warnings.filter(w => w.includes('未知の付記'));

test('未知の付記が付いた馬は警告が1件出て、name_raw が元の文字列になる', () => {
  const P = withName('テスト付記' + NAME);
  const w = nameWarnings(P);
  assert.equal(w.length, 1);
  const x = P.horses.find(h => h.name_raw === 'テスト付記' + NAME);
  assert.ok(x);
  assert.equal(w[0], `${x.num}番 テスト付記${NAME}：馬名に、カタカナ以外の文字が含まれています（未知の付記の可能性）`);
});

test('既知の付記（マルガイ）が付いた馬は警告が出ず、付記が取り出される', () => {
  const P = withName('マルガイ' + NAME);
  assert.equal(nameWarnings(P).length, 0);
  const x = P.horses.find(h => h.name_raw === 'マルガイ' + NAME);
  assert.equal(x.name, NAME);
  assert.deepEqual(x.markers, ['マルガイ']);
});

test('付記のない通常の馬では警告が出ず、既存の警告は変わらない', () => {
  const base = parse(SRC);
  assert.equal(nameWarnings(base).length, 0);
  assert.deepEqual(withName('マルガイ' + NAME).warnings, base.warnings);
});
