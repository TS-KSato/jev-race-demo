/* 馬名の付記（結果ページと出馬表の両方で使う） */
/* 馬名に付く付記（確認済み：末尾「ブリンカー着用」、先頭「マル外」（結果ページ）・「マルガイ」（出馬表）。「カクガイ」ほかは推測。語はここに足すだけで除去される） */
export const NAME_MARKERS={
  prefix:['マル外','マルガイ','カク外','カクガイ','マル地','カク地'],
  suffix:['ブリンカー着用','メンコ着用','シャドーロール着用','チークピーシーズ着用','チークピース着用'],
};
/* 付記を取り除いた後の馬名に残してよい文字（カタカナ・英数字・全角英数字だけ） */
export const NAME_OK_RE=/^[\u30A0-\u30FFA-Za-z0-9Ａ-Ｚａ-ｚ０-９]*$/;
/* 馬名から、一覧にある付記を先頭・末尾から取り除く。取り除くと空になるときは取り除かない */
export function splitName(raw){
  const byLen=a=>[...a].sort((x,y)=>y.length-x.length);
  let name=raw;const markers=[];
  for(let again=true;again;){
    again=false;
    const p=byLen(NAME_MARKERS.prefix).find(w=>w&&name.startsWith(w)&&name.length>w.length);
    if(p){name=name.slice(p.length);markers.push(p);again=true;continue;}
    const q=byLen(NAME_MARKERS.suffix).find(w=>w&&name.endsWith(w)&&name.length>w.length);
    if(q){name=name.slice(0,-q.length);markers.push(q);again=true;}
  }
  return {name,markers};
}
