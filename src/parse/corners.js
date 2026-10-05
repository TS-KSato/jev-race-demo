/* コーナー通過順位の行（例：「2,4(5,1)7-6」「(*3,6)8,5(1,4)」）の読み取り */
const SEPS=',-=';

// 戻り値：{ok:true, groups:[{horses,sep_after}], ranges:[{horses,rank_min,rank_max}]} または {ok:false, message}
export function parseCornerLine(raw){
  const s=String(raw==null?'':raw).trim();
  if(!s) return {ok:false,message:'コーナー通過順位が空です'};
  const groups=[]; let i=0;
  const bad=m=>({ok:false,message:m});
  const readNum=()=>{const st=i;while(i<s.length&&s[i]>='0'&&s[i]<='9')i++;return i>st?+s.slice(st,i):null;};
  while(i<s.length){
    const c=s[i];
    if(c==='*'){i++;continue;} // 意味は未確認（推測：先頭の印）。読み飛ばす
    let horses;
    if(c==='('){
      i++; horses=[];
      for(;;){
        if(s[i]==='*'){i++;continue;}
        const n=readNum();
        if(n==null) return bad(`かっこの中に馬番でない文字があります（${i+1}文字目）`);
        horses.push(n);
        if(s[i]===')'){i++;break;}
        if(i>=s.length) return bad('かっこが閉じていません');
        if(SEPS.includes(s[i])) {i++;continue;}
        return bad(`読めない文字があります（${i+1}文字目）`);
      }
    }else{
      const n=readNum();
      if(n==null) return bad(c===')'?'かっこの対応が合いません':`読めない文字があります（${i+1}文字目）`);
      horses=[n];
    }
    let sep='';
    if(i<s.length&&SEPS.includes(s[i])){sep=s[i];i++;if(i>=s.length) return bad('区切りのあとに馬番がありません');}
    groups.push({horses,sep_after:sep});
  }
  if(!groups.length) return bad('馬番がありません');
  const all=groups.flatMap(g=>g.horses);
  if(new Set(all).size!==all.length) return bad('同じ馬番が2回出ています');
  let before=0;
  const ranges=groups.map(g=>{const r={horses:g.horses,rank_min:before+1,rank_max:before+g.horses.length};before+=g.horses.length;return r;});
  return {ok:true,groups,ranges};
}
