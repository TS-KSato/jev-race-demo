import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse/index.js';
import { derive } from '../src/derive.js';
import { RACE_OUTLOOK, HORSE_POSITION } from '../src/contracts.js';
import { readFileSync } from 'node:fs';

const D = derive(parse(readFileSync(new URL('./fixtures/jra_entry_basic.txt', import.meta.url), 'utf8')));

test('契約の label', () => {
  assert.equal(RACE_OUTLOOK.label, 'race-outlook@1');
  assert.equal(HORSE_POSITION.label, 'horse-position@2');
});
test('RACE_OUTLOOK の質問', () => {
  const q = RACE_OUTLOOK.questions(D);
  assert.deepEqual(Object.keys(q), ['lead_horse', 'early_lead_battle', 'pace']);
  assert.deepEqual(Object.values(q).map(x => x.kind), ['select', 'truth', 'grade']);
});
test('HORSE_POSITION の質問', () => {
  const q = HORSE_POSITION.questions(D, D.horses[0], null);
  assert.deepEqual(Object.keys(q), ['first_corner', 'last_corner']);
  assert.deepEqual(Object.values(q).map(x => x.kind), ['select', 'select']);
});
