/*
 * 記録（JSON）と、フィードバック用の要約・詳しいテキストを作る。DOM・ネットワーク・保存領域には触れない。
 * ctx から読むのは下の項目だけ（s3・s4 の contract は、実際に使った契約のラベル。なければ旧版とみなす）。合言葉・API キーは受け取らない。
 *   now（Date）, host（ホスト名）, userAgent, race, horses, warnings, userInput{blind,memo},
 *   s3: null | {parsed, meta{method,at,request?{state,questions}}, state, overrides, error?}   s3Error: null | {kind,message,at}
 *   s4: null | {results, usedOutlook, usedOverridden, aborted, cancelled, states{馬番:state}}
 *   result（任意）: parseResult の返り値（race-result@1。警告を含む。結果ページの本文は含まない）
 *   scoring（任意）: scoreRace の返り値（scoring@2）   scoredAt（任意）: 採点した日時
 */
import { describeAnswer, outlookFromAnswers, levelLabel } from './score.js';
import { zoneRanges } from './derive.js';
import { paceLabels, RACE_OUTLOOK_V1, HORSE_POSITION_V2 } from './contracts.js';
import { MODEL_ID, estimateCostUsd } from './jev.js';
import { summarizeStage4 } from './stage4.js';
import { pad } from './util.js';

export const RECORD_SCHEMA = 'jev-demo-record@1';
const MAX_ERRORS = 3, MAX_ERR_CHARS = 60;
const BLIND = ['blind', 'non-blind', 'unspecified'];
const BLIND_LABEL = { blind: 'ブラインド（レース前に実行）', 'non-blind': '非ブラインド（結果を知ったあとに実行）', unspecified: '未指定' };

/* ---------- 小さな整形 ---------- */
export function formatEvalTime(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) ? `約${Math.round(ms)} ms` : '不明';
}
/* STEP4 の評価時間の合計。評価時間のある馬だけを合計し、一部の馬にないときは頭数を併記する */
export function formatEvalTotal(results) {
  const ok = results.filter(r => r.status === 'ok');
  const have = ok.map(r => r.parsed?.evaluationTimeMs).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!have.length) return '不明';
  const t = formatEvalTime(have.reduce((x, y) => x + y, 0));
  return have.length < ok.length ? `不明（取得できた分の合計：${t}、${have.length}頭分）` : t;
}
/* 中継関数が測った往復時間。Jev の評価時間とは別物 */
export function formatRoundTrip(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) ? `約${Math.round(ms)} ms（中継を含む往復時間）` : '不明';
}
export function hostKind(host) {
  const h = String(host ?? '').toLowerCase();
  if (h === '' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return 'local';
  if (h.endsWith('.netlify.app')) return 'netlify';
  if (h.endsWith('.github.io')) return 'github-pages';
  return 'other';
}
const toDate = v => (v instanceof Date ? v : new Date(v));
/* ローカル時刻にタイムゾーンのずれを付けた ISO 形式 */
export function isoWithOffset(date) {
  const d = toDate(date), off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    + `${off < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
const stamp = date => { const d = toDate(date); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };
const oneLine = v => String(v ?? '').replace(/[\r\n]+/g, ' ');
const cut = (v, n) => { const t = oneLine(v); return t.length > n ? t.slice(0, n) + '…' : t; };
const present = v => v !== undefined && v !== null && v !== '';

export async function stateHash(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/* ---------- 答えの表示内容（score.js の describeAnswer を使う） ---------- */
function leaderLabels(horses) {
  const m = { unclear: '特定できない' };
  horses.forEach(h => { m['h' + pad(h.num)] = `${h.num}番 ${h.name}`; });
  return m;
}
const zoneLabelMap = n => Object.fromEntries(zoneRanges(n).map(z => [z.key, z.label]));
function describe(kind, answer, model, labels) {
  try {
    const d = describeAnswer(kind, answer, model, labels);
    return { kind, selected: d.selected, choice: answer.selected ?? null, level: d.level, levelLabel: d.levelLabel,
      confidence: d.confidence, probabilities: d.rows.map(r => ({ key: r.key, label: r.label, probability: r.probability })) };
  } catch (e) { return { error: e.message }; }
}
function s3Answers(ctx) {
  const { parsed } = ctx.s3, A = parsed.answers, M = parsed.answeredModel;
  return {
    lead_horse: describe('select', A.lead_horse, M, leaderLabels(ctx.horses)),
    early_lead_battle: describe('truth', A.early_lead_battle, M),
    pace: describe('grade', A.pace, M, paceLabels()),
  };
}
function s4Corners(ctx, r) {
  const zl = zoneLabelMap(ctx.horses.length), M = r.parsed.answeredModel;
  return { firstCorner: describe('select', r.parsed.answers.first_corner, M, zl), lastCorner: describe('select', r.parsed.answers.last_corner, M, zl) };
}
function s3Outlook(ctx) {
  try { return outlookFromAnswers(ctx.s3.parsed, ctx.horses, ctx.s3.overrides || {}); }
  catch (e) { return { outlook: null, overridden: [], error: e.message }; }
}
/* 実行時に送った state と questions だけを取り出す（認証情報を含みうるリクエスト本文全体は入れない） */
const requestOf = q => (q && q.state !== undefined && q.questions !== undefined ? { state: q.state, questions: q.questions } : null);
const usageOf = p => ({ inputTokens: p.inputTokens ?? null, outputTokens: p.outputTokens ?? null });
const roundTripOf = p => (typeof p.roundTripMs === 'number' ? p.roundTripMs : null);
const requestIdOf = p => (typeof p.requestId === 'string' ? p.requestId : null);
const evalOf = p => (typeof p.evaluationTimeMs === 'number' ? p.evaluationTimeMs : null);

/* 実際に使った契約のラベル。ラベルがない旧い形の入力は、変更前と同じ旧版とみなす */
const s3Label = ctx => ctx.s3?.contract || RACE_OUTLOOK_V1.label;
const s4Label = ctx => ctx.s4?.contract || HORSE_POSITION_V2.label;

/* ---------- 記録（JSON） ---------- */
export async function buildRecord(ctx) {
  const R = ctx.race || {}, T = R.track || {};
  const track = {};
  for (const [k, v] of Object.entries(T)) if (present(v)) track[k] = v;
  const blind = BLIND.includes(ctx.userInput?.blind) ? ctx.userInput.blind : 'unspecified';
  let stage3 = null;
  if (ctx.s3) {
    const { parsed, meta, state } = ctx.s3, ol = s3Outlook(ctx), api = meta?.method === 'api';
    const request = api ? requestOf(meta.request) : null;
    stage3 = {
      contract: s3Label(ctx), route: api ? 'api' : 'paste', executedAt: api ? meta.at ?? null : null,
      sentModel: api ? MODEL_ID : null, answeredModel: parsed.answeredModel ?? null,
      stateHash: await stateHash(request ? request.state : state), outlook: ol.outlook, overridden: ol.overridden,
      answers: s3Answers(ctx), usage: usageOf(parsed), evaluationTimeMs: evalOf(parsed), requestId: requestIdOf(parsed), roundTripMs: roundTripOf(parsed), raw: ctx.s3.raw ?? null,
      request,
    };
  }
  let stage4 = null;
  if (ctx.s4) {
    const results = [];
    for (const r of ctx.s4.results) {
      const ok = r.status === 'ok', request = requestOf(r.request), st = request ? request.state : ctx.s4.states?.[r.num];
      results.push({
        num: r.num, name: r.name, status: r.status, executedAt: r.at ?? null,
        answeredModel: ok ? r.parsed.answeredModel ?? null : null,
        stateHash: ok && st ? await stateHash(st) : null,
        ...(ok ? s4Corners(ctx, r) : { firstCorner: null, lastCorner: null }),
        usage: ok ? usageOf(r.parsed) : null, evaluationTimeMs: ok ? evalOf(r.parsed) : null,
        requestId: ok ? requestIdOf(r.parsed) : null, roundTripMs: ok ? roundTripOf(r.parsed) : null,
        errorKind: r.errorKind ?? null, errorMessage: r.errorMessage ?? null, raw: r.raw ?? null,
        request,
      });
    }
    stage4 = { contract: s4Label(ctx), sentModel: MODEL_ID, usedOutlook: ctx.s4.usedOutlook ?? null,
      aborted: ctx.s4.aborted ?? null, cancelled: !!ctx.s4.cancelled, results };
  }
  return {
    schema: RECORD_SCHEMA, createdAt: isoWithOffset(ctx.now),
    page: { host: hostKind(ctx.host), userAgent: ctx.userAgent ?? null },
    race: { name: R.name ?? null, date: R.date ?? null, venue: R.venue ?? null, course: `${R.distance || '?'}m（${R.courseDesc || '?'}）`,
      conditions: R.conditions ?? null, fieldSize: ctx.horses.length },
    track, warnings: [...(ctx.warnings || [])].map(String),
    userInput: { blind, memo: String(ctx.userInput?.memo ?? '') },
    stage3, stage4,
    result: ctx.result ? structuredClone(ctx.result) : null,
    scoring: ctx.result && ctx.scoring ? structuredClone(ctx.scoring) : null,
    scoredAt: ctx.result && ctx.scoring ? isoWithOffset(ctx.scoredAt ?? ctx.now) : null,
  };
}

/* 記録のファイル名。jev_ で始め、.gitignore の /jev_*.json に一致させる */
export function recordFileName(ctx) {
  const R = ctx.race || {};
  const times = [ctx.s3?.meta?.at, ...(ctx.s4?.results || []).map(r => r.at)].filter(Boolean).map(t => new Date(t)).filter(d => !isNaN(d));
  const last = times.length ? new Date(Math.max(...times)) : toDate(ctx.now);
  const safe = s => String(s ?? '').replace(/[^\p{L}\p{N}-]/gu, '');
  return `jev_record_${safe(R.date) || 'race'}_${safe(R.venue)}${R.raceNo ? safe(R.raceNo) + 'R' : ''}_${stamp(last)}.json`;
}

/* ---------- 採点の要約項目 ---------- */
const rate = (c, n) => `${c}/${n}`;
const LEADER_MARK = { scored: null, abstain: '答えなし', missing: '未実行' };
function leaderMark(L) {
  if (!L) return '採点不能';
  if (L.status === 'scored') return L.correct ? '○' : '×';
  return LEADER_MARK[L.status] ?? '採点不能';
}
function baselineItem(S) {
  const B = S.baselines;
  if (!B || !B.always_largest.total.scored) return []; // 採点した項目がなければ足さない
  return [`基準=${ZL[B.always_largest.zone] ?? B.always_largest.zone}${rate(B.always_largest.total.correct, B.always_largest.total.scored)} 前走${rate(B.last_run.total.correct, B.last_run.total.scored)}`];
}
function agreementItem(S) {
  const A = S.strata?.agreement?.total;
  if (!A || !S.baselines?.always_largest.total.scored) return []; // 基準と同じ扱い
  return [`一致=${rate(A.agree.correct, A.agree.items)} 違い=${rate(A.deviate.jev_correct, A.deviate.items)}`];
}
function strataText(S) {
  const X = S.strata;
  if (!X) return [];
  const A = X.agreement.total, r = (c, n) => (n ? `${c}/${n}（${Math.round(c / n * 100)}%）` : '—');
  const L = ['前走との一致と層ごとの正答率（件数は少なく、判定は互いに独立でないため、差の有無は判定できません。件数が少ない層は参考値です）',
    `- 前走と同じ区分：${A.agree.items}件、Jev 正解 ${r(A.agree.correct, A.agree.items)}`,
    `- 前走と違う区分：${A.deviate.items}件、Jev 正解 ${r(A.deviate.jev_correct, A.deviate.items)}、前走の区分の正解 ${r(A.deviate.last_run_correct, A.deviate.items)}`,
    `- 前走の区分なし：${A.no_last_run.items}件`];
  const tbl = (title, labels, group) => {
    L.push(`${title}`);
    for (const k of Object.keys(group)) {
      const g = group[k], w = g.with_last_run;
      L.push(`- ${labels[k] ?? k}：馬${g.horses}頭 項目${g.items} Jev ${r(g.jev_correct, g.items)} 常に最も広い区分 ${r(g.always_largest_correct, g.items)} 前走ありのJev ${r(w.jev_correct, w.items)} 前走 ${r(w.last_run_correct, w.items)}`);
    }
  };
  tbl('実質走数別', { '0-2': '0〜2走', '3': '3走', '4+': '4走以上' }, X.by_run_count);
  tbl('通過順のばらつき別', { same: '区分が1種類', varied: '区分が2種類以上', na: '対象外（3走未満）' }, X.by_variety);
  L.push(`契約：${S.contracts?.outlook ?? '不明'} / ${S.contracts?.position ?? '不明'}`);
  return L;
}
function scoringItems(ctx) {
  const fmt = `res=format${ctx.result.source_format ?? '?'}`, W = (ctx.result.warnings || []).length, S = ctx.scoring;
  if (!S.ok) return [fmt, '採点なし(race_mismatch)', `警告=${W}`];
  const T = S.summary.total, C = S.summary.by_corner, H = S.summary.by_level.high;
  return [fmt, `最初=${rate(C.first_corner.correct, C.first_corner.scored)}`, `最後=${rate(C.last_corner.correct, C.last_corner.scored)}`,
    `高確信=${rate(H.correct, H.scored)}`, `ハナ=${leaderMark(S.leader)}`, `採点不能=${T.unscorable}`, `警告=${W}`];
}
const ZL = { front: '先頭', forward: '好位', mid: '中団', rear: '後方' };
const CL = { first_corner: '最初のコーナー', last_corner: '最後のコーナー' };
const itemText = it => {
  if (!it) return '—';
  if (it.status === 'missing') return '未実行';
  const m = it.status === 'scored' ? (it.correct ? '○' : '×') : '採点不能';
  return `${ZL[it.predicted] ?? '—'}→${ZL[it.actual] ?? '不明'} ${m}`;
};
function scoringDetail(ctx) {
  const S = ctx.scoring, L = ['', '【結果と採点】'];
  if (!S.ok) { L.push(`採点なし：${(S.reasons || []).map(r => oneLine(r.message)).join(' ／ ')}`); return L; }
  L.push(scoringItems(ctx).join(' '));
  for (const h of S.horses) L.push(`${h.number}番 ${h.name}：最初のコーナー ${itemText(h.first_corner)} ／ 最後のコーナー ${itemText(h.last_corner)}`);
  const ms = S.summary.high_confidence_misses;
  L.push(`高確信で外れた馬：${ms.length ? '' : 'なし'}`);
  for (const m of ms) L.push(`- ${m.number}番 ${m.name} ${CL[m.corner] ?? m.corner} 予測 ${ZL[m.predicted] ?? '—'} 実際 ${ZL[m.actual] ?? '—'} confidence ${m.confidence ?? '—'}`);
  L.push(...strataText(S));
  return L;
}

/* ---------- 要約の1行 ---------- */
function errorsOf(ctx) {
  const list = [];
  if (ctx.s3Error) list.push({ at: ctx.s3Error.at, head: `S3 ${ctx.s3Error.kind}:`, msg: ctx.s3Error.message });
  for (const r of ctx.s4?.results || []) if (r.status === 'failed') list.push({ at: r.at, head: `S4 ${r.num}番 ${r.errorKind}:`, msg: r.errorMessage });
  list.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
  return list.slice(0, MAX_ERRORS).map(e => {
    let m = oneLine(e.msg);
    if (m.includes('JSON として読めません')) m = 'JSON として読めません'; // 応答の断片を含めない
    return e.head + cut(m.replace(/;/g, '；').replace(/\|/g, '/'), MAX_ERR_CHARS);
  });
}
function outlookItems(ctx) {
  const { parsed, overrides } = ctx.s3, ol = s3Outlook(ctx);
  const A = parsed.answers, M = parsed.answeredModel;
  const lv = (kind, a) => { try { return levelLabel(describeAnswer(kind, a, M, kind === 'select' ? leaderLabels(ctx.horses) : kind === 'grade' ? paceLabels() : undefined).level); } catch { return '不明'; } };
  const defs = [['lead', 'leader', 'expected_leader', 'select', 'lead_horse'], ['battle', 'battle', 'early_lead_battle', 'truth', 'early_lead_battle'], ['pace', 'pace', 'pace', 'grade', 'pace']];
  return defs.map(([label, ovKey, key, kind, qk]) => {
    const v = ol.outlook?.[key];
    if (!v) return `${label}=なし`;
    return ol.overridden.includes(ovKey) ? `${label}=${oneLine(v)}[上書き]` : `${label}=${oneLine(v)}[${lv(kind, A[qk])}]`;
  });
}
function fmtCostLine(m) {
  const v = m.okCount - m.excludedCount > 0 ? m.costUsd : null;
  if (v == null) return '不明';
  const t = v.toPrecision(2);
  return `$${t.includes('e') ? v.toFixed(8) : t}`;
}
function outlookSource(s4) {
  if (!s4.usedOutlook) return 'なし';
  const ov = s4.usedOverridden || [];
  return ov.length ? `手動上書き(${ov.join(',')})` : 'S3の答え';
}

export function buildSummaryLine(ctx) {
  const R = ctx.race || {}, T = R.track || {};
  const parts = ['FB1', isoWithOffset(ctx.now), `host=${hostKind(ctx.host)}`];
  const race = [R.date, R.venue, R.raceNo ? `${R.raceNo}R` : null, R.name, R.distance ? `${R.distance}m${R.courseDesc ? `（${R.courseDesc}）` : ''}` : null, `${ctx.horses.length}頭`].filter(present).join(' ');
  parts.push(`race=${race}`, `warn=${(ctx.warnings || []).length}`);
  const track = [T.weather, T.turfGoing, present(T.cushion) ? `CV${T.cushion}` : null, T.announcedAt ? `発表=${T.announcedAt}` : null].filter(present).join(' ');
  if (track) parts.push(`track=${track}`);
  if (ctx.s3) {
    const m = ctx.s3.meta?.method === 'api' ? 'api' : 'paste';
    parts.push(['S3=' + m, '成功', `model=${ctx.s3.parsed.answeredModel ?? '不明'}`, `ctr=${s3Label(ctx)}`, ...outlookItems(ctx)].join(' '));
  } else parts.push(ctx.s3Error ? 'S3=失敗' : 'S3=未実行');
  if (ctx.s4) {
    const m = summarizeStage4(ctx.s4.results, estimateCostUsd);
    parts.push(['S4=api', `ok${m.okCount}/ng${m.failedCount}/skip${m.skippedCount}`, `ctr=${s4Label(ctx)}`, `outlook=${outlookSource(ctx.s4)}`,
      `tok=${m.inputTokens}/${m.outputTokens}`, `cost=${fmtCostLine(m)}`].join(' '));
  } else parts.push('S4=未実行');
  const errs = errorsOf(ctx);
  parts.push(`err=${errs.length ? errs.join(';') : 'なし'}`);
  if (ctx.result && ctx.scoring) parts.push([...scoringItems(ctx), ...baselineItem(ctx.scoring), ...agreementItem(ctx.scoring)].join(' '));
  return oneLine(parts.join(' | '));
}

/* ---------- 詳しいテキスト ---------- */
const pc = p => `${Math.round(p * 100)}%`;
const topProbs = (rows, n = 3) => rows.filter(r => r.probability > 0).slice(0, n).map(r => `${r.label} ${pc(r.probability)}`).join('、');
function answerText(d) {
  if (!d) return '—';
  if (d.error) return `読み取り不可（${oneLine(d.error)}）`;
  return `${d.selected}（${topProbs(d.probabilities)}）${d.confidence != null ? ` confidence ${d.confidence.toFixed(2)}` : ''} 振り分け：${d.levelLabel}`;
}

export function buildDetailText(ctx) {
  const R = ctx.race || {}, T = R.track || {}, L = [];
  L.push('【レース】', `${R.date ?? ''} ${R.venue ?? ''} ${R.raceNo ? R.raceNo + 'R' : ''} ${R.name ?? ''}`.replace(/\s+/g, ' ').trim(),
    `コース：${R.distance || '?'}m（${R.courseDesc || '?'}） 条件：${R.conditions ?? '—'} 頭数：${ctx.horses.length}`,
    `ホスト：${hostKind(ctx.host)} ／ 実行の区分：${BLIND_LABEL[ctx.userInput?.blind] || BLIND_LABEL.unspecified}`);
  if (ctx.userInput?.memo) L.push(`メモ：${oneLine(ctx.userInput.memo)}`);
  L.push('', '【馬場】');
  const tk = Object.entries(T).filter(([, v]) => present(v)).map(([k, v]) => `${k}=${oneLine(v)}`);
  L.push(tk.length ? tk.join(' ／ ') : '—');
  L.push('', `【警告】${(ctx.warnings || []).length}件`, ...(ctx.warnings || []).map(w => `- ${oneLine(w)}`));
  L.push('', '【STEP3】');
  if (!ctx.s3) L.push(ctx.s3Error ? `失敗（${ctx.s3Error.kind}：${oneLine(ctx.s3Error.message)}）` : '未実行');
  else {
    const { parsed, meta } = ctx.s3, A = s3Answers(ctx), ol = s3Outlook(ctx);
    L.push(`経路：${meta?.method === 'api' ? 'api' : 'paste'} ／ 実行日時：${meta?.at ?? '—'} ／ 契約：${s3Label(ctx)} ／ 答えた版：${parsed.answeredModel ?? '不明'}`,
      `ハナ：${answerText(A.lead_horse)}`, `先行争い：${answerText(A.early_lead_battle)}`, `ペース：${answerText(A.pace)}`,
      `STEP4 に渡す値：${ol.outlook ? ['expected_leader', 'early_lead_battle', 'pace'].filter(k => k in ol.outlook).map(k => `${k}=${oneLine(ol.outlook[k])}`).join(' ／ ') : 'なし'}${ol.overridden.length ? `（手で上書き：${ol.overridden.join('、')}）` : ''}`,
      `評価時間：${formatEvalTime(parsed.evaluationTimeMs)} ／ 往復時間：${formatRoundTrip(parsed.roundTripMs)} ／ トークン：入力 ${parsed.inputTokens ?? '不明'} 出力 ${parsed.outputTokens ?? '不明'}`);
  }
  L.push('', '【STEP4】');
  if (!ctx.s4) L.push('未実行');
  else {
    const m = summarizeStage4(ctx.s4.results, estimateCostUsd);
    L.push(`契約：${s4Label(ctx)} ／ race_outlook：${outlookSource(ctx.s4)} ／ 成功${m.okCount} 失敗${m.failedCount} 未実行${m.skippedCount}${ctx.s4.cancelled ? ' ／ 中止あり' : ''}${ctx.s4.aborted ? ` ／ 中断（${ctx.s4.aborted.kind}）` : ''}`,
      `トークン：入力 ${m.inputTokens} 出力 ${m.outputTokens} ／ 評価時間の合計：${formatEvalTotal(ctx.s4.results)} ／ 概算費用：${fmtCostLine(m)}`);
    for (const r of ctx.s4.results) {
      if (r.status === 'ok') {
        const c = s4Corners(ctx, r);
        L.push(`${r.num}番 ${r.name}：最初のコーナー ${answerText(c.firstCorner)} ／ 4コーナー ${answerText(c.lastCorner)} ／ 成功`);
      } else if (r.status === 'failed') L.push(`${r.num}番 ${r.name}：失敗（${r.errorKind}：${oneLine(r.errorMessage)}）`);
      else L.push(`${r.num}番 ${r.name}：未実行`);
    }
  }
  if (ctx.result && ctx.scoring) L.push(...scoringDetail(ctx));
  return L.join('\n');
}
