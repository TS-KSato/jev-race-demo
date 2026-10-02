/*
 * 中継関数（/.netlify/functions/jev）を呼ぶ、ブラウザ側の処理。
 * ネットワークと待ち時間は引数で差し替えられる（テスト用）。
 * 合言葉と応答の内容は、ログにも例外のメッセージにも出さない。
 */
export const RELAY_PATH = '/.netlify/functions/jev';
const DEFAULT_RETRY_WAIT_S = 5;
const MAX_RETRY_WAIT_S = 60;

export class RelayError extends Error {
  constructor(kind, message) { super(message); this.name = 'RelayError'; this.kind = kind; }
}

export function buildRelayBody(contract, state, questions) {
  return JSON.stringify({ contract, state, questions });
}

export function isRelayAvailable(loc) {
  if (!loc) return false;
  if (loc.protocol === 'file:') return false;
  return !String(loc.hostname || '').toLowerCase().endsWith('github.io');
}

const defaultSleep = ms => new Promise(r => setTimeout(r, ms));

function retryWaitSeconds(res) {
  const v = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
  const n = v == null || v === '' ? NaN : Number(v);
  const s = Number.isFinite(n) && n >= 0 ? n : DEFAULT_RETRY_WAIT_S;
  return Math.min(s, MAX_RETRY_WAIT_S);
}

async function reasonOf(text) {
  try {
    const j = JSON.parse(text);
    return j && typeof j.error === 'string' ? j.error : '';
  } catch { return ''; }
}

async function attempt(url, init, fetchImpl, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctl.signal });
    const text = await res.text();
    return { res, text };
  } catch (e) {
    if (ctl.signal.aborted || (e && (e.name === 'AbortError' || e.name === 'TimeoutError'))) throw new RelayError('network', '応答がありませんでした');
    throw new RelayError('network', '中継関数に接続できませんでした');
  } finally {
    clearTimeout(timer);
  }
}

export async function callRelay({ contract, state, questions, password, fetchImpl, sleepImpl, maxRetries = 3, timeoutMs = 45000, onRetry } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const sleep = sleepImpl || defaultSleep;
  const init = {
    method: 'POST',
    headers: { 'X-Demo-Password': password ?? '', 'Content-Type': 'application/json' },
    body: buildRelayBody(contract, state, questions),
  };
  for (let n = 0; ; n++) {
    const { res, text } = await attempt(RELAY_PATH, init, doFetch, timeoutMs);
    const st = res.status;
    if (st === 200) return text;
    if (st === 429) {
      if (n >= maxRetries) throw new RelayError('rate', 'Jev の利用制限に達しました。しばらく待ってから再実行してください');
      if (onRetry) onRetry(n + 1, maxRetries);
      await sleep(retryWaitSeconds(res) * 1000);
      continue;
    }
    if (st === 401) throw new RelayError('auth', '合言葉が違います');
    if (st === 400) {
      const why = await reasonOf(text);
      throw new RelayError('contract', `リクエストが契約と合いません${why ? `（${why}）` : ''}`);
    }
    if (st === 413) throw new RelayError('size', 'リクエストが大きすぎます');
    if (st === 500) throw new RelayError('config', 'サーバーの設定が不足しています');
    if (st === 502 || st === 504) throw new RelayError('upstream', st === 504 ? 'Jev の応答がタイムアウトしました。手で再実行してください' : 'Jev との通信でエラーが発生しました。手で再実行してください');
    throw new RelayError('other', `中継関数からの応答が想定外です（状態：${st}）`);
  }
}
