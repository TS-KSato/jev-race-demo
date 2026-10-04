/*
 * STEP4 の全頭実行の制御。DOM・ネットワーク・待ち時間には触れない（呼び出しは引数で差し替える）。
 * 合言葉と応答の内容は、エラーのメッセージにも含めない。
 */
const FATAL_KINDS = ['auth', 'config', 'contract', 'size', 'rate'];
const REQUIRED_ANSWERS = ['first_corner', 'last_corner'];
const MAX_MESSAGE = 200;

const skippedRecord = h => ({ num: h.num, name: h.name, status: 'skipped', raw: null, parsed: null, at: null, errorKind: null, errorMessage: null, request: null });

function failedRecord(h, kind, message, at) {
  return { num: h.num, name: h.name, status: 'failed', raw: null, parsed: null, at, errorKind: kind, errorMessage: String(message ?? '').slice(0, MAX_MESSAGE) };
}

export async function runStage4({ horses, buildFor, callOne, parse, previous, onlyNums, shouldCancel, onProgress } = {}) {
  const sorted = [...horses].sort((a, b) => a.num - b.num);
  const only = onlyNums ? new Set(onlyNums) : null;
  const prev = previous || {};
  const emit = ev => { if (onProgress) onProgress(ev); };
  const results = sorted.map(h => {
    if (only && !only.has(h.num)) return prev[h.num] ?? skippedRecord(h);
    return skippedRecord(h);
  });
  const targets = sorted.map((h, i) => ({ h, i })).filter(({ h }) => !only || only.has(h.num));
  const total = targets.length;
  let aborted = null, cancelled = false;

  for (let k = 0; k < targets.length; k++) {
    const { h, i } = targets[k];
    if (shouldCancel && shouldCancel()) { cancelled = true; break; }
    emit({ type: 'start', num: h.num, name: h.name, index: k + 1, total });
    let rec, request = null;
    try {
      const built = buildFor(h);
      // 実行時に送る state と questions だけを控える（あとで画面から作り直さない）
      request = { state: structuredClone(built.state), questions: structuredClone(built.questions) };
      const raw = await callOne(built);
      let parsed;
      try {
        parsed = parse(raw);
        if (!parsed || !parsed.answers || REQUIRED_ANSWERS.some(q => !parsed.answers[q])) throw new Error('first_corner と last_corner の答えがありません');
      } catch (e) {
        // JSON の構文エラーのメッセージには応答の断片が入るため、その場合は理由を書かない
        const why = e && e.message && !e.message.includes('JSON として読めません') ? e.message : '形式が想定と合いません';
        const err = new Error(`応答を読み取れませんでした：${why}`);
        err.kind = 'other';
        throw err;
      }
      rec = { num: h.num, name: h.name, status: 'ok', raw, parsed, at: new Date().toISOString(), errorKind: null, errorMessage: null, request };
    } catch (e) {
      const kind = e && typeof e.kind === 'string' ? e.kind : 'other';
      rec = { ...failedRecord(h, kind, e && e.message, new Date().toISOString()), request };
      if (FATAL_KINDS.includes(kind)) aborted = { kind, message: rec.errorMessage };
    }
    results[i] = rec;
    emit({ type: rec.status === 'ok' ? 'done' : 'fail', num: h.num, name: h.name, index: k + 1, total, record: rec });
    if (aborted) break;
  }
  emit({ type: 'finish', aborted, cancelled });
  return { results, aborted, cancelled };
}

/* 件数・トークン・評価時間・費用の集計。単価は持たず、estimateCost（jev.js の estimateCostUsd）を使う */
export function summarizeStage4(results, estimateCost) {
  const s = { okCount: 0, failedCount: 0, skippedCount: 0, inputTokens: 0, outputTokens: 0, evaluationTimeMs: null, evaluationTimeKnownCount: 0, costUsd: 0, excludedCount: 0 };
  for (const r of results) {
    if (r.status === 'ok') s.okCount++;
    else if (r.status === 'failed') s.failedCount++;
    else s.skippedCount++;
    if (r.status !== 'ok') continue;
    const p = r.parsed || {};
    // 評価時間が不明な馬は 0 として足さない。取得できた分だけを合計し、その頭数を残す
    if (typeof p.evaluationTimeMs === 'number') { s.evaluationTimeMs = (s.evaluationTimeMs ?? 0) + p.evaluationTimeMs; s.evaluationTimeKnownCount++; }
    if (typeof p.inputTokens !== 'number' || typeof p.outputTokens !== 'number') { s.excludedCount++; continue; }
    s.inputTokens += p.inputTokens;
    s.outputTokens += p.outputTokens;
    s.costUsd += estimateCost(p.inputTokens) ?? 0;
  }
  return s;
}

function sameContent(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameContent(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && sameContent(a[k], b[k]));
  }
  return false;
}

/* 実行に使った race_outlook（なし＝null）と今のものが、内容として違うか */
export function isStale(usedOutlook, currentOutlook) {
  return !sameContent(usedOutlook ?? null, currentOutlook ?? null);
}
