import { parse } from './parse/index.js';
import { derive, zoneRanges, cushionCat } from './derive.js';
import { validate } from './parse/validate.js';
import { raceBlock, raceState, raceQuestions, horseRequest } from './requests.js';
import { RACE_OUTLOOK, HORSE_POSITION } from './contracts.js';
import { MODEL_ID, buildRequest, checkLimits } from './jev.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let P=null,D=null;

function outlook(){
  const l=$('o-lead').value,c=$('o-cont').value,p=$('o-pace').value;
  if(!l&&!c&&!p) return null;
  const o={note:'STEP3でJevが推定した展開。確定した事実ではない'};
  if(l) o.expected_leader=l; if(c) o.early_lead_battle=c; if(p) o.pace=p;
  return o;
}
/* ---------- 画面 ---------- */
function run(){
  $('s1msg').innerHTML='';
  try{P=parse($('src').value);}catch(e){$('s1msg').innerHTML=`<div class="err">${esc(e.message)}</div>`;return;}
  $('pjson').value=JSON.stringify(P,null,2);
  afterParse();
}
function rerun(){
  $('s1msg').innerHTML='';
  try{P=JSON.parse($('pjson').value);}catch(e){$('s1msg').innerHTML=`<div class="err">JSONの形式が正しくありません：${esc(e.message)}</div>`;return;}
  if(!P||typeof P!=='object'||!P.race||typeof P.race!=='object'||Array.isArray(P.race)||!Array.isArray(P.horses)){$('s1msg').innerHTML='<div class="err">JSONの形が正しくありません（race と horses が必要です）</div>';return;}
  P.warnings=validate(P);
  afterParse();
}
function afterParse(){
  D=derive(P);
  renderS1();renderS2();renderS3();renderS4();
  ['s2','s3','s4'].forEach(id=>$(id).classList.remove('dim'));
}
function renderS1(){
  const R=P.race,T=R.track||{};
  let h=P.warnings.length
    ?`<div class="warn">確認が必要な点（${P.warnings.length}件）<ul>${P.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`
    :`<p class="ok">警告はありません。</p>`;
  h+=`<div class="kv"><b>レース</b><span>${esc(R.date||'')} ${esc(R.venue||'')} ${R.raceNo?R.raceNo+'R':''} ${esc(R.name)}</span>
  <b>条件</b><span>${R.distance?R.distance+'m':'?'}（${esc(R.courseDesc||'?')}） ${esc(R.conditions||'')}</span>
  <b>馬場</b><span>${esc(T.weather||'')} 芝：${esc(T.turfGoing||'?')} ／ クッション値：${T.cushion??'?'}${T.cushion!=null?'（'+cushionCat(T.cushion)+'）':''}</span>
  <b>芝の状態</b><span>${esc(T.turfNote||'—')}</span></div>`;
  h+=`<div class="lbl">出走馬（${P.horses.length}頭）</div><div class="tbl"><table><thead><tr><th>枠</th><th>馬番</th><th>馬名</th><th>人気</th><th>単勝</th><th>斤量</th><th>騎手</th><th>馬体重</th><th>過去走（日付・レース・距離・着順/頭数・[通過順]・上がり3F）</th></tr></thead><tbody>`;
  P.horses.forEach(x=>{
    h+=`<tr><td>${x.frame}</td><td>${x.num}</td><td>${esc(x.name)}${x.blinker?' <span class="muted">B</span>':''}</td><td>${x.pop??'—'}</td><td>${x.odds??'—'}</td><td>${x.carried??'—'}</td><td>${esc(x.jockey||'—')}</td><td>${x.bodyWeight??'—'}${x.bodyWeightDiff?'('+esc(x.bodyWeightDiff)+')':''}</td>
    <td style="white-space:normal;min-width:420px">${(x.past||[]).map(p=>`${esc((p.date||'').slice(2))} ${esc(p.race)} ${p.dist||'?'}${esc(p.surface||'')} ${p.finish??'?'}着/${p.field??'?'}頭 [${p.corners?p.corners.join('-'):'—'}] ${p.last3f??''}`).join('<br>')}</td></tr>`;
  });
  $('s1out').innerHTML=h+'</tbody></table></div>';
}
function chip(z,title){return `<span class="z ${z?'z-'+z:'z-na'}" title="${esc(title)}">${z||'—'}</span>`;}
function renderS2(){
  const F=D.raceFacts,T=D.race.track||{},n=D.horses.length;
  let h=`<div class="kv"><b>クッション値</b><span>${T.cushion??'—'}${T.cushion!=null?'（'+cushionCat(T.cushion)+'。JRAの参考表による区分。境界値の扱いは目安）':''}</span>
  <b>先頭で通過した経験</b><span>${F.frontRunners.length?F.frontRunners.map(r=>`${r.number}番 ${esc(r.name)}（${r.frame}枠・${r.led_count}回）`).join('、'):'該当なし'}</span>
  <b>芝1200m戦の前半3F</b><span>${F.front3fRanking.length?F.front3fRanking.slice(0,8).map(r=>`${r.number}番 ${esc(r.name)} ${r.best_front3f.toFixed(1)}`).join('、'):'該当なし'}</span></div>`;
  h+=`<div class="lbl">位置の区分（今回${n}頭立て）：${zoneRanges(n).map(z=>z.key==='front'?'先頭＝1番手':z.key==='rear'?`${z.label}＝${z.from}番手以降`:`${z.label}＝${z.from}〜${z.to}番手`).join('、')}。過去走はそのレースの頭数で区分しています。区分にカーソルを合わせると詳細が出ます。</div>`;
  h+=`<div class="tbl"><table><thead><tr><th>馬番</th><th>枠</th><th>馬名</th><th>最初のコーナー（直近→）</th><th>最後のコーナー（直近→）</th><th>先頭回数</th><th>2番手以内</th><th>前半3F最速</th><th>乗り替わり</th><th>間隔</th></tr></thead><tbody>`;
  D.horses.forEach(x=>{
    const t=p=>`${p.date} ${p.race} ${p.dist||'?'}${p.surface||''} ${p.corners?p.corners.join('-'):'通過順なし'}/${p.field??'?'}頭${p.tags.length?' ・'+p.tags.join('・'):''}`;
    h+=`<tr><td>${x.num}</td><td>${x.frame}</td><td>${esc(x.name)}</td>
    <td>${x.past.map(p=>chip(p.firstZone,t(p))).join('')}</td><td>${x.past.map(p=>chip(p.lastZone,t(p))).join('')}</td>
    <td>${x.facts.led}</td><td>${x.facts.top2}</td><td>${x.facts.bestFront3f!=null?x.facts.bestFront3f.toFixed(1):'—'}</td>
    <td>${x.facts.jockeyChange==null?'—':x.facts.jockeyChange?'あり':'なし'}</td><td>${x.facts.daysSinceLast!=null?x.facts.daysSinceLast+'日':'—'}</td></tr>`;
  });
  $('s2out').innerHTML=h+'</tbody></table></div>';
}
// State 欄の上に、契約・モデルの表示と、上限の目安を超えたときの警告を出す
function showMeta(stateId,contract,req){
  const grid=$(stateId).closest('.grid');
  let box=document.getElementById(stateId+'-meta');
  if(!box){box=document.createElement('div');box.id=stateId+'-meta';grid.before(box);}
  const c=checkLimits(req),L=c.limits;
  box.innerHTML=`<div class="lbl">契約：${esc(contract.label)} ／ モデル：${esc(MODEL_ID)}</div>`+(c.ok?'':
    `<div class="warn">リクエストの大きさが上限の目安を超えています（全体 ${c.total}／${L.requestTokens}、state と最大の質問 ${c.stateAndLongest}／${L.stateAndLongestQuestionTokens}。1文字を1トークンとみなした目安）</div>`);
}
function renderS3(){
  const st=raceState(D),req=buildRequest(st,raceQuestions(D));
  $('r-state').value=JSON.stringify(st,null,2);
  $('r-q').value=JSON.stringify(req.questions,null,2);
  $('r-body').value=JSON.stringify(req,null,2);
  showMeta('r-state',RACE_OUTLOOK,req);
  const s=$('o-lead'),cur=s.value;
  s.innerHTML='<option value="">ハナ：未入力</option>'+D.horses.map(h=>`<option value="${h.num}番 ${esc(h.name)}">${h.num}番 ${esc(h.name)}</option>`).join('')+'<option value="特定できない">特定できない</option>';
  if([...s.options].some(o=>o.value===cur)) s.value=cur;
}
function renderS4(){
  if(!D) return;
  const sel=$('h-sel'),cur=sel.value;
  sel.innerHTML=D.horses.map(h=>`<option value="${h.num}">${h.num}番 ${esc(h.name)}</option>`).join('');
  if(D.horses.some(h=>String(h.num)===cur)) sel.value=cur;
  const h=D.horses.find(x=>String(x.num)===sel.value)||D.horses[0];
  const r=horseRequest(D,h,outlook()),req=buildRequest(r.state,r.questions);
  $('h-state').value=JSON.stringify(r.state,null,2);
  $('h-q').value=JSON.stringify(req.questions,null,2);
  $('h-body').value=JSON.stringify(req,null,2);
  showMeta('h-state',HORSE_POSITION,req);
}
function downloadAll(){
  const ol=outlook();
  const reqs=D.horses.map(h=>{const r=horseRequest(D,h,ol);return {horse:`${h.num}番 ${h.name}`,request:buildRequest(r.state,r.questions)};});
  const blob=new Blob([JSON.stringify({race:raceBlock(D),step:'STEP4',contract:HORSE_POSITION.label,model:MODEL_ID,requests:reqs},null,2)],{type:'application/json'});
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download=`jev_step4_${D.race.date||'race'}.json`;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),1000);
}
function copy(id,btn){
  const el=$(id);
  const done=()=>{const t=btn.textContent;btn.textContent='コピーしました';setTimeout(()=>btn.textContent=t,1200);};
  const fb=()=>{el.select();document.execCommand('copy');done();};
  if(navigator.clipboard&&window.isSecureContext) navigator.clipboard.writeText(el.value).then(done).catch(fb); else fb();
}

Object.assign(window,{run,rerun,renderS4,downloadAll,copy,$});
