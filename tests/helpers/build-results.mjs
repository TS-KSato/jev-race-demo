import { readFileSync } from 'node:fs';
import { loadIndex } from './load-index.mjs';

export const FIXTURE_TEXT_PATH = new URL('../fixtures/jra_entry_basic.txt', import.meta.url);
export const EXPECTED_PATH = new URL('../fixtures/jra_entry_basic.expected.json', import.meta.url);

const OUTLOOK = {
  note: 'STEP3でJevが推定した展開。確定した事実ではない',
  expected_leader: '1番 テストアルファ',
  early_lead_battle: '激しくなる',
  pace: 'ミドル',
};

export function buildResults(api = loadIndex()) {
  const text = readFileSync(FIXTURE_TEXT_PATH, 'utf8');
  const P = api.parseAll(text);
  const Dv = api.derive(P);
  api.setD(Dv);
  return {
    parsed: P,
    derived: Dv,
    raceRequest: { state: api.raceState(), questions: api.raceQuestions() },
    horseRequests: {
      noOutlook: Dv.horses.map(h => api.horseRequest(h, null)),
      withOutlook: Dv.horses.map(h => api.horseRequest(h, OUTLOOK)),
    },
  };
}
