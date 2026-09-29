import { r1, normName, toSec, daysBetween } from './util.js';

export function zoneCut(n){return {a:Math.max(2,Math.round(n*0.3)),b:Math.max(3,Math.round(n*0.7))};}
export function zoneOf(pos,n){if(pos==null||!n)return null;const {a,b}=zoneCut(n);return pos===1?'先頭':pos<=a?'好位':pos<=b?'中団':'後方';}
export function cushionCat(v){if(v==null)return null;return v>=12?'硬め':v>=10?'やや硬め':v>=8?'標準':v>7?'やや軟らかめ':'軟らかめ';}

/* ---------- STEP2: 事実の導出 ---------- */
export function derive(P){
  const R=P.race;
  const horses=P.horses.map(x=>{
    const past=(x.past||[]).map(p=>{
      const q={...p};
      q.timeSec=toSec(p.time);
      if(p.corners&&p.corners.length&&p.field){
        q.first=p.corners[0]; q.last=p.corners[p.corners.length-1];
        q.firstZone=zoneOf(q.first,p.field); q.lastZone=zoneOf(q.last,p.field);
      }
      if(p.dist===1200&&p.surface==='芝'&&q.timeSec&&p.last3f) q.front3f=r1(q.timeSec-p.last3f);
      const tags=[];
      if(R.surface&&p.surface&&p.surface!==R.surface) tags.push(p.surface==='ダ'?'ダート戦':'馬場種別が異なる');
      if(R.distance&&p.dist&&Math.abs(p.dist-R.distance)>=200) tags.push(`今回との距離差${p.dist>R.distance?'+':''}${p.dist-R.distance}m`);
      if(!p.corners) tags.push('通過順なし');
      if(p.going&&p.going!=='良') tags.push(`${p.going}馬場`);
      q.tags=tags; return q;
    });
    const withC=past.filter(p=>p.first!=null);
    const f3=past.filter(p=>p.front3f!=null).map(p=>p.front3f);
    return {...x,past,facts:{
      led:withC.filter(p=>p.first===1).length,
      top2:withC.filter(p=>p.first<=2).length,
      racesWithCorners:withC.length,
      bestFront3f:f3.length?Math.min(...f3):null,
      jockeyChange:past[0]&&past[0].jockey&&x.jockey?normName(past[0].jockey)!==normName(x.jockey):null,
      daysSinceLast:past[0]&&R.date?daysBetween(R.date,past[0].date):null
    }};
  });
  const frontRunners=horses.filter(h=>h.facts.led>0).sort((a,b)=>b.facts.led-a.facts.led||a.num-b.num)
    .map(h=>({number:h.num,name:h.name,frame:h.frame,led_count:h.facts.led,within_2nd_count:h.facts.top2}));
  const front3fRanking=horses.filter(h=>h.facts.bestFront3f!=null).sort((a,b)=>a.facts.bestFront3f-b.facts.bestFront3f)
    .map(h=>({number:h.num,name:h.name,frame:h.frame,best_front3f:h.facts.bestFront3f}));
  return {race:R,horses,raceFacts:{frontRunners,front3fRanking}};
}

