import { createHash, timingSafeEqual } from 'node:crypto';
import { ENDPOINT, buildRequest, checkLimits } from './jev.js';
import { RACE_OUTLOOK, HORSE_POSITION } from './contracts.js';

/*
 * Jev 中継の本体。環境変数 TYPESAFE_API_KEY・DEMO_PASSWORD は env 引数で受け取る（値はここに書かない）。
 * 汎用の中継ではなく、race-outlook@1 と horse-position@2 の形のリクエストだけを転送する。
 * ログには検査の失敗の種類と HTTP の status だけを出す。リクエスト・応答の内容や秘密情報は出さない。
 */

const MAX_BODY_BYTES = 512 * 1024;
const TIMEOUT_MS = 30000;

const OUTLOOK_KEYS = ['lead_horse', 'early_lead_battle', 'pace'];
const POSITION_KEYS = ['first_corner', 'last_corner'];
const OUTLOOK_STATE_KEYS = ['race', 'track', 'race_facts', 'horses'];
const POSITION_STATE_KEYS = ['race', 'track', 'target', 'others'];

class Reject extends Error {
  constructor(status, kind, message, headers) { super(message); this.status = status; this.kind = kind; this.extraHeaders = headers; }
}

function reply(status, payload, extraHeaders) {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders }, body: JSON.stringify(payload) };
}

function fail(status, kind, message, headers) {
  console.error(`relay: ${kind} (${status})`);
  return reply(status, { error: message }, headers);
}

function headerOf(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  const k = Object.keys(headers).find(x => x.toLowerCase() === name);
  return k === undefined ? undefined : headers[k];
}

const sha256 = s => createHash('sha256').update(String(s)).digest();
const samePassword = (given, expected) => timingSafeEqual(sha256(given), sha256(expected));

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameSet = (a, b) => a.length === b.length && a.every(k => b.includes(k));

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return sameSet(ka, kb) && ka.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

const bad = message => new Reject(400, '契約不一致', message);

// state から、ページ側と同じ契約のコードに渡す最小限の入力（D 相当）を取り出す。形が合わなければ 400。
function horsesFromState(horses) {
  if (!Array.isArray(horses) || !horses.length) throw bad('state の horses が契約の形ではありません');
  return horses.map(h => {
    if (!isObj(h) || h.number == null || typeof h.name !== 'string' || !Array.isArray(h.recent_races)) throw bad('state の horses が契約の形ではありません');
    return { num: h.number, name: h.name, frame: h.frame, past: h.recent_races.map(p => ({ firstZone: isObj(p) ? p.first_corner_zone : null })) };
  });
}

function expectedQuestions(contract, state) {
  if (!isObj(state) || !isObj(state.race) || typeof state.race.name !== 'string') throw bad('state の race が契約の形ではありません');
  if (contract === RACE_OUTLOOK.label) {
    if (!sameSet(Object.keys(state), OUTLOOK_STATE_KEYS)) throw bad('state の項目が契約と一致しません');
    const m = /^(\d+|\?)m（/.exec(String(state.race.course));
    if (!m) throw bad('state の race.course が契約の形ではありません');
    const D = { race: { name: state.race.name, distance: m[1] === '?' ? null : Number(m[1]) }, horses: horsesFromState(state.horses) };
    return RACE_OUTLOOK.questions(D);
  }
  const keys = Object.keys(state);
  const allowed = 'race_outlook' in state ? [...POSITION_STATE_KEYS, 'race_outlook'] : POSITION_STATE_KEYS;
  if (!sameSet(keys, allowed)) throw bad('state の項目が契約と一致しません');
  const n = state.race.field_size, t = state.target;
  if (!Number.isInteger(n) || n < 1 || !isObj(t) || t.number == null || typeof t.name !== 'string' || !Array.isArray(state.others)) throw bad('state が契約の形ではありません');
  const D = { horses: { length: n } };
  return HORSE_POSITION.questions(D, { num: t.number, name: t.name }, state.race_outlook ? state.race_outlook : null);
}

function checkQuestions(contract, questions, expected) {
  const wantKeys = contract === RACE_OUTLOOK.label ? OUTLOOK_KEYS : POSITION_KEYS;
  if (!isObj(questions)) throw bad('questions がオブジェクトではありません');
  const have = Object.keys(questions);
  const missing = wantKeys.filter(k => !have.includes(k)), extra = have.filter(k => !wantKeys.includes(k));
  if (missing.length || extra.length) throw bad(`質問のキーが契約と一致しません（不足：${missing.join('、') || 'なし'}／余分：${extra.join('、') || 'なし'}）`);
  for (const key of wantKeys) {
    const q = questions[key], e = expected[key];
    if (!isObj(q)) throw bad(`質問 ${key} がオブジェクトではありません`);
    for (const field of new Set([...Object.keys(q), ...Object.keys(e)])) {
      if (!(field in e)) throw bad(`質問 ${key} に契約にない項目があります：${field}`);
      if (!(field in q)) throw bad(`質問 ${key} に ${field} がありません`);
      if (!deepEqual(q[field], e[field])) throw bad(`質問 ${key} の ${field} が契約と一致しません`);
    }
  }
}

async function forward(request, apiKey, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) throw new Reject(504, 'タイムアウト', 'Jev の応答がタイムアウトしました');
    throw new Reject(502, '接続失敗', 'Jev に接続できませんでした');
  }
  if (res.status === 429) {
    const ra = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
    throw new Reject(429, '上流の利用制限', 'Jev の利用制限に達しました。しばらく待って再実行してください', ra ? { 'retry-after': ra } : undefined);
  }
  if (res.status < 200 || res.status >= 300) throw new Reject(502, '上流のエラー', `Jev がエラーを返しました（status ${res.status}）`);
  try {
    return await res.text();
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) throw new Reject(504, 'タイムアウト', 'Jev の応答がタイムアウトしました');
    throw new Reject(502, '接続失敗', 'Jev に接続できませんでした');
  }
}

export async function handleRelay({ method, headers, bodyText, env, fetchImpl }) {
  try {
    if (String(method).toUpperCase() !== 'POST') throw new Reject(405, 'メソッド不一致', 'POST だけ受け付けます', { allow: 'POST' });
    const apiKey = env && env.TYPESAFE_API_KEY, password = env && env.DEMO_PASSWORD;
    if (!apiKey || !password) throw new Reject(500, '設定不足', 'サーバーの設定が不足しています');
    const text = typeof bodyText === 'string' ? bodyText : '';
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new Reject(413, '本文が大きすぎる', 'リクエストが大きすぎます');
    const given = headerOf(headers, 'x-demo-password');
    if (typeof given !== 'string' || !samePassword(given, password)) throw new Reject(401, '合言葉不一致', '合言葉が正しくありません');

    let body;
    try { body = JSON.parse(text); } catch { throw new Reject(400, 'JSON不正', '本文が JSON として読めません'); }
    if (!isObj(body) || !('contract' in body) || !('state' in body) || !('questions' in body)) throw new Reject(400, '項目欠落', 'contract・state・questions が必要です');
    const contract = body.contract;
    if (contract !== RACE_OUTLOOK.label && contract !== HORSE_POSITION.label) throw new Reject(400, '未知の契約', '未知の contract です');

    checkQuestions(contract, body.questions, expectedQuestions(contract, body.state));

    // model は本文から取らない。buildRequest が jev.js の MODEL_ID を入れる
    const request = buildRequest(body.state, body.questions);
    if (!checkLimits(request).ok) throw new Reject(413, 'Jevの上限超過', 'リクエストが Jev の上限を超えています');

    const upstream = await forward(request, apiKey, fetchImpl);
    return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: upstream };
  } catch (e) {
    if (e instanceof Reject) return fail(e.status, e.kind, e.message, e.extraHeaders);
    return fail(500, '内部エラー', 'サーバーでエラーが発生しました');
  }
}
