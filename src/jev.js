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
