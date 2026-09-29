import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const INDEX_PATH = new URL('../../index.html', import.meta.url);

export function loadIndex() {
  const html = readFileSync(INDEX_PATH, 'utf8');
  const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/\ssrc\s*=/i.test(m[1] || ''));
  if (scripts.length !== 1) {
    throw new Error(`src 属性のない <script> が1つではありません（${scripts.length}個）`);
  }
  const code = scripts[0][2]
    + '\n;globalThis.__api={parseAll,derive,raceState,raceQuestions,horseRequest,zoneCut,zoneOf,setD:v=>{D=v;}};';
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx);
  return ctx.__api;
}
