import { pad, DATE_RE } from '../util.js';

/* ---------- STEP1: 読み取り ---------- */
export function parse(text){
  const src=text.replace(/\r\n?/g,'\n');
  const c=src.search(/^天候：/m);
  const body=c>=0?src.slice(0,c):src, tail=c>=0?src.slice(c):'';
  const re=/^枠(\d)[^\t\n]*\t\s*(\d+)/gm; const idx=[]; let m;
  while((m=re.exec(body))) idx.push({pos:m.index,frame:+m[1],num:+m[2]});
  if(!idx.length) throw new Error('出走馬の行（例：「枠1白」のあとにタブと馬番）が見つかりません。コピー元の形式を確認してください。');
  const race=parseHeader(body.slice(0,idx[0].pos));
  race.track=parseTrack(tail);
  const horses=idx.map((h,i)=>parseHorse(body.slice(h.pos,i+1<idx.length?idx[i+1].pos:body.length),h));
  return {race,horses};
}

function parseHeader(h){
  const L=h.split('\n').map(s=>s.trim()).filter(Boolean); const r={}; let m, ri=null;
  L.forEach((l,i)=>{
    if(!r.date&&(m=l.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/))){
      r.date=`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
      const v=l.match(/\d+回(\S+?)\d+日/); if(v) r.venue=v[1];
    }
    if((m=l.match(/発走時刻：(\S+)/))) r.postTime=m[1];
    if(ri==null&&(m=l.match(/^(\d{1,2})レース$/))){r.raceNo=+m[1];ri=i;}
    if((m=l.match(/コース：([\d,]+)メートル（([^）]+)）/))){
      r.distance=+m[1].replace(/,/g,''); r.courseDesc=m[2];
      r.surface=m[2].startsWith('ダ')?'ダ':m[2].startsWith('障')?'障':'芝';
      r.conditions=l.slice(0,l.indexOf('コース：')).split('\t').map(s=>s.trim()).filter(Boolean).join(' ');
    }
  });
  r.name=L.find(l=>/^第\d+回/.test(l))||(ri!=null?L.slice(ri+1).find(l=>!/ウインファイヴ|WIN5|レース目|コース：|本賞金|付加賞|印刷|着\d/.test(l)):null)||'（レース名不明）';
  return r;
}

function parseTrack(t){
  const r={}; let m;
  if(!t) return r;
  if((m=t.match(/天候：(\S+)/))) r.weather=m[1];
  if((m=t.match(/馬場状態：（芝）(\S+?)／（ダート）(\S+)/))){r.turfGoing=m[1];r.dirtGoing=m[2];}
  if((m=t.match(/（芝の状態）\s*\n([\s\S]*?)(?:\n\s*\n|\n（|$)/))) r.turfNote=m[1].replace(/\s+/g,' ').trim();
  if(r.turfNote&&(m=r.turfNote.match(/([A-D])コース/))) r.rail=m[1];
  if((m=t.match(/（芝のクッション値）\s*([\d.]+)\s*（測定([^）]+)）/))){r.cushion=+m[1];r.cushionTime=m[2];}
  if((m=t.match(/芝コース：ゴール前([\d.]+)%、4コーナー([\d.]+)%/))) r.turfMoisture={goal:+m[1],corner4:+m[2]};
  return r;
}

function parseHorse(block,h){
  const L=block.split('\n').map(s=>s.trim());
  const fp=L.findIndex(l=>DATE_RE.test(l));
  const prof=(fp>=0?L.slice(0,fp):L).filter(Boolean);
  const x={num:h.num,frame:h.frame,blinker:prof.some(l=>/ブリンカー/.test(l))};
  const ni=prof.findIndex((l,k)=>k>0&&!/ブリンカー/.test(l));
  x.name=ni>0?prof[ni].replace(/\t.*$/,''):null;
  let m, ci=-1;
  prof.forEach((l,k)=>{
    if(k<=ni) return;
    if(x.odds==null&&/^\d+\.\d$/.test(l)) x.odds=+l;
    else if((m=l.match(/^\((\d+)番人気\)$/))) x.pop=+m[1];
    else if(x.bodyWeight==null&&(m=l.match(/^(\d{3})kg(?:\(([^)]*)\))?$/))){x.bodyWeight=+m[1];x.bodyWeightDiff=m[2]??null;}
    else if((m=l.match(/^(.+)\((美浦|栗東)\)$/))) x.trainer=m[1].trim()+'（'+m[2]+'）';
    else if((m=l.match(/^父：(.+)$/))) x.sire=m[1];
    else if((m=l.match(/^\(母の父：(.+)\)$/))) x.damSire=m[1];
    else if((m=l.match(/^母：(.+)$/))) x.dam=m[1];
    else if((m=l.match(/^(牡|牝|セ|せん)(\d+)\/(.+)$/))){x.sex=m[1]==='せん'?'セ':m[1];x.age=+m[2];}
    else if(x.carried==null&&(m=l.match(/^(\d+(?:\.\d)?)kg$/))){x.carried=+m[1];ci=k;}
  });
  if(ci>=0){
    x.jockey=prof[ci+1]||null;
    if(/^\d{2,3}$/.test(prof[ci+2]||'')){
      x.rating=+prof[ci+2];
      if(/^[SMILE](,[SMILE])*$/.test(prof[ci+3]||'')) x.ratingCategory=prof[ci+3];
    }
  }
  x.past=fp>=0?parsePast(L.slice(fp)):[];
  return x;
}

function parsePast(lines){
  const races=[]; let cur=null;
  lines.forEach(l=>{
    const m=l.match(DATE_RE);
    if(m){cur={date:`${m[1]}-${pad(m[2])}-${pad(m[3])}`,venue:m[4],lines:[]};races.push(cur);}
    else if(cur&&l) cur.lines.push(l);
  });
  return races.map(parseRace);
}

function parseRace(r){
  const o={date:r.date,venue:r.venue}; const ne=r.lines;
  const parts=(ne[0]||'').split('\t').map(s=>s.trim()).filter(Boolean);
  o.race=parts[0]||''; o.grade=parts[1]||'';
  let afterBw=false, m;
  for(let j=1;j<ne.length;j++){
    const l=ne[j];
    if(o.field===undefined&&(m=l.match(/^(\S+?)\t(\d+)頭(?:(\d+)番)?$/))){
      o.finish=/^\d+着$/.test(m[1])?parseInt(m[1]):m[1]; o.field=+m[2]; o.gate=m[3]?+m[3]:null; continue;
    }
    if((m=l.match(/^(\d+)番人気$/))){o.pop=+m[1];continue;}
    if(o.jockey===undefined&&(m=l.match(/^(.+?)\t(\d+\.\d)kg$/))){o.jockey=m[1].trim();o.carried=+m[2];continue;}
    if(o.dist===undefined&&(m=l.match(/^(\d{3,4})(芝|ダ|障)/))){o.dist=+m[1];o.surface=m[2];continue;}
    if(o.dist!==undefined&&o.time===undefined&&/^(?:\d+:)?\d+\.\d$/.test(l)){o.time=l;continue;}
    if(!o.going&&/^(良|稍重|重|不良)$/.test(l)){o.going=l;continue;}
    if(!afterBw&&(m=l.match(/^(\d+kg|計不)$/))){o.bodyWeight=m[1];afterBw=true;continue;}
    if(!afterBw&&o.going&&/^\d{2,3}$/.test(l)){o.rating=+l;continue;}
    if(afterBw){
      const f=l.match(/3F\s*(\d+\.\d)/);
      if(f){
        o.last3f=+f[1];
        const rest=l.replace(/3F\s*\d+\.\d/,'').trim();
        if(rest&&/^\d+(\s+\d+)*$/.test(rest)) o.corners=rest.split(/\s+/).map(Number);
        continue;
      }
      if(/^\d+(\s+\d+)*$/.test(l)){o.corners=l.split(/\s+/).map(Number);continue;}
      if((m=l.match(/^(.+)\((-?\d+\.\d)\)$/))){o.vs=m[1];o.margin=+m[2];continue;}
    }
  }
  return o;
}

export function detect(text){
  const src=text.replace(/\r\n?/g,'\n'),c=src.search(/^天候：/m);
  return /^枠\d[^\t\n]*\t\s*\d+/m.test(c>=0?src.slice(0,c):src);
}
