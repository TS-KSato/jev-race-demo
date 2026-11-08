import { didNotRun } from '../derive.js';
import { NAME_OK_RE } from './markers.js';

/* ---------- STEP1: 読み取り結果の検査（警告の作成） ---------- */
// 馬場の項目と表示名。クッション値と含水率は、ダートのレースでは求めない
const TRACK_ITEMS=[['weather','天候'],['turfGoing','芝の状態（良など）'],['dirtGoing','ダートの状態'],['cushion','クッション値',true],['turfMoisture','含水率',true],['rail','使用コース'],['turfNote','芝の状態の説明']];
const has=v=>v!=null&&v!=='';
// 見出しがない →「含まれていません」、見出しはあるが値がない →「読み取れませんでした」。読めた項目があれば末尾に添える
function trackWarnings(R){
  const T=R.track||{},F=R.trackFound||{};
  const items=TRACK_ITEMS.filter(([,,turfOnly])=>!(turfOnly&&R.surface==='ダ'));
  const read=TRACK_ITEMS.filter(([k])=>has(T[k])).map(([,label])=>label);
  const tail=read.length?`。読めた項目：${read.join('、')}`:'';
  return items.filter(([k])=>!has(T[k])).map(([k,label])=>(F[k]===false?`貼った文字に『${label}』が含まれていません`:`『${label}』は読み取れませんでした`)+tail);
}

export function validate(P){
  const W=[],R=P.race||{};
  if(!R.distance) W.push('レース：距離・コース（「コース：1,200メートル（芝…）」）が読み取れません');
  if(R.distance&&R.surface==null) W.push('レース：馬場種別が判別できません');
  if(!R.date) W.push('レース：開催日が読み取れません');
  const T=R.track||{};
  const none=T.weather==null&&T.turfGoing==null&&T.dirtGoing==null&&T.cushion==null&&T.turfMoisture==null;
  if(none&&!R.trackFound) W.push('馬場状態（「天候：」または「芝のクッション値」以降）が見つかりません。馬場の情報なしで進みます');
  else W.push(...trackWarnings(R));
  if(R.trackTextIgnored) W.push('馬場情報らしい文字がありますが、読み取れる形式ではありませんでした。「天候：」の行、または「芝のクッション値」の見出しを含めて貼り付けてください');
  if(R.weeklyInfoIgnored) W.push('週間情報（天候・雨量・散水）は読み取りません。クッション値・含水率・使用コース・芝の状態だけを使います');
  (P.horses||[]).forEach(x=>{
    const tag=`${x.num}番 ${x.name||'?'}`,past=x.past||[];
    if(!x.name) W.push(`${tag}：馬名が読み取れません`);
    if(x.name&&!NAME_OK_RE.test(x.name)) W.push(`${x.num}番 ${x.name_raw}：馬名に、カタカナ以外の文字が含まれています（未知の付記の可能性）`);
    if(x.carried==null) W.push(`${tag}：斤量が読み取れません`);
    if(!x.jockey) W.push(`${tag}：騎手が読み取れません`);
    if(x.odds==null) W.push(`${tag}：単勝オッズが読み取れません（発売前・取消の可能性）`);
    if(past.length<4) W.push(`${tag}：過去走が${past.length}件です`);
    past.forEach(p=>{
      if(didNotRun(p)) W.push(`${tag}：${p.date} ${p.race} は出走せず（${p.finish}）のため、前走として数えません`);
      else if(p.cornersRaw!=null) W.push(`${tag}：${p.date} ${p.race} の通過順「${p.cornersRaw}」が頭数（${p.field??99}）と合わないため、読み取りません`);
      else if(!p.corners) W.push(`${tag}：${p.date} ${p.race} に通過順がありません（海外・地方・直線競馬など）`);
    });
  });
  return W;
}
