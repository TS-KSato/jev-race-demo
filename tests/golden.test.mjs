import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildResults, EXPECTED_PATH } from './helpers/build-results.mjs';

const plain = v => JSON.parse(JSON.stringify(v));

test('現行処理の結果が基準結果と一致する', () => {
  const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'));
  assert.deepStrictEqual(plain(buildResults()), plain(expected));
});
