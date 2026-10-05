import { pad } from './util.js';
import { zoneRanges } from './derive.js';

const PACE_CRITERIA=['スロー：このクラス・距離としては前半が落ち着いた流れ。先行争いが起きず、先行した馬が後半まで止まりにくい',
          'ミドル：このクラス・距離として標準的な流れ。前半と後半の配分に大きな偏りがない',
          'ハイ：このクラス・距離としては前半が速い流れ。先行争いで前半が速くなり、先行した馬が後半に苦しくなる'];
/* STEP3 の pace の段階ラベル（criteria の並び順が段階 0、1、2 に対応する） */
export const paceLabels=()=>PACE_CRITERIA.map(c=>c.split('：')[0]);

/* 判断契約：Jev に送る質問の文言・選択肢と版。質問の kind はデモ内部の名前（truth・select・grade）。 */
export const RACE_OUTLOOK_V1 = { id: 'race-outlook', version: 1, label: 'race-outlook@1',
  questions(D){
    const crit={};
    D.horses.forEach(h=>{crit['h'+pad(h.num)]=`${h.num}番 ${h.name}（${h.frame}枠。直近の過去走で最初のコーナーの位置：${h.past.map(p=>p.firstZone||'不明').join('、')}）`;});
    crit.unclear='stateの情報からは、先頭で通過する馬を特定できない';
    const rn=`${D.race.name}（${D.race.distance||'?'}m）`;
    return {
      lead_horse:{kind:'select',instructions:`このレース ${rn} で、最初のコーナーを先頭で通過する馬を選ぶ。stateの\`horses\`の過去の通過位置と枠、\`race_facts.front_runners\`を根拠にする。根拠が足りない場合は unclear を選ぶ。`,criteria:crit},
      early_lead_battle:{kind:'truth',instructions:`このレース ${rn} では、序盤に2頭以上の馬が先頭を主張し、先行争いが激しくなる。stateの\`race_facts.front_runners\`と各馬の枠を根拠に判断し、それを示す根拠がstateにない場合は偽とする。`},
      pace:{kind:'grade',instructions:`このレース ${rn} の前半のペースを、このクラス・距離の標準と比べて評価する。先行しそうな馬の数と枠、\`race_facts.front_3f_ranking\`の前半3F、馬場状態を根拠にする。根拠が足りない場合は中央の段階（ミドル）とする。`,
        criteria:[...PACE_CRITERIA]}
    };
  } };

export const HORSE_POSITION_V2 = { id: 'horse-position', version: 2, label: 'horse-position@2',
  questions(D,h,ol){
    const n=D.horses.length,crit={};
    zoneRanges(n).forEach(z=>{crit[z.key]=z.key==='front'?'先頭：1番手で通過する':`${z.label}：${z.from}〜${z.to}番手で通過する`;});
    const who=`\`target\`の馬（${h.num}番 ${h.name}）`;
    const note='`race_outlook` の項目が「どちらとも言えない」「特定できない」「判断できない」の場合、その項目は根拠にしない。';
    const basis=`\`target.recent_races\`の通過位置と枠${ol?'、`race_outlook`の想定展開':''}、\`others\`の先行しそうな馬との位置関係を根拠にする。`;
    return {
      first_corner:{kind:'select',instructions:`${who}は、このレース（${n}頭立て）の最初のコーナーをどの位置で通過するか。${basis}${note}`,criteria:crit},
      last_corner:{kind:'select',instructions:`${who}は、このレース（${n}頭立て）の最後のコーナー（4コーナー）をどの位置で通過するか。${basis}${note}`,criteria:{...crit}}
    };
  } };

/* ---------- 新版（過去走の範囲と、位置取りの説明になりうる事実を明記する） ---------- */
export const EXTRA_OUTLOOK='各馬の過去走には、その走での枠の内外（`gate_position`）、騎手が今回と同じか（`jockey_same_as_today`）、今回との間隔（`days_before_today`）がある。過去の通過位置が、枠や騎手の違いによるものかを見分ける材料にしてよい。`recent_races` は記載された直近の過去走だけで、通算の傾向ではない（走った数は `effective_run_count`）。';
export const EXTRA_POSITION='`target.recent_races` の各走には、その走での枠の内外（`gate_position`）、騎手が今回と同じか（`jockey_same_as_today`）、今回との間隔（`days_before_today`）がある。今回の枠の内外は `target.gate_position`。過去の通過位置が、枠や騎手の違いによるものかを見分ける材料にしてよい。`recent_races` は記載された直近の過去走だけで、通算の傾向ではない（走った数は `target.effective_run_count`）。';

const LEAD_ANCHOR='を根拠にする。';
const NOTE_ANCHOR='`race_outlook` の項目が';

export const RACE_OUTLOOK = { id: 'race-outlook', version: 2, label: 'race-outlook@2',
  questions(D){
    const q=RACE_OUTLOOK_V1.questions(D),ins=q.lead_horse.instructions;
    const i=ins.indexOf(LEAD_ANCHOR)+LEAD_ANCHOR.length;
    q.lead_horse={...q.lead_horse,instructions:ins.slice(0,i)+EXTRA_OUTLOOK+ins.slice(i)};
    return q;
  } };

export const HORSE_POSITION = { id: 'horse-position', version: 3, label: 'horse-position@3',
  questions(D,h,ol){
    const q=HORSE_POSITION_V2.questions(D,h,ol);
    for(const k of ['first_corner','last_corner']){
      const ins=q[k].instructions,i=ins.indexOf(NOTE_ANCHOR);
      q[k]={...q[k],instructions:ins.slice(0,i)+EXTRA_POSITION+ins.slice(i)};
    }
    return q;
  } };

/* 契約の版の組（画面で選ぶ。新版が既定） */
export const CONTRACT_SETS = { new: { outlook: RACE_OUTLOOK, position: HORSE_POSITION }, old: { outlook: RACE_OUTLOOK_V1, position: HORSE_POSITION_V2 } };
export const DEFAULT_SET = 'new';
export function setOfLabel(label){
  for(const [k,v] of Object.entries(CONTRACT_SETS)) if(v.outlook.label===label||v.position.label===label) return k;
  return null;
}
