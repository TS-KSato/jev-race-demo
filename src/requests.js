import { cushionCat } from './derive.js';
import { CONTRACT_SETS, DEFAULT_SET } from './contracts.js';

const RECENT_SCOPE='記載された直近の過去走のみ（通算の傾向ではない）。取消・除外は『出走せず』として表示し、数えない';

/* ---------- Jevリクエストの組み立て ---------- */
export function raceBlock(D){const R=D.race;return {name:R.name,date:R.date||null,venue:R.venue||null,course:`${R.distance||'?'}m（${R.courseDesc||'?'}）`,conditions:R.conditions||null,field_size:D.horses.length};}
export function trackBlock(D){const T=D.race.track||{};return {weather:T.weather||null,turf_going:T.turfGoing||null,turf_condition_note:T.turfNote||null,course_in_use:T.rail?`${T.rail}コース`:null,cushion_value:T.cushion??null,cushion_category:cushionCat(T.cushion),turf_moisture_pct:T.turfMoisture||null,...(T.announcedAt?{announced_at:T.announcedAt}:{})};}
export function horseBlock(h,set=DEFAULT_SET){
  const nw=set==='new';
  return {number:h.num,frame:h.frame,name:h.name,carried_kg:h.carried??null,jockey:h.jockey||null,
    jockey_changed_from_last_race:h.facts.jockeyChange,blinker:h.blinker,
    recent_races:h.past.map(p=>({date:p.date,race:[p.race,p.grade].filter(Boolean).join(' '),
      course:`${p.venue||''} ${p.dist||'?'}${p.surface||''}`.trim(),going:p.going||null,field_size:p.field??null,finish:p.finish??null,
      corner_positions:p.corners?p.corners.join('-'):null,first_corner_zone:p.firstZone||null,last_corner_zone:p.lastZone||null,
      front_3f_sec:p.front3f??null,last_3f_sec:p.last3f??null,notes:p.tags.length?p.tags:undefined,
      ...(nw?{gate_position:p.gatePos,jockey_same_as_today:p.jockeySame,days_before_today:p.daysBefore}:{})})),
    ...(nw?{gate_position:h.facts.gatePos,effective_run_count:h.facts.ranCount,recent_races_scope:RECENT_SCOPE}:{}),
    facts:{led_at_first_corner:h.facts.led,within_2nd_at_first_corner:h.facts.top2,races_with_corner_data:h.facts.racesWithCorners,
      best_front_3f_turf1200_sec:h.facts.bestFront3f,days_since_last_race:h.facts.daysSinceLast}};
}
export function raceFactsBlock(D){
  const F=D.raceFacts;
  return {explanation:'コードで計算した事実。front_runners は直近の過去走で最初のコーナーを先頭で通過した馬。front_3f_ranking は芝1200m戦の前半3F（走破時計−上がり3F）の最速値が速い順。',
    front_runners:F.frontRunners,front_3f_ranking:F.front3fRanking.slice(0,8)};
}
export function raceState(D,set=DEFAULT_SET){return {race:raceBlock(D),track:trackBlock(D),race_facts:raceFactsBlock(D),horses:D.horses.map(h=>horseBlock(h,set))};}
export function raceQuestions(D,set=DEFAULT_SET){return CONTRACT_SETS[set].outlook.questions(D);}
export function horseRequest(D,h,ol,set=DEFAULT_SET){
  const st={race:raceBlock(D),track:trackBlock(D)};
  if(ol) st.race_outlook=ol;
  st.target=horseBlock(h,set);
  st.others=D.horses.filter(o=>o!==h).map(o=>({number:o.num,frame:o.frame,name:o.name,
    recent_first_corner_zones:o.past.map(p=>p.firstZone||'不明'),led_at_first_corner:o.facts.led}));
  return {state:st,questions:CONTRACT_SETS[set].position.questions(D,h,ol)};
}
