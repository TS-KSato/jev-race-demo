import * as jra from './jra.js';
import { validate } from './validate.js';

const ADAPTERS=[jra];

export function parse(text){
  for(const a of ADAPTERS) if(a.detect(text)){const P=a.parse(text);return {race:P.race,horses:P.horses,warnings:validate(P)};}
  throw new Error('出走馬の行（例：「枠1白」のあとにタブと馬番）が見つかりません。コピー元の形式を確認してください。');
}
