import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parse/index.js';
import * as jra from '../src/parse/jra.js';
import { FIXTURE_TEXT_PATH } from './helpers/build-results.mjs';

test('parse：架空の出馬表は jra アダプターの結果と同じになる', () => {
  const text = readFileSync(FIXTURE_TEXT_PATH, 'utf8');
  assert.ok(jra.detect(text));
  assert.deepStrictEqual(parse(text), jra.parse(text));
});

test('parse：どのアダプターにも合わない形式はエラーになる', () => {
  assert.throws(() => parse('テスト'), {
    message: '出走馬の行（例：「枠1白」のあとにタブと馬番）が見つかりません。コピー元の形式を確認してください。',
  });
});
