import { parse } from './parse/index.js';
import { derive, zoneRanges, cushionCat } from './derive.js';
import { validate } from './parse/validate.js';
import { raceBlock, raceState, raceQuestions, horseRequest } from './requests.js';
import { RACE_OUTLOOK, HORSE_POSITION } from './contracts.js';
import { outlookFromValues, outlookFromAnswers, describeAnswer } from './score.js';
import { MODEL_ID, PRICE, buildRequest, checkLimits, parseResponse, estimateCostUsd } from './jev.js';
import { paceLabels } from './contracts.js';
import { callRelay, isRelayAvailable } from './client.js';
import { runStage4, summarizeStage4, isStale } from './stage4.js';
import { buildRecord, buildSummaryLine, buildDetailText, formatEvalTime, formatEvalTotal, formatRoundTrip, recordFileName } from './record.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let P=null,D=null;

let E3=null; // STEP3 の直近のエラー {kind,message,at}。要約の err に使う
let J=null; // 読み込んだ STEP3 の答え（parseResponse の結果）。メモリ上だけに持つ
let JM=null; // J の実行方法。{method:'api',at:ISO文字列} または {method:'paste'}
let S3=null; // 画面に出している STEP3 の state と questions（中継に渡す元データ）
let gen=0,running=false,running4=false; // 出馬表を読み取り直すたびに gen を進め、古い実行の応答を捨てる
let S4=null; // STEP4 の全頭実行の結果 {results,usedOutlook,aborted,cancelled}。メモリ上だけに持つ
let cancel4=false,progress4=''; // 中止の要求と、進捗の表示文
const OV_NAMES={leader:'ハナ',battle:'先行争い',pace:'ペース'};
function overrides(){
  return {leader:$('o-lead').value||null,battle:$('o-cont').value||null,pace:$('o-pace').value||null};
}
function overriddenKeys(){
  return J?outlookFromAnswers(J,D.horses,overrides()).overridden:Object.entries(overrides()).filter(([,v])=>v).map(([k])=>k);
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
  if(!J){box.innerHTML='';refreshFeedback();return;}
  const ov=overrides(),res=outlookFromAnswers(J,D.horses,ov);
  let h=describeAll(J).map(c=>cardHtml(c,res.overridden.includes(c.ov)?ov[c.ov]:null)).join('');
  h+='<p class="desc">振り分けは確率の集中度による目安です。答えの正しさを保証するものではありません。</p>';
  h+=`<p class="desc">STEP4 には確率の数値ではなく、コードで言葉にした値を渡します：${res.outlook?['expected_leader','early_lead_battle','pace'].filter(k=>k in res.outlook).map(k=>`<code>${esc(res.outlook[k])}</code>`).join(' '):'なし'}</p>`;
  if(res.overridden.length) h+=`<div class="warn">STEP4 には、手で上書きした項目（${res.overridden.map(k=>OV_NAMES[k]).join('／')}）が使われています。</div>`;
  const m=J.answeredModel;
  h+=`<div class="kv"><b>答えたモデルの版</b><span>${esc(m||'不明')} ／ 契約：${esc(RACE_OUTLOOK.label)}</span>
  <b>評価時間</b><span>${formatEvalTime(J.evaluationTimeMs)}</span>
  <b>往復時間</b><span>${formatRoundTrip(J.roundTripMs)}</span>
  <b>request_id</b><span>${esc(J.requestId||'不明')}</span>
  <b>実行方法</b><span>${JM&&JM.method==='api'?'中継関数（API）':'Playground（貼り付け）'}</span>
  ${JM&&JM.at?`<b>実行日時</b><span>${esc(JM.at)}</span>`:''}
  <b>トークン数</b><span>入力 ${J.inputTokens??'不明'} ／ 出力 ${J.outputTokens??'不明'}</span>
  <b>概算費用</b><span>${fmtCost(estimateCostUsd(J.inputTokens))}（単価の確認日：${esc(PRICE.checkedOn)}）</span></div>`;
  if(m&&m!==MODEL_ID) h+=`<div class="warn">Playground では別名（jev-latest など）で実行するため、答えた版が固定した版（${esc(MODEL_ID)}）と異なる場合があります。記録は答えた版で行います。</div>`;
  box.innerHTML=h;
  refreshFeedback();
}
function loadAnswers(){loadAnswersFrom($('j-src').value,{method:'paste'});}
function loadAnswersFrom(text,meta){
  const msg=$('j-msg');msg.innerHTML='';
  if(!D) return;
  try{
    const parsed=parseResponse(text,RACE_OUTLOOK.questions(D));
    describeAll(parsed);
    outlookFromAnswers(parsed,D.horses,overrides());
    J=parsed;JM={...meta,raw:text};E3=null;
  }catch(e){msg.innerHTML=`<div class="err">${esc(e.message)}</div>`;E3={kind:'parse',message:e.message,at:new Date().toISOString()};refreshFeedback();return;}
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
  J=null;JM=null;E3=null;$('j-src').value='';$('j-msg').innerHTML='';
  gen++;setRunning(false);$('x-status').textContent='';
  S4=null;running4=false;cancel4=false;progress4='';
  renderS1();renderS2();renderS3();renderS4();
  ['s2','s3','s4','sfb'].forEach(id=>$(id).classList.remove('dim'));
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
  S3={state:st,questions:raceQuestions(D)};
  $('r-state').value=JSON.stringify(st,null,2);
  $('r-q').value=JSON.stringify(req.questions,null,2);
  $('r-body').value=JSON.stringify(req,null,2);
  showMeta('r-state',RACE_OUTLOOK,req);
  const s=$('o-lead'),cur=s.value;
  s.innerHTML=`<option value="">${blank('ハナ')}</option>`+D.horses.map(h=>`<option value="${h.num}番 ${esc(h.name)}">${h.num}番 ${esc(h.name)}</option>`).join('')+'<option value="特定できない">特定できない</option>';
  if([...s.options].some(o=>o.value===cur)) s.value=cur;
  renderJ();
}
function setRunning(on,text){
  running=on;
  $('x-status').textContent=on?(text||'実行中…'):'';
  refreshControls();
}
// 実行ボタンの有効・無効。STEP3 と STEP4 は同時に実行しない。合言葉欄は共通
function refreshControls(){
  const ok=isRelayAvailable(location),busy=running||running4,hasPw=$('x-pass').value!=='';
  $('x-pass').disabled=!ok||busy;$('x-run').disabled=!ok||busy;
  $('x4-run').disabled=!ok||busy||!hasPw||!D;
  $('x4-retry').disabled=!ok||busy||!hasPw||!D;
  $('x4-cancel').hidden=!running4;
  $('x4-note').textContent=!ok?'このページでは実行できません。Netlify の URL を使うか、Playground に貼り付けてください。':!hasPw?'合言葉を入力してください（STEP3 の合言葉欄と共通です）。':'';
}
async function runStep3(){
  if(!D||!S3||running) return;
  const myGen=gen,msg=$('j-msg'),sent=S3;msg.innerHTML='';
  setRunning(true);
  try{
    const text=await callRelay({contract:RACE_OUTLOOK.label,state:sent.state,questions:sent.questions,password:$('x-pass').value,
      onRetry:(n,max)=>{if(myGen===gen) setRunning(true,`実行中…（再試行 ${n}/${max}）`);}});
    if(myGen!==gen) return;
    $('j-src').value=text;
    loadAnswersFrom(text,{method:'api',at:new Date().toISOString(),request:{state:structuredClone(sent.state),questions:structuredClone(sent.questions)}});
  }catch(e){
    if(myGen===gen){msg.innerHTML=`<div class="err">${esc(e.message)}</div>`;E3={kind:typeof e.kind==='string'?e.kind:'other',message:e.message,at:new Date().toISOString()};refreshFeedback();}
  }finally{
    if(myGen===gen) setRunning(false);
  }
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
  renderStage4();
}

/* ---------- STEP4 の全頭実行 ---------- */
function failedNums(){return S4?S4.results.filter(r=>r.status!=='ok').map(r=>r.num):[];}
async function runStep4(onlyFailed){
  if(!D||running||running4) return;
  if(!onlyFailed&&S4&&!confirm('前回の結果を破棄して全頭を実行し直します')) return;
  const myGen=gen,used=onlyFailed&&S4?S4.usedOutlook:outlook(),usedOv=onlyFailed&&S4?S4.usedOverridden:overriddenKeys();
  const previous=onlyFailed&&S4?Object.fromEntries(S4.results.map(r=>[r.num,r])):undefined;
  const onlyNums=onlyFailed&&S4?failedNums():undefined;
  const zq=HORSE_POSITION.questions(D,D.horses[0],used); // 選択肢は馬によらず同じ
  cancel4=false;running4=true;progress4='実行中…';
  refreshControls();renderStage4();
  let out=null;
  try{
    out=await runStage4({horses:D.horses,previous,onlyNums,
      buildFor:h=>horseRequest(D,h,used),
      callOne:({state,questions})=>callRelay({contract:HORSE_POSITION.label,state,questions,password:$('x-pass').value,
        onRetry:(n,max)=>{if(myGen===gen){progress4=`${progress4.split('（再試行')[0]}（再試行 ${n}/${max}）`;renderProgress4();}}}),
      parse:text=>parseResponse(text,zq),
      shouldCancel:()=>cancel4||myGen!==gen,
      onProgress:ev=>{
        if(myGen!==gen) return;
        if(ev.type==='start'){progress4=`実行中：${ev.index}／${ev.total}頭（${ev.num}番 ${ev.name}）`;renderProgress4();}
      }});
  }catch(e){
    if(myGen===gen) $('x4-out').innerHTML=`<div class="err">${esc(e.message)}</div>`;
  }
  if(myGen!==gen) return;
  running4=false;cancel4=false;progress4='';
  if(out) S4={results:out.results,usedOutlook:used,usedOverridden:usedOv,aborted:out.aborted,cancelled:out.cancelled};
  refreshControls();renderStage4();
}
function cancelStep4(){cancel4=true;progress4='中止しています…';renderProgress4();}
function renderProgress4(){$('x4-status').textContent=progress4;}
function ansCell(parsed,key,zl){
  try{
    const a=parsed.answers[key],d=describeAnswer('select',a,parsed.answeredModel,zl);
    const top=d.rows.find(r=>r.key===a.selected);
    return `<b>${esc(d.selected)}</b> ${pct(top.probability)} <span class="muted">conf ${d.confidence.toFixed(2)}</span> <span class="bdg bdg-${d.level}">${esc(d.levelLabel)}</span>`;
  }catch(e){return `<span class="err">${esc(e.message)}</span>`;}
}
function allProbs(parsed,zl){
  return [['first_corner','最初のコーナー'],['last_corner','4コーナー']].map(([k,t])=>{
    try{return `<div><b>${t}</b><ul>${rowsHtml(describeAnswer('select',parsed.answers[k],parsed.answeredModel,zl).rows)}</ul></div>`;}
    catch(e){return `<div class="err">${esc(e.message)}</div>`;}
  }).join('');
}
function outlookText(ol){
  if(!ol) return 'なし';
  return ['expected_leader','early_lead_battle','pace'].filter(k=>k in ol).map(k=>`<code>${esc(ol[k])}</code>`).join(' ');
}
function renderStage4(){
  renderProgress4();
  const box=$('x4-out');
  if(!D||!S4){
    box.innerHTML=''; $('x4-retry').hidden=true;
    refreshFeedback();
    return;
  }
  const zl={};zoneRanges(D.horses.length).forEach(z=>{zl[z.key]=z.label;});
  let h='';
  if(S4.aborted) h+=`<div class="err">実行を中止しました（${esc(S4.aborted.kind)}）：${esc(S4.aborted.message)}</div>`;
  else if(S4.cancelled) h+='<div class="warn">中止しました。未実行の馬があります。</div>';
  if(isStale(S4.usedOutlook,outlook())) h+='<div class="warn stale"><b>この結果は、変更前の展開（race_outlook）で実行されました。今の展開で実行し直す場合は、全頭を実行し直してください。</b></div>';
  h+=`<p class="desc">実行に使った race_outlook：${outlookText(S4.usedOutlook)}</p>`;
  h+='<p class="desc">振り分けは確率の集中度による目安です。答えの正しさを保証するものではありません。</p>';
  h+='<div class="tbl"><table><thead><tr><th>馬番</th><th>馬名</th><th>最初のコーナー</th><th>4コーナー</th><th>状態</th></tr></thead><tbody>';
  S4.results.forEach(r=>{
    const ok=r.status==='ok';
    h+=`<tr><td>${r.num}</td><td>${esc(r.name)}</td><td>${ok?ansCell(r.parsed,'first_corner',zl):'—'}</td><td>${ok?ansCell(r.parsed,'last_corner',zl):'—'}</td>
    <td>${ok?'成功':r.status==='failed'?`<span class="err-text">失敗（${esc(r.errorKind)}：${esc(r.errorMessage)}）</span>`:'未実行'}</td></tr>`;
    if(ok) h+=`<tr><td></td><td colspan="4"><details><summary>確率をすべて見る</summary>${allProbs(r.parsed,zl)}</details></td></tr>`;
  });
  h+='</tbody></table></div>';
  const m=summarizeStage4(S4.results,estimateCostUsd);
  h+=`<div class="kv"><b>件数</b><span>成功 ${m.okCount} ／ 失敗 ${m.failedCount} ／ 未実行 ${m.skippedCount}</span>
  <b>トークン数</b><span>入力 ${m.inputTokens} ／ 出力 ${m.outputTokens}</span>
  <b>評価時間の合計</b><span>${formatEvalTotal(S4.results)}</span>
  <b>概算費用</b><span>${fmtCost(m.okCount-m.excludedCount>0?m.costUsd:null)}（単価の確認日：${esc(PRICE.checkedOn)}）</span></div>`;
  if(m.excludedCount) h+=`<p class="desc">トークン数がない ${m.excludedCount} 頭は、トークン数と費用の集計に含まれていません。</p>`;
  box.innerHTML=h;
  $('x4-retry').hidden=failedNums().length===0;
  refreshFeedback();
}
function downloadAll(){
  const ol=outlook();
  const reqs=D.horses.map(h=>{const r=horseRequest(D,h,ol);return {horse:`${h.num}番 ${h.name}`,request:buildRequest(r.state,r.questions)};});
  const blob=new Blob([JSON.stringify({race:raceBlock(D),step:'STEP4',contract:HORSE_POSITION.label,model:MODEL_ID,requests:reqs},null,2)],{type:'application/json'});
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download=`jev_step4_${D.race.date||'race'}.json`;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),1000);
}
/* ---------- フィードバック用のコピーと記録のダウンロード ---------- */
function feedbackCtx(){
  const f=$('fb-blind').value;
  return {now:new Date(),host:location.hostname,userAgent:navigator.userAgent,race:D.race,horses:D.horses,warnings:P.warnings,
    userInput:{blind:f,memo:$('fb-memo').value},
    s3:J?{parsed:J,meta:JM,state:S3.state,overrides:overrides(),raw:JM.raw}:null,s3Error:J?null:E3,
    s4:S4?{results:S4.results,usedOutlook:S4.usedOutlook,usedOverridden:S4.usedOverridden,aborted:S4.aborted,cancelled:S4.cancelled,
      states:Object.fromEntries(D.horses.map(h=>[h.num,horseRequest(D,h,S4.usedOutlook).state]))}:null};
}
function refreshFeedback(){
  if(!D||!P) return;
  const ctx=feedbackCtx();
  $('fb-line').value=buildSummaryLine(ctx);
  $('fb-detail').value=buildDetailText(ctx);
  $('fb-dl').disabled=!(J||S4);
}
async function downloadRecord(){
  if(!D||!(J||S4)) return;
  const ctx=feedbackCtx(),rec=await buildRecord(ctx);
  const blob=new Blob([JSON.stringify(rec,null,2)],{type:'application/json'});
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download=recordFileName(ctx);document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),1000);
}
function copy(id,btn){
  const el=$(id);
  const done=()=>{const t=btn.textContent;btn.textContent='コピーしました';setTimeout(()=>btn.textContent=t,1200);};
  const fb=()=>{el.select();document.execCommand('copy');done();};
  if(navigator.clipboard&&window.isSecureContext) navigator.clipboard.writeText(el.value).then(done).catch(fb); else fb();
}

$('x-pass').addEventListener('input',refreshControls);
refreshControls();
['o-lead','o-cont','o-pace'].forEach(id=>$(id).addEventListener('change',renderJ));
['fb-blind','fb-memo'].forEach(id=>{$(id).addEventListener('input',refreshFeedback);$(id).addEventListener('change',refreshFeedback);});
Object.assign(window,{runStep3,runStep4,cancelStep4,run,rerun,loadAnswers,renderS4,downloadAll,downloadRecord,copy,$});
