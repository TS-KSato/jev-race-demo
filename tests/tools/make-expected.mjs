import { writeFileSync } from 'node:fs';
import { buildResults, EXPECTED_PATH } from '../helpers/build-results.mjs';

writeFileSync(EXPECTED_PATH, JSON.stringify(buildResults(), null, 2) + '\n');
