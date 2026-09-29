import { readFileSync } from 'node:fs';
import { parse } from '../../src/parse/index.js';
import { derive } from '../../src/derive.js';
import { raceState, raceQuestions, horseRequest } from '../../src/requests.js';

export const FIXTURE_TEXT_PATH = new URL('../fixtures/jra_entry_basic.txt', import.meta.url);
export const EXPECTED_PATH = new URL('../fixtures/jra_entry_basic.expected.json', import.meta.url);

const OUTLOOK = {
  note: 'STEP3でJevが推定した展開。確定した事実ではない',
  expected_leader: '1番 テストアルファ',
  early_lead_battle: '激しくなる',
  pace: 'ミドル',
};

export function buildResults() {
  const text = readFileSync(FIXTURE_TEXT_PATH, 'utf8');
  const P = parse(text);
  const Dv = derive(P);
  return {
    parsed: P,
    derived: Dv,
    raceRequest: { state: raceState(Dv), questions: raceQuestions(Dv) },
    horseRequests: {
      noOutlook: Dv.horses.map(h => horseRequest(Dv, h, null)),
      withOutlook: Dv.horses.map(h => horseRequest(Dv, h, OUTLOOK)),
    },
  };
}
