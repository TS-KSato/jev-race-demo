import { pad } from './util.js';
import { cushionCat, zoneCut } from './derive.js';

/* ---------- Jevリクエストの組み立て ---------- */
export function raceBlock(D){const R=D.race;return {name:R.name,date:R.date||null,venue:R.venue||null,course:`${R.distance||'?'}m（${R.courseDesc||'?'}）`,conditions:R.conditions||null,field_size:D.horses.length};}
export function trackBlock(D){const T=D.race.track||{};return {weather:T.weather||null,turf_going:T.turfGoing||null,turf_condition_note:T.turfNote||null,course_in_use:T.rail?`${T.rail}コース`:null,cushion_value:T.cushion??null,cushion_category:cushionCat(T.cushion),turf_moisture_pct:T.turfMoisture||null};}
export function horseBlock(h){
  return {number:h.num,frame:h.frame,name:h.name,carried_kg:h.carried??null,jockey:h.jockey||null,
    jockey_changed_from_last_race:h.facts.jockeyChange,blinker:h.blinker,
    recent_races:h.past.map(p=>({date:p.date,race:[p.race,p.grade].filter(Boolean).join(' '),
      course:`${p.venue||''} ${p.dist||'?'}${p.surface||''}`.trim(),going:p.going||null,field_size:p.field??null,finish:p.finish??null,
      corner_positions:p.corners?p.corners.join('-'):null,first_corner_zone:p.firstZone||null,last_corner_zone:p.lastZone||null,
      front_3f_sec:p.front3f??null,last_3f_sec:p.last3f??null,notes:p.tags.length?p.tags:undefined})),
    facts:{led_at_first_corner:h.facts.led,within_2nd_at_first_corner:h.facts.top2,races_with_corner_data:h.facts.racesWithCorners,
      best_front_3f_turf1200_sec:h.facts.bestFront3f,days_since_last_race:h.facts.daysSinceLast}};
}
export function raceFactsBlock(D){
  const F=D.raceFacts;
  return {explanation:'コードで計算した事実。front_runners は直近の過去走で最初のコーナーを先頭で通過した馬。front_3f_ranking は芝1200m戦の前半3F（走破時計−上がり3F）の最速値が速い順。',
    front_runners:F.frontRunners,front_3f_ranking:F.front3fRanking.slice(0,8)};
}
export function raceState(D){return {race:raceBlock(D),track:trackBlock(D),race_facts:raceFactsBlock(D),horses:D.horses.map(horseBlock)};}
export function raceQuestions(D){
  const crit={};
  D.horses.forEach(h=>{crit['h'+pad(h.num)]=`${h.num}番 ${h.name}（${h.frame}枠。直近の過去走で最初のコーナーの位置：${h.past.map(p=>p.firstZone||'不明').join('、')}）`;});
  crit.unclear='stateの情報からは、先頭で通過する馬を特定できない';
  const rn=`${D.race.name}（${D.race.distance||'?'}m）`;
  return {
    lead_horse:{type:'choice',instructions:`このレース ${rn} で、最初のコーナーを先頭で通過する馬を選ぶ。stateの\`horses\`の過去の通過位置と枠、\`race_facts.front_runners\`を根拠にする。根拠が足りない場合は unclear を選ぶ。`,criteria:crit},
    contested_lead:{type:'noul',instructions:`このレース ${rn} では、序盤に2頭以上の馬が先頭を主張し、先行争いが激しくなる。stateの\`race_facts.front_runners\`と各馬の枠を根拠に判断し、それを示す根拠がstateにない場合は偽とする。`},
    pace:{type:'score',instructions:`このレース ${rn} の前半のペースを、このクラス・距離の標準と比べて評価する。先行しそうな馬の数と枠、\`race_facts.front_3f_ranking\`の前半3F、馬場状態を根拠にする。根拠が足りない場合は中央の段階（ミドル）とする。`,
      criteria:['スロー：このクラス・距離としては前半が落ち着いた流れ。先行争いが起きず、先行した馬が後半まで止まりにくい',
        'ミドル：このクラス・距離として標準的な流れ。前半と後半の配分に大きな偏りがない',
        'ハイ：このクラス・距離としては前半が速い流れ。先行争いで前半が速くなり、先行した馬が後半に苦しくなる']}
  };
}
export function horseRequest(D,h,ol){
  const n=D.horses.length,{a,b}=zoneCut(n);
  const st={race:raceBlock(D),track:trackBlock(D)};
  if(ol) st.race_outlook=ol;
  st.target=horseBlock(h);
  st.others=D.horses.filter(o=>o!==h).map(o=>({number:o.num,frame:o.frame,name:o.name,
    recent_first_corner_zones:o.past.map(p=>p.firstZone||'不明'),led_at_first_corner:o.facts.led}));
  const crit={front:'先頭：1番手で通過する',forward:`好位：2〜${a}番手で通過する`,mid:`中団：${a+1}〜${b}番手で通過する`,rear:`後方：${b+1}〜${n}番手で通過する`};
  const who=`\`target\`の馬（${h.num}番 ${h.name}）`;
  const basis=`\`target.recent_races\`の通過位置と枠${ol?'、`race_outlook`の想定展開':''}、\`others\`の先行しそうな馬との位置関係を根拠にする。`;
  return {state:st,questions:{
    first_corner:{type:'choice',instructions:`${who}は、このレース（${n}頭立て）の最初のコーナーをどの位置で通過するか。${basis}`,criteria:crit},
    last_corner:{type:'choice',instructions:`${who}は、このレース（${n}頭立て）の最後のコーナー（4コーナー）をどの位置で通過するか。${basis}`,criteria:{...crit}}
  }};
}

