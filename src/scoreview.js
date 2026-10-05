/*
 * 採点の表示用の組み立て。HTML の文字列と整形だけを作り、DOM・ネットワーク・保存領域には触れない。
 * 入力：scoreRace の返り値（scoring@2）、記録の stage3、parseResult の返り値（着順と馬名のため）。
 */
import { levelLabel } from './score.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ZONE_LABEL = { front: '先頭', forward: '好位', mid: '中団', rear: '後方' };
const ZONE_KEYS = Object.keys(ZONE_LABEL);
const CORNER_LABEL = { first_corner: '最初のコーナー', last_corner: '最後のコーナー' };
const LEVEL_KEYS = ['high', 'middle', 'unclear'];
const zone = k => ZONE_LABEL[k] ?? '—';
const level = l => { try { return levelLabel(l); } catch { return '—'; } };

/* 正答率。scored が 0 なら割り算をしない */
export function formatRate(correct, scored) {
  if (!scored) return '—（採点なし）';
  return `${correct}/${scored}（${Math.round(correct / scored * 100)}%）`;
}
/* 秒の数値を小数1桁にする。符号の「−」は表示用 */
const sec = v => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—');
export const formatDiff = v => (typeof v === 'number' && Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}` : '—');
const pct = p => `${Math.round(p * 100)}%`;
const num = n => `${n}番`;

export const MSG_MISMATCH = '結果ページのレースが、読み取った出馬表と違うため、採点しません';
export const NOTE_INDEPENDENCE = 'この採点は1レースの結果で、判定は互いに独立ではありません。一般的な正答率を示すものではありません。';

/* ○・×・採点不能・未実行 */
function mark(item) {
  if (!item) return '未実行';
  if (item.status === 'scored') return item.correct ? '○' : '×';
  if (item.status === 'missing') return '未実行';
  return '採点不能';
}
const markClass = m => (m === '○' ? 'ok' : m === '×' ? 'err-text' : 'muted');

/* ---------- 結果の事実 ---------- */
export function factsHtml(scoring, result) {
  const R = scoring.facts?.race ?? {}, P = scoring.facts?.pace ?? {};
  const going = [R.going?.turf != null ? `芝：${R.going.turf}` : null, R.going?.dirt != null ? `ダート：${R.going.dirt}` : null].filter(Boolean).join(' ／ ') || '—';
  const fl = Array.isArray(P.furlongs) && P.furlongs.length ? P.furlongs.map(sec).join(' - ') : '—';
  return `<div class="lbl">結果の事実</div><div class="kv">
<b>レース</b><span>${esc(R.date ?? '—')} ${esc(R.venue ?? '')} ${R.race_no != null ? esc(R.race_no) + 'R' : ''} ${esc(R.name ?? '')}</span>
<b>距離・馬場</b><span>${esc(R.surface ?? '?')}${R.distance != null ? esc(R.distance) + 'm' : ''}</span>
<b>馬場状態</b><span>${esc(going)}</span>
<b>出走頭数</b><span>${esc(R.starters ?? '—')}頭（取消 ${esc(R.scratched ?? 0)}頭）</span>
<b>ハロンタイム</b><span>${esc(fl)}</span>
<b>前半3F</b><span>${sec(P.first_3f)}</span>
<b>後半3F</b><span>${sec(P.last_3f)}</span>
<b>差（後半 − 前半）</b><span>${formatDiff(P.first_last_diff)}（正が後半の方が遅い）</span>
<b>公表の後半3F</b><span>${sec(P.reported_last_3f)}</span></div>`;
}

/* ---------- ペースと先行争い（採点しない） ---------- */
function answerText(a) {
  if (!a || a.error) return '答えなし';
  return `${esc(a.selected ?? '—')} <span class="bdg bdg-${esc(a.level)}">${esc(a.levelLabel ?? level(a.level))}</span>`;
}
export function paceHtml(scoring, stage3) {
  const P = scoring.facts?.pace ?? {};
  let h = '<div class="lbl">ペースと先行争い（採点しません）</div>';
  h += '<p class="desc">ペースと先行争いは採点しません。結果の事実は上のとおりです。</p>';
  if (!stage3?.answers) return h + '<p class="muted">STEP3 が未実行です。</p>';
  h += `<div class="kv"><b>STEP3 のペース</b><span>${answerText(stage3.answers.pace)}</span>
<b>STEP3 の先行争い</b><span>${answerText(stage3.answers.early_lead_battle)}</span>
<b>結果の前半3F</b><span>${sec(P.first_3f)}</span>
<b>結果の後半3F</b><span>${sec(P.last_3f)}</span>
<b>結果の差（後半 − 前半）</b><span>${formatDiff(P.first_last_diff)}</span></div>`;
  return h;
}

/* ---------- ハナを切った馬 ---------- */
function nameOf(n, scoring, result) {
  const h = (result?.horses ?? []).find(x => x.number === n) ?? (scoring.horses ?? []).find(x => x.number === n);
  return h ? `${num(n)} ${esc(h.name)}` : num(n);
}
export function leaderHtml(scoring, result) {
  const L = scoring.leader;
  if (!L) return '';
  const actual = L.actual != null ? nameOf(L.actual, scoring, result)
    : `${L.candidates?.length ? `候補：${L.candidates.map(num).join('、')}（` : '（'}確定できません）`;
  const pred = L.predicted_status === 'predicted' ? `${nameOf(L.predicted, scoring, result)}（確率 ${pct(L.probability)}、${esc(level(L.level))}）`
    : L.predicted_status === 'abstain' ? '特定できないと回答（採点しません）'
    : L.predicted_status === 'unscorable_predicted' ? '採点不能' : '未実行';
  const res = L.status === 'scored' ? (L.correct ? '○' : '×') : L.status === 'abstain' ? '特定できないと回答' : L.status === 'missing' ? '未実行' : '採点不能';
  return `<div class="lbl">ハナを切った馬</div><div class="kv"><b>実際</b><span>${actual}</span><b>STEP3 の予測</b><span>${pred}</span>
<b>結果</b><span class="${markClass(res)}">${res}</span></div>`;
}

/* ---------- 各馬の表 ---------- */
function cell(item) {
  if (!item) return '—';
  const m = mark(item);
  if (m === '未実行') return '<span class="muted">未実行</span>';
  const lv = item.level ? ` <span class="bdg bdg-${esc(item.level)}">${esc(level(item.level))}</span>` : '';
  return `${zone(item.predicted)} → ${zone(item.actual)} <b class="${markClass(m)}">${m}</b>${lv}`;
}
export function horsesHtml(scoring, result) {
  const fin = new Map((result?.horses ?? []).map(h => [h.number, h.finish ?? h.status ?? '—']));
  let h = '<div class="lbl">各馬の採点（予測 → 実際）</div><div class="tbl"><table><thead><tr><th>馬番</th><th>馬名</th><th>着順</th><th>最初のコーナー</th><th>最後のコーナー</th></tr></thead><tbody>';
  for (const x of scoring.horses ?? []) {
    h += `<tr><td>${esc(x.number)}</td><td>${esc(x.name)}</td><td>${esc(fin.get(x.number) ?? '—')}</td><td>${cell(x.first_corner)}</td><td>${cell(x.last_corner)}</td></tr>`;
  }
  return h + '</tbody></table></div>';
}

/* ---------- 集計 ---------- */
function confusionHtml(title, m) {
  let h = `<div class="lbl">${esc(title)}の混同行列（行：実際、列：予測）</div><div class="tbl"><table><thead><tr><th>実際＼予測</th>${ZONE_KEYS.map(k => `<th>${zone(k)}</th>`).join('')}</tr></thead><tbody>`;
  for (const a of ZONE_KEYS) h += `<tr><td>${zone(a)}</td>${ZONE_KEYS.map(p => `<td>${esc(m?.[a]?.[p] ?? 0)}</td>`).join('')}</tr>`;
  return h + '</tbody></table></div>';
}
export function summaryHtml(scoring) {
  const S = scoring.summary;
  if (!S) return '';
  const T = S.total;
  let h = `<div class="lbl">集計</div><div class="kv"><b>全体</b><span>採点 ${esc(T.scored)}件、正解 ${esc(T.correct)}件、正答率 ${formatRate(T.correct, T.scored)}</span>
<b>採点不能・未実行</b><span>採点不能 ${esc(T.unscorable)}件、未実行 ${esc(T.missing)}件</span>`;
  for (const c of Object.keys(CORNER_LABEL)) {
    const b = S.by_corner?.[c] ?? { scored: 0, correct: 0 };
    h += `<b>${CORNER_LABEL[c]}</b><span>${formatRate(b.correct, b.scored)}（採点 ${esc(b.scored)}件、採点不能 ${esc(b.unscorable ?? 0)}件、未実行 ${esc(b.missing ?? 0)}件）</span>`;
  }
  for (const l of LEVEL_KEYS) {
    const b = S.by_level?.[l] ?? { scored: 0, correct: 0 };
    h += `<b>${esc(level(l))}</b><span>${formatRate(b.correct, b.scored)}</span>`;
  }
  h += `</div><p class="desc">${esc(NOTE_INDEPENDENCE)}</p>`;
  h += confusionHtml(CORNER_LABEL.first_corner, S.confusion?.first_corner) + confusionHtml(CORNER_LABEL.last_corner, S.confusion?.last_corner);
  h += '<div class="lbl">高確信で外れた馬</div>';
  const misses = S.high_confidence_misses ?? [];
  if (!misses.length) return h + '<p class="muted">なし</p>';
  h += '<div class="tbl"><table><thead><tr><th>馬番</th><th>馬名</th><th>コーナー</th><th>予測</th><th>実際</th><th>confidence</th></tr></thead><tbody>';
  for (const m of misses) {
    h += `<tr><td>${esc(m.number)}</td><td>${esc(m.name)}</td><td>${CORNER_LABEL[m.corner] ?? esc(m.corner)}</td><td>${zone(m.predicted)}</td><td>${zone(m.actual)}</td><td>${typeof m.confidence === 'number' ? m.confidence.toFixed(2) : '—'}</td></tr>`;
  }
  return h + '</tbody></table></div>';
}

/* ---------- 基準との比較 ---------- */
export const NOTE_BASELINE = '基準は、判定の難しさを測るための目安です。1レースの結果なので、差の大きさは判断できません。';
export function baselinesHtml(scoring) {
  const B = scoring.baselines, T = scoring.summary?.total, C = scoring.summary?.by_corner;
  if (!B || !T || !C) return '';
  const cells = (f, t, x) => `<td>${formatRate(f.correct, f.scored)}</td><td>${formatRate(t.correct, t.scored)}</td><td>${formatRate(x.correct, x.scored)}</td>`;
  const row = (label, a, b, c) => `<tr><td>${label}</td><td>${formatRate(a.correct, a.scored)}</td><td>${formatRate(b.correct, b.scored)}</td><td>${formatRate(c.correct, c.scored)}</td></tr>`;
  const A = B.always_largest, L = B.last_run, J = B.jev_same_items;
  return `<div class="lbl">基準との比較</div><div class="tbl"><table><thead><tr><th></th><th>${CORNER_LABEL.first_corner}</th><th>${CORNER_LABEL.last_corner}</th><th>合わせて</th></tr></thead><tbody>`
    + row('Jev（全体）', C.first_corner, C.last_corner, T)
    + row(`常に最も広い区分（${zone(A.zone)}）`, A.first_corner, A.last_corner, A.total)
    + row('前走と同じ区分', L.first_corner, L.last_corner, L.total)
    + row('Jev（前走ありの項目に限る）', J.first_corner, J.last_corner, J.total)
    + `</tbody></table></div><p class="desc">前走の区分なし：${esc(L.total.no_data)}件（対象外）</p><p class="desc">${esc(NOTE_BASELINE)}</p>`;
}

/* ---------- 前走との一致と層ごとの正答率 ---------- */
export const NOTE_STRATA = '層ごとの件数は少なく、判定は互いに独立でないため、差の有無は判定できません。件数が少ない層は参考値です。';
const STRATUM_LABEL = { '0-2': '0〜2走', '3': '3走', '4+': '4走以上', same: '区分が1種類', varied: '区分が2種類以上', na: '対象外（3走未満）' };
export function strataRows(strata) {
  const mk = (label, S) => ({ label, horses: S.horses, items: S.items, jev: [S.jev_correct, S.items], largest: [S.always_largest_correct, S.items],
    jevLast: [S.with_last_run.jev_correct, S.with_last_run.items], lastRun: [S.with_last_run.last_run_correct, S.with_last_run.items] });
  return {
    run_count: Object.keys(strata.by_run_count).map(k => mk(STRATUM_LABEL[k] ?? k, strata.by_run_count[k])),
    variety: Object.keys(strata.by_variety).map(k => mk(STRATUM_LABEL[k] ?? k, strata.by_variety[k])),
  };
}
function strataTable(title, rows) {
  let h = `<div class="lbl">${esc(title)}</div><div class="tbl"><table><thead><tr><th>層</th><th>馬の数</th><th>項目数</th><th>Jev</th><th>常に最も広い区分</th><th>Jev（前走ありの項目）</th><th>前走と同じ区分（同じ項目）</th></tr></thead><tbody>`;
  for (const r of rows) h += `<tr><td>${esc(r.label)}</td><td>${esc(r.horses)}</td><td>${esc(r.items)}</td><td>${formatRate(...r.jev)}</td><td>${formatRate(...r.largest)}</td><td>${formatRate(...r.jevLast)}</td><td>${formatRate(...r.lastRun)}</td></tr>`;
  return h + '</tbody></table></div>';
}
export function strataHtml(scoring) {
  const X = scoring?.strata;
  if (!X) return '';
  const A = X.agreement.total, label = v => (v ? esc(v) : '不明');
  let h = '<div class="lbl">前走との一致と層ごとの正答率</div><div class="tbl"><table><thead><tr><th>Jev の答え</th><th>項目数</th><th>Jev の正解</th><th>前走の区分の正解</th></tr></thead><tbody>'
    + `<tr><td>前走と同じ区分</td><td>${esc(A.agree.items)}</td><td>${formatRate(A.agree.correct, A.agree.items)}</td><td>—</td></tr>`
    + `<tr><td>前走と違う区分</td><td>${esc(A.deviate.items)}</td><td>${formatRate(A.deviate.jev_correct, A.deviate.items)}</td><td>${formatRate(A.deviate.last_run_correct, A.deviate.items)}</td></tr>`
    + `<tr><td>前走の区分なし</td><td>${esc(A.no_last_run.items)}</td><td>—</td><td>—</td></tr></tbody></table></div>`;
  const R = strataRows(X);
  h += strataTable('実質走数別', R.run_count) + strataTable('通過順のばらつき別', R.variety);
  return h + `<p class="desc">${esc(NOTE_STRATA)}</p><p class="desc">契約：${label(scoring.contracts?.outlook)} / ${label(scoring.contracts?.position)}</p>`;
}

/* ---------- 全体 ---------- */
export function scoreHtml(scoring, { stage3 = null, result = null } = {}) {
  if (!scoring) return '';
  if (!scoring.ok) {
    return `<div class="err">${esc(MSG_MISMATCH)}<ul>${(scoring.reasons ?? []).map(r => `<li>${esc(r.message)}</li>`).join('')}</ul></div>`;
  }
  let h = '';
  if (scoring.warnings?.length) h += `<div class="warn">採点時の注意（${scoring.warnings.length}件）<ul>${scoring.warnings.map(w => `<li>${esc(w.code)}：${esc(w.message)}</li>`).join('')}</ul></div>`;
  return h + factsHtml(scoring, result) + paceHtml(scoring, stage3) + leaderHtml(scoring, result) + horsesHtml(scoring, result) + summaryHtml(scoring) + baselinesHtml(scoring) + strataHtml(scoring);
}

/* 読み取りの警告の一覧（コードとメッセージ） */
export function warningsHtml(warnings) {
  if (!warnings?.length) return '';
  return `<div class="warn">結果の読み取りの警告（${warnings.length}件）<ul>${warnings.map(w => `<li>${esc(w.code)}：${esc(w.message)}</li>`).join('')}</ul></div>`;
}
