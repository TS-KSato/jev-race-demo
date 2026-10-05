import { r1, toSec } from '../util.js';
import { zoneOf } from '../derive.js';
import { parseCornerLine } from './corners.js';
import { NAME_MARKERS, NAME_OK_RE, splitName } from './markers.js';

export { NAME_MARKERS, splitName };

/* ---------- レース結果ページの読み取り（race-result@1） ---------- */
const SCHEMA='race-result@1';
const NOT_STARTED=['取消','除外'];
const STATUS_WORDS=['取消','除外','中止','失格'];
const FINISH_RE=/^(\d+)\s*(?:[(（](.*)[)）])?$/;
const FRAME_RE=/^(?:枠\d+\S*|\d+)$/;
const POS_LINE_RE=/^\s*\d+(?: \d+){1,3}\s*$/;
const DATE_LINE_RE=/^[ \t　]*\d{4}年\d{1,2}月\d{1,2}日/;
const COURSE_RE=/(?:コース[\s　]*)?(\d{3,4})m[\s　]*(芝|ダート|ダ)(?:・(右|左|直線))?(?:[・\s　]*((?:内|外)[内外回り]*))?/;
const COURSE_A_RE=/コース：([\d,]+)メートル（([^）]*)）/;
const GRADES={'Ⅰ':'G1','I':'G1','1':'G1','Ⅱ':'G2','II':'G2','2':'G2','Ⅲ':'G3','III':'G3','3':'G3'};
const GRADE_RE=/[(（]?G(III|II|I|Ⅰ|Ⅱ|Ⅲ|[123])[)）]?\s*$/;

/* 騎手名に付く減量の記号 */
export const JOCKEY_MARKS=['★','▲','△','☆','◇'];

const W=(code,message)=>({code,message});
const tenths=t=>{const v=toSec(t);return v==null?null:Math.round(v*10);};
const sec=t=>t==null?null:r1(t/10);
const emptyStr=s=>s==null||s.trim()==='';
const intOrNull=s=>{const m=String(s==null?'':s).trim().match(/^([+-]?)(\d+)$/);return m?(m[1]==='-'?-1:1)*+m[2]:null;};

function isHorseRow(line){
  const f=line.split('\t');
  if(f.length<3) return false;
  const t=f[0].trim();
  const named=f.length>=4&&f[3].trim()!=='';
  // 馬名の項目は空でもよい（形式 A で馬名の行が分かれる馬）。着順が未知の語のときだけ馬名を求める
  const tokenOk=FINISH_RE.test(t)||STATUS_WORDS.includes(t)||(named&&t&&t.length<=4&&!/^枠|[\s\d]/.test(t));
  return tokenOk&&FRAME_RE.test(f[1].trim())&&/^\d+$/.test(f[2].trim());
}

function splitJockey(raw){
  let j=raw;const removed=[];
  while(j.length>1&&JOCKEY_MARKS.includes(j[0])){removed.push(j[0]);j=j.slice(1);}
  while(j.length>1&&JOCKEY_MARKS.includes(j[j.length-1])){removed.push(j[j.length-1]);j=j.slice(0,-1);}
  return j.trim()===''?{jockey:raw,mark:null}:{jockey:j.trim(),mark:removed.length?removed.join(''):null};
}

function baseHorse(f0,fr,no,nameRaw){
  const t=f0.trim(),m=t.match(FINISH_RE),raw=nameRaw.trim(),sn=splitName(raw),h={finish:null,status:null,finish_note:null,frame:null,number:+no.trim(),name:sn.name,name_raw:raw,markers:sn.markers};
  if(m){h.finish=+m[1];if(m[2]!=null&&m[2]!=='') h.finish_note=m[2];}
  else h.status=t;
  const fm=fr.trim().match(/^(?:枠)?(\d+)/);h.frame=fm?+fm[1]:null;
  return h;
}
const bodyWeightA=s=>{const m=String(s||'').trim().match(/^(\d+)\s*[(（]([^)）]*)[)）]$/);return m?{w:+m[1],d:intOrNull(m[2])}:{w:intOrNull(s),d:null};};

/* 馬の行を読む。形式 A は3行、B・C は1行 */
function readHorses(lines,rowIdx,fmt,warnings){
  const horses=[];
  rowIdx.forEach(i=>{
    const f=lines[i].split('\t');
    let b=null,j=i+1,nameRaw=f[3]||'';
    if(fmt==='A'){
      b=f.slice(4);
      if(emptyStr(f[3])){ // 馬名が別の行にある：次の空でない行が馬名、その次の行から性齢以降
        let k=i+1;while(k<lines.length&&emptyStr(lines[k])) k++;
        const bad=l=>l==null||emptyStr(l)||POS_LINE_RE.test(l)||isHorseRow(l);
        if(k>=lines.length||bad(lines[k])||/\t/.test(lines[k].trim())||bad(lines[k+1])){
          warnings.push(W('row_unparsed',`${i+1}行目：馬の行として読めませんでした`));
          return;
        }
        nameRaw=lines[k];b=lines[k+1].split('\t');j=k+2;
      }
    }
    const h=baseHorse(f[0],f[1],f[2],nameRaw);
    if(!NAME_OK_RE.test(h.name)) warnings.push(W('name_unusual',`${h.number}番：馬名に、カタカナ以外の文字が含まれています（馬具や区分の表記が付いている可能性があります）：${h.name_raw}`));
    if(fmt==='A'){
      Object.assign(h,{sex_age:b[0]||'',weight_carried:b[1]||'',jockey:(b[2]||'').trim(),time:null,margin:'',last_3f_est:null,body_weight:null,body_weight_diff:null,trainer:'',popularity:null,corner_positions:[]});
      const notRan=STATUS_WORDS.includes(h.status);
      if(j<lines.length&&emptyStr(lines[j])&&!isHorseRow(lines[j])) j++; // 空白だけの行
      let pos=null;
      if(!notRan&&j<=lines.length&&POS_LINE_RE.test(lines[j]||'')){pos=lines[j].trim().split(' ').map(Number);j++;}
      else if(notRan&&POS_LINE_RE.test(lines[j]||'')){pos=lines[j].trim().split(' ').map(Number);j++;}
      const g=(lines[j]||'').split('\t');
      h.time=tenths(b[3]);h.margin=emptyStr(b[4])?'':b[4];
      if(notRan&&!pos){h.trainer=(g[0]||'').trim();}
      else{
        h.last_3f_est=emptyStr(g[0])?null:(tenths(g[0].trim())); // 秒（小数1桁）に直すため仮に0.1秒単位
        const bw=bodyWeightA(g[1]);h.body_weight=bw.w;h.body_weight_diff=bw.d;
        h.trainer=(g[2]||'').trim();h.popularity=intOrNull(g[3]);
      }
      h._pos=pos;h._end=j+1;
      h.corner_positions=pos?pos.map(rank=>({corner:null,rank})):[];
    }else{
      const g=f;
      Object.assign(h,{sex_age:g[4]||'',weight_carried:g[5]||'',jockey:(g[7]||'').trim(),time:tenths(g[8]),margin:emptyStr(g[9])?'':g[9],last_3f_est:emptyStr(g[10])?null:tenths(g[10].trim()),body_weight:intOrNull(g[11]),body_weight_diff:intOrNull(g[12]),trainer:(g[13]||'').trim(),popularity:intOrNull(g[14]),corner_positions:null});
    }
    h.jockey_raw=h.jockey;
    const sj=splitJockey(h.jockey_raw);h.jockey=sj.jockey;h.jockey_mark=sj.mark;
    horses.push(h);
  });
  return horses;
}

function parseRaceInfo(header,fmt){
  const r={date:null,venue:null,kai:null,nichi:null,race_no:null,name:null,name_raw:null,grade:null,surface:null,distance:null,turn:null,course_detail:null,weather:null,going:{turf:null,dirt:null},starters:null,scratched:null};
  const d=header.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if(d) r.date=`${d[1]}-${d[2].padStart(2,'0')}-${d[3].padStart(2,'0')}`;
  const k=header.match(/(\d+)回([^\d\s　\t]+?)(\d+)日/);
  if(k){r.kai=+k[1];r.venue=k[2];r.nichi=+k[3];}
  let nameRaw=null;
  if(fmt==='A'){
    const n=header.match(/(?:^|\n)[ \t　]*(\d+)レース[ \t　]*(?=\n|$)/);
    if(n) r.race_no=+n[1];
    const nm=header.match(/(?:^|\n)[ \t　]*(第\d+回[^\t\n]*)/);
    if(nm) nameRaw=nm[1].trim();
  }else{
    const n=header.match(/(?:^|[\s　])(\d{1,2})R[ 　]+([^\t\n]*)/);
    if(n){r.race_no=+n[1];nameRaw=n[2].trim();}
  }
  if(nameRaw){
    r.name_raw=nameRaw;
    let nm=nameRaw.replace(/^第\d+回[\s　]*/,'');
    const g=nm.match(GRADE_RE);
    if(g){r.grade=GRADES[g[1]]||null;nm=nm.slice(0,g.index);}
    r.name=nm.trim();
  }
  let surf=null,rest=null;
  const ca=fmt==='A'?header.match(COURSE_A_RE):null;
  if(ca){
    r.distance=+ca[1].replace(/,/g,'');
    const parts=ca[2].split('・').map(x=>x.trim());
    surf=parts[0]||null;
    if(['右','左','直線'].includes(parts[1])) r.turn=parts[1];
    rest=parts.slice(r.turn?2:1).join('・');
    const dm=rest.match(/^((?:内|外)[内外回り]*)/);
    r.course_detail=dm?dm[1]:null;
  }else if(fmt!=='A'){
    const c=header.match(COURSE_RE);
    if(c){r.distance=+c[1];surf=c[2];r.turn=c[3]||null;r.course_detail=c[4]||null;}
  }
  if(surf) r.surface=surf==='芝'?'芝':(surf==='ダート'||surf==='ダ')?'ダ':null;
  const wt=header.match(/天候(?:：|[ \t　]*\t)[ 　]*([^\s　\t]+)/);
  if(wt) r.weather=wt[1];
  const gt=(name)=>{const m=header.match(new RegExp(`(?:^|\\n|[\\s\\u3000])${name}(?:：|[ \\u3000]*\\t)[ \\u3000]*([^\\s\\u3000\\t]+)`));return m?m[1]:null;};
  r.going.turf=gt('芝');
  r.going.dirt=gt('ダート')||gt('ダ');
  return r;
}

function pacePart(tail,race,winTenths,warnings){
  const p={furlongs:[],win_time:sec(winTenths),first_3f:null,last_3f:null,last_4f:null,first_last_diff:null,reported_last_3f:null,reported_last_4f:null};
  const m=tail.match(/ハロンタイム[\s　]+(\d+\.\d(?:[ \t]*-[ \t]*\d+\.\d)*)/);
  const u=tail.match(/上り[\s　]*4F[ \t]*(\d+\.\d)[ \t]*-[ \t]*3F[ \t]*(\d+\.\d)/);
  if(u){p.reported_last_4f=+u[1];p.reported_last_3f=+u[2];}
  if(!m){warnings.push(W('furlong_missing','ハロンタイムが読み取れません'));return p;}
  const fl=m[1].split('-').map(x=>Math.round(parseFloat(x)*10));
  p.furlongs=fl.map(sec);
  const sum=a=>a.reduce((x,y)=>x+y,0);
  const total=sum(fl);
  if(fl.length>=3){
    const f3=sum(fl.slice(0,3)),l3=sum(fl.slice(-3));
    p.first_3f=sec(f3);p.last_3f=sec(l3);p.first_last_diff=sec(l3-f3);
  }
  if(fl.length>=4) p.last_4f=sec(sum(fl.slice(-4)));
  if(winTenths!=null&&total!==winTenths) warnings.push(W('furlong_sum_mismatch',`ハロンタイムの合計（${sec(total)}）と勝ち馬のタイム（${sec(winTenths)}）が違います`));
  if(p.last_3f!=null&&p.reported_last_3f!=null&&Math.round(p.last_3f*10)!==Math.round(p.reported_last_3f*10)) warnings.push(W('last3_mismatch',`計算した後半3F（${p.last_3f}）と公表の後半3F（${p.reported_last_3f}）が違います`));
  if(p.last_4f!=null&&p.reported_last_4f!=null&&Math.round(p.last_4f*10)!==Math.round(p.reported_last_4f*10)) warnings.push(W('last4_mismatch',`計算した後半4F（${p.last_4f}）と公表の後半4F（${p.reported_last_4f}）が違います`));
  if(race.distance&&fl.length!==Math.ceil(race.distance/200)) warnings.push(W('furlong_count',`ハロンの数（${fl.length}）が距離÷200の切り上げ（${Math.ceil(race.distance/200)}）と違います`));
  return p;
}

export function parseResult(text){
  const src=String(text==null?'':text).replace(/\r\n?/g,'\n');
  const lines=src.split('\n');
  const rowIdx=[];
  lines.forEach((l,i)=>{if(isHorseRow(l)) rowIdx.push(i);});
  const fail=()=>{throw new Error('結果ページの形式を判別できません');};
  if(!rowIdx.length) fail();
  // 形式の判別：馬の行の次の行（空白だけの行は飛ばす）が番手の行なら A
  const isA=rowIdx.some(i=>{
    if(!emptyStr(lines[i].split('\t')[3])) return POS_LINE_RE.test(lines[i+1]||'');
    let k=i+1;while(k<lines.length&&emptyStr(lines[k])) k++;
    return POS_LINE_RE.test(lines[i+1]||'')||POS_LINE_RE.test(lines[k+2]||'');
  });
  const fmt=isA?'A':lines[rowIdx[0]].split('\t').length===15?(/^枠/.test(lines[rowIdx[0]].split('\t')[1].trim())?'B':'C'):null;
  if(!fmt) fail();
  if(lines.filter(l=>DATE_LINE_RE.test(l)).length>=2) throw new Error('複数のレースが含まれています。1レースずつ貼り付けてください');
  const warnings=[];
  const firstRow=rowIdx[0];
  const header=lines.slice(0,firstRow).join('\n');
  if(header.includes('障害')) throw new Error('障害レースは対象外です');

  let good=rowIdx;
  if(fmt!=='A'){
    good=rowIdx.filter(i=>{const ok=lines[i].split('\t').length===15;if(!ok) warnings.push(W('row_field_count',`${i+1}行目：馬の行の項目数が15ではないため読み飛ばしました`));return ok;});
  }
  const horses=readHorses(lines,good,fmt,warnings);
  if(!horses.length) fail();

  // 末尾（ハロンタイム・コーナー通過順位）。払戻金より後ろは読まない
  const lastRow=good[good.length-1];
  const lastH=horses[horses.length-1];
  const tailStart=fmt==='A'?lastH._end:lastRow+1;
  const payout=lines.findIndex((l,i)=>i>=lastRow&&l.includes('払戻金'));
  const tail=lines.slice(tailStart,payout<0?lines.length:payout).join('\n');

  const race=parseRaceInfo(header,fmt);
  for(const h of horses){
    if(h.status!==null&&!STATUS_WORDS.includes(h.status)) warnings.push(W('unknown_finish_token',`${h.number}番：着順欄の「${h.status}」を判別できません。頭数に数えません`));
  }
  const ran=h=>h.status===null||h.status==='中止'||h.status==='失格';
  const starters=horses.filter(ran);
  race.starters=starters.length;
  race.scratched=horses.filter(h=>NOT_STARTED.includes(h.status)).length;
  if(!race.distance) warnings.push(W('course_missing','コース（距離・馬場種別）が読み取れません'));
  if(!race.date) warnings.push(W('date_missing','開催日が読み取れません'));
  if(race.weather==null) warnings.push(W('weather_missing','天候が読み取れません'));
  if(race.surface&&(race.surface==='芝'?race.going.turf:race.going.dirt)==null) warnings.push(W('going_missing',`${race.surface}の馬場状態が読み取れません`));

  // 時計（0.1秒単位の整数から秒へ）
  const winner=horses.filter(h=>h.finish===1)[0]||null;
  const pace=pacePart(tail,race,winner?winner.time:null,warnings);
  horses.forEach(h=>{h.time=sec(h.time);h.last_3f_est=sec(h.last_3f_est);});

  // コーナー通過順位
  const corners=[];
  const re=/([1-4])コーナー[ \t]+(\S*)/g;let cm;
  const seen=new Set(),ranges={};
  const startSet=new Set(starters.map(h=>h.number));
  while((cm=re.exec(tail))){
    const no=+cm[1];if(seen.has(no)) continue;seen.add(no);
    const p=parseCornerLine(cm[2]);
    if(!p.ok){warnings.push(W('corner_parse_error',`${no}コーナーの行を読めません（${p.message}）：${cm[2]}`));continue;}
    corners.push({corner:no,raw:cm[2],groups:p.groups});
    ranges[no]=p.ranges;
    const inRow=new Set(p.groups.flatMap(g=>g.horses));
    const miss=[...startSet].filter(n=>!inRow.has(n)),extra=[...inRow].filter(n=>!startSet.has(n));
    if(miss.length||extra.length) warnings.push(W('corner_set_mismatch',`${no}コーナーの馬番が出走馬と一致しません（不足：${miss.join(',')||'なし'}／余分：${extra.join(',')||'なし'}）`));
  }
  corners.sort((a,b)=>a.corner-b.corner);
  const cnos=corners.map(c=>c.corner);
  const rangeOf=(no,num)=>{const g=(ranges[no]||[]).find(x=>x.horses.includes(num));return g?{rank_min:g.rank_min,rank_max:g.rank_max}:null;};

  const n=race.starters;
  const info=r=>{
    if(!r) return null;
    const z1=zoneOf(r.rank_min,n),z2=zoneOf(r.rank_max,n);
    return {rank_min:r.rank_min,rank_max:r.rank_max,zone:z1===z2?z1:null,ambiguous:z1!==z2};
  };
  let countWarned=false;
  const positions=starters.map(h=>{
    const cs=[];
    if(fmt==='A'){
      const pos=h._pos||[];
      const aligned=pos.length===cnos.length;
      if(!aligned&&!countWarned&&(cnos.length||pos.length)){countWarned=true;warnings.push(W('corner_count_mismatch',`馬の行の番手の数（${pos.length}）と読めたコーナー行の数（${cnos.length}）が違います（${h.number}番ほか）`));}
      pos.forEach((rank,i)=>{
        const no=aligned?cnos[i]:null;
        cs.push({corner:no,rank_min:rank,rank_max:rank,exact:true,source:'row'});
        if(no!=null){
          const r=rangeOf(no,h.number);
          if(r&&(rank<r.rank_min||rank>r.rank_max)) warnings.push(W('row_notation_mismatch',`${h.number}番：馬の行の${no}コーナー（${rank}番手）が、コーナー行の範囲（${r.rank_min}〜${r.rank_max}番手）に入りません`));
        }
      });
      h.corner_positions=pos.map((rank,i)=>({corner:aligned?cnos[i]:null,rank}));
    }else{
      cnos.forEach(no=>{const r=rangeOf(no,h.number);if(r) cs.push({corner:no,rank_min:r.rank_min,rank_max:r.rank_max,exact:r.rank_min===r.rank_max,source:'notation'});});
    }
    return {number:h.number,corners:cs,first_corner:info(cs[0]),last_corner:info(cs[cs.length-1])};
  });
  horses.forEach(h=>{delete h._pos;delete h._end;});

  const exact1=positions.filter(p=>p.first_corner&&p.first_corner.rank_min===1&&p.first_corner.rank_max===1);
  const leader=exact1.length?{number:exact1[0].number,candidates:[exact1[0].number]}:{number:null,candidates:positions.filter(p=>p.first_corner&&p.first_corner.rank_min===1).map(p=>p.number)};

  return {schema:SCHEMA,source_format:fmt,race,pace,horses,corners,positions,leader,warnings};
}
