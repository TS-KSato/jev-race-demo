import { parse } from './parse/index.js';
import { derive, zoneRanges, cushionCat } from './derive.js';
import { validate } from './parse/validate.js';
import { raceBlock, raceState, raceQuestions, horseRequest } from './requests.js';
import { RACE_OUTLOOK, HORSE_POSITION } from './contracts.js';
import { outlookFromValues, outlookFromAnswers, describeAnswer } from './score.js';
import { MODEL_ID, PRICE, buildRequest, checkLimits, parseResponse, estimateCostUsd } from './jev.js';
import { paceLabels } from './contracts.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let P=null,D=null;

let J=null; // 読み込んだ STEP3 の答え（parseResponse の結果）。メモリ上だけに持つ
const OV_NAMES={leader:'ハナ',battle:'先行争い',pace:'ペース'};
function overrides(){
  return {leader:$('o-lead').value||null,battle:$('o-cont').value||null,pace:$('o-pace').value||null};
}
function outlook(){
  return J?outlookFromAnswers(J,D.horses,overrides()).outlook:outlookFromValues(overrides());
}
const blank=name=>`${name}：${J?'Jevの答えを使う':'未入力'}`;
function setBlankLabels(){
  $('o-lead').options[0].textContent=blank('ハナ');
  $('o-cont').options[0].textContent=blank('先行争い');
  $('o-pace').options[0].textContent=blank('ペース');
}
const pct=p=>`${Math.round(p*100)}%`;
function fmtCost(v){
  if(v==null) return '不明';
  const t=v.toPrecision(2);
  return `約 $${t.includes('e')?v.toFixed(8):t}`;
}
function leaderLabels(){
  const m={unclear:'特定できない'};
  D.horses.forEach(h=>{m['h'+String(h.num).padStart(2,'0')]=`${h.num}番 ${h.name}`;});
  return m;
}
function describeAll(parsed){
  const A=parsed.answers,M=parsed.answeredModel;
  return [
    {ov:'leader',title:'最初のコーナーを先頭で通過する馬',d:describeAnswer('select',A.lead_horse,M,leaderLabels())},
    {ov:'battle',title:'先行争いが激しくなる',d:describeAnswer('truth',A.early_lead_battle,M)},
    {ov:'pace',title:'前半のペース',d:describeAnswer('grade',A.pace,M,paceLabels())},
  ];
}
function rowsHtml(rows){return rows.map(r=>`<li>${esc(r.label)}：${pct(r.probability)}</li>`).join('');}
function cardHtml(c,ovVal){
  const d=c.d;
  let h=`<div class="jcard"><div class="jt">${esc(c.title)}<span class="bdg bdg-${d.level}">${esc(d.levelLabel)}</span></div>`;
  h+=`<div>${d.kind==='truth'?`${esc(d.selected)}相当（激しくなる確率 ${pct(d.rows[0].probability)}）`:`答え：<b>${esc(d.selected)}</b>`}</div>`;
  if(d.confidence!=null) h+=`<div class="muted">confidence：${d.confidence.toFixed(2)}</div>`;
  if(d.kind==='select'){
    const top=d.rows.filter(r=>r.probability>0).slice(0,3);
    h+=`<ul>${rowsHtml(top)}</ul><details><summary>すべての選択肢の確率を見る</summary><ul>${rowsHtml(d.rows)}</ul></details>`;
  } else h+=`<ul>${rowsHtml(d.rows)}</ul>`;
  if(ovVal) h+=`<div class="warn">手で上書きしています：${esc(ovVal)}</div>`;
  return h+'</div>';
}
function renderJ(){
  setBlankLabels();
  const box=$('j-out');
  if(!J){box.innerHTML='';return;}
  const ov=overrides(),res=outlookFromAnswers(J,D.horses,ov);
  let h=describeAll(J).map(c=>cardHtml(c,res.overridden.includes(c.ov)?ov[c.ov]:null)).join('');
  h+='<p class="desc">振り分けは確率の集中度による目安です。答えの正しさを保証するものではありません。</p>';
  h+=`<p class="desc">STEP4 には確率の数値ではなく、コードで言葉にした値を渡します：${res.outlook?['expected_leader','early_lead_battle','pace'].filter(k=>k in res.outlook).map(k=>`<code>${esc(res.outlook[k])}</code>`).join(' '):'なし'}</p>`;
  if(res.overridden.length) h+=`<div class="warn">STEP4 には、手で上書きした項目（${res.overridden.map(k=>OV_NAMES[k]).join('／')}）が使われています。</div>`;
  const m=J.answeredModel;
  h+=`<div class="kv"><b>答えたモデルの版</b><span>${esc(m||'不明')} ／ 契約：${esc(RACE_OUTLOOK.label)}</span>
  <b>評価時間</b><span>${J.evaluationTimeMs!=null?J.evaluationTimeMs+' ms':'不明'}</span>
  <b>トークン数</b><span>入力 ${J.inputTokens??'不明'} ／ 出力 ${J.outputTokens??'不明'}</span>
  <b>概算費用</b><span>${fmtCost(estimateCostUsd(J.inputTokens))}（単価の確認日：${esc(PRICE.checkedOn)}）</span></div>`;
  if(m&&m!==MODEL_ID) h+=`<div class="warn">Playground では別名（jev-latest など）で実行するため、答えた版が固定した版（${esc(MODEL_ID)}）と異なる場合があります。記録は答えた版で行います。</div>`;
  box.innerHTML=h;
}
function loadAnswers(){
  const msg=$('j-msg');msg.innerHTML='';
  if(!D) return;
  try{
    const parsed=parseResponse($('j-src').value,RACE_OUTLOOK.questions(D));
    describeAll(parsed);
    outlookFromAnswers(parsed,D.horses,overrides());
    J=parsed;
  }catch(e){msg.innerHTML=`<div class="err">${esc(e.message)}</div>`;return;}
  renderJ();renderS4();
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
  J=null;$('j-src').value='';$('j-msg').innerHTML='';
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
  <b>馬場</b><span>${esc(T.weather||'')} 芝：${esc(T.turfGoing||'?')} ／ クッション値：${T.cushion??'?'}${T.cushion!=null?'（'+cushionCat(T.cushion)+'）':''}${T.announcedAt?' ／ '+esc(T.announcedAt):''}</span>
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
  s.innerHTML=`<option value="">${blank('ハナ')}</option>`+D.horses.map(h=>`<option value="${h.num}番 ${esc(h.name)}">${h.num}番 ${esc(h.name)}</option>`).join('')+'<option value="特定できない">特定できない</option>';
  if([...s.options].some(o=>o.value===cur)) s.value=cur;
  renderJ();
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

['o-lead','o-cont','o-pace'].forEach(id=>$(id).addEventListener('change',renderJ));
Object.assign(window,{run,rerun,loadAnswers,renderS4,downloadAll,copy,$});
