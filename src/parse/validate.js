import { didNotRun } from '../derive.js';
import { NAME_OK_RE } from './markers.js';

/* ---------- STEP1: 読み取り結果の検査（警告の作成） ---------- */
export function validate(P){
  const W=[],R=P.race||{};
  if(!R.distance) W.push('レース：距離・コース（「コース：1,200メートル（芝…）」）が読み取れません');
  if(R.distance&&R.surface==null) W.push('レース：馬場種別が判別できません');
  if(!R.date) W.push('レース：開催日が読み取れません');
  const T=R.track||{};
  const none=T.weather==null&&T.turfGoing==null&&T.dirtGoing==null&&T.cushion==null&&T.turfMoisture==null;
  if(none) W.push('馬場状態（「天候：」または「芝のクッション値」以降）が見つかりません。馬場の情報なしで進みます');
  else{
    if(T.weather==null) W.push('馬場状態：天候が読み取れません');
    if(T.turfGoing==null) W.push('馬場状態：芝の状態が読み取れません');
    if(T.dirtGoing==null) W.push('馬場状態：ダートの状態が読み取れません');
    if(R.surface!=='ダ'&&T.cushion==null) W.push('馬場状態：クッション値が読み取れません');
    if(R.surface!=='ダ'&&T.turfMoisture==null) W.push('馬場状態：芝の含水率が読み取れません');
  }
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
