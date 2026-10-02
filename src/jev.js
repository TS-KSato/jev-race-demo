/* Jev との境目。Jev に固有の値・名前はこのファイルだけに置く。 */
export const MODEL_ID = 'jev-1.13.0';
export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const LIMITS = { requestTokens: 64000, stateAndLongestQuestionTokens: 32000, checkedOn: '2026-09-29' };
export const PRICE = { usdPerMillionInputTokens: 0.042, outputFree: true, checkedOn: '2026-09-29' };
export const RATE_LIMITS = { tokensPerSecond: 250000, requestsPerMinute: 1200, checkedOn: '2026-09-29' };

// デモ内部の質問の種類 → Jev の質問の型
const TYPE_OF_KIND = { truth: 'noul', select: 'choice', grade: 'score' };

export function toJevQuestions(questions) {
  const out = {};
  for (const [key, q] of Object.entries(questions)) {
    const type = TYPE_OF_KIND[q.kind];
    if (!type) throw new Error(`未知の質問の種類です：${key}（kind=${q.kind}）`);
    const { kind, ...rest } = q;
    out[key] = { type, ...rest };
  }
  return out;
}

export function buildRequest(state, questions) {
  return { model: MODEL_ID, state, questions: toJevQuestions(questions) };
}

// トークン数は正確に数えられないため、1文字を1トークンとみなす余裕のある目安とする
export function estimateTokens(value) {
  return JSON.stringify(value).length;
}

export function checkLimits(request) {
  const s = estimateTokens(request.state);
  const qs = Object.values(request.questions).map(estimateTokens);
  const total = s + qs.reduce((a, b) => a + b, 0);
  const stateAndLongest = s + (qs.length ? Math.max(...qs) : 0);
  const ok = total <= LIMITS.requestTokens && stateAndLongest <= LIMITS.stateAndLongestQuestionTokens;
  return { ok, total, stateAndLongest, limits: LIMITS };
}

export function estimateCostUsd(inputTokens) {
  if (inputTokens == null) return null;
  return inputTokens * PRICE.usdPerMillionInputTokens / 1000000;
}

const PROB_SUM_MIN = 0.95;
const PROB_SUM_MAX = 1.05;

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isProb = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const orNull = (v, type) => (typeof v === type && (type !== 'number' || Number.isFinite(v)) ? v : null);

function checkProb(v, label) {
  if (!isProb(v)) throw new Error(`${label} が 0 以上 1 以下の数値ではありません：${JSON.stringify(v)}`);
  return v;
}

function sameKeys(actual, expected) {
  const a = new Set(actual), e = new Set(expected);
  return { missing: expected.filter(k => !a.has(k)), extra: actual.filter(k => !e.has(k)) };
}

function checkKeySet(actual, expected, label) {
  const { missing, extra } = sameKeys(actual, expected);
  if (missing.length || extra.length) {
    throw new Error(`${label} の確率のキーが質問の選択肢と一致しません（不足：${missing.join('、') || 'なし'}／余分：${extra.join('、') || 'なし'}）`);
  }
}

function checkSum(values, label) {
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum < PROB_SUM_MIN || sum > PROB_SUM_MAX) {
    throw new Error(`${label} の確率の合計が 1 から離れています（合計 ${sum}）`);
  }
}

function needConfidence(ans, label) {
  if (!('confidence' in ans)) throw new Error(`${label} に confidence がありません`);
  return checkProb(ans.confidence, `${label} の confidence`);
}

function parseAnswer(key, ans, q) {
  const label = `質問 ${key}`;
  const expectedType = TYPE_OF_KIND[q.kind];
  if (!expectedType) throw new Error(`未知の質問の種類です：${key}（kind=${q.kind}）`);
  if (!isPlainObject(ans)) throw new Error(`${label} の答えがオブジェクトではありません`);
  if (ans.type !== expectedType) {
    throw new Error(`${label} の type が想定（${expectedType}）と一致しません：${JSON.stringify(ans.type)}`);
  }
  if (q.kind === 'truth') {
    if (!('noul' in ans)) throw new Error(`${label} に noul がありません`);
    return { kind: 'truth', probability: checkProb(ans.noul, `${label} の noul`) };
  }
  if (!isPlainObject(ans.probabilities)) throw new Error(`${label} に probabilities がありません`);
  if (q.kind === 'select') {
    const options = Object.keys(q.criteria);
    if (typeof ans.choice !== 'string' || !options.includes(ans.choice)) {
      throw new Error(`${label} の choice が選択肢にありません：${JSON.stringify(ans.choice)}`);
    }
    checkKeySet(Object.keys(ans.probabilities), options, label);
    const confidence = needConfidence(ans, label);
    options.forEach(o => checkProb(ans.probabilities[o], `${label} の確率 ${o}`));
    checkSum(options.map(o => ans.probabilities[o]), label);
    const probabilities = options
      .map(option => ({ option, p: ans.probabilities[option] }))
      .sort((a, b) => b.p - a.p); // 安定ソート：同じ p は criteria の順
    return { kind: 'select', selected: ans.choice, confidence, probabilities };
  }
  // grade
  const levels = q.criteria.map((_, i) => String(i));
  checkKeySet(Object.keys(ans.probabilities), levels, label);
  const confidence = needConfidence(ans, label);
  levels.forEach(l => checkProb(ans.probabilities[l], `${label} の確率 ${l}`));
  checkSum(levels.map(l => ans.probabilities[l]), label);
  const probabilities = levels.map(l => ({ level: Number(l), p: ans.probabilities[l] }));
  const selectedLevel = probabilities.reduce((best, x) => (x.p > best.p ? x : best)).level;
  return { kind: 'grade', selectedLevel, confidence, probabilities };
}

// Jev のレスポンス（オブジェクトまたは JSON 文字列）をデモ独自の形に変換する。想定外の形はエラーにする。
export function parseResponse(raw, questions) {
  let r = raw;
  if (typeof raw === 'string') {
    try { r = JSON.parse(raw); } catch (e) { throw new Error(`レスポンスが JSON として読めません：${e.message}`); }
  }
  if (!isPlainObject(r)) throw new Error('レスポンスがオブジェクトではありません');
  if (!isPlainObject(r.answers)) throw new Error('レスポンスに answers がない、またはオブジェクトではありません');
  const { missing, extra } = sameKeys(Object.keys(r.answers), Object.keys(questions));
  if (missing.length || extra.length) {
    throw new Error(`answers のキーが質問と一致しません（不足：${missing.join('、') || 'なし'}／余分：${extra.join('、') || 'なし'}）`);
  }
  const answers = {};
  for (const [key, q] of Object.entries(questions)) answers[key] = parseAnswer(key, r.answers[key], q);
  const usage = isPlainObject(r.usage) ? r.usage : {};
  return {
    answeredModel: orNull(r.model, 'string'),
    requestId: orNull(r.request_id, 'string'),
    evaluationTimeMs: orNull(r.evaluation_time_ms, 'number'),
    roundTripMs: orNull(r.relay_round_trip_ms, 'number'), // 中継関数が測った往復時間。Jev の評価時間ではない
    inputTokens: orNull(usage.input_tokens, 'number'),
    outputTokens: orNull(usage.output_tokens, 'number'),
    answers,
  };
}
