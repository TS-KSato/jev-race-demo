import { pad } from './util.js';
import { paceLabels } from './contracts.js';
import { zoneRanges, didNotRun } from './derive.js';

/* 振り分けの閾値。モデルの版ごとに持つ（暫定。design.md 7.2） */
const T_1_13_0 = { noul: { highAtOrAbove: 0.9, highAtOrBelow: 0.1 }, choiceScore: { highAtOrAbove: 0.9, middleAtOrAbove: 0.5 } };
export const THRESHOLDS = { 'jev-1.13.0': T_1_13_0, default: T_1_13_0 };

/* STEP4 の state の race_outlook に付ける注記（ui.js と requests.js で共有） */
export const OUTLOOK_NOTE = 'STEP3でJevが推定した展開であり、確定した事実ではない。「どちらとも言えない」「特定できない」「判断できない」の項目は、根拠にしない。';

const LEVEL_LABELS = { high: '高確信', middle: '中間', unclear: '判別不能' };
export const levelLabel = level => {
  if (!(level in LEVEL_LABELS)) throw new Error(`未知の区分です：${level}`);
  return LEVEL_LABELS[level];
};

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const thresholdsOf = model => THRESHOLDS[model] || THRESHOLDS.default;

/* type は parseResponse が返す答えの kind（truth・select・grade） */
export function classify(type, answer, model) {
  const t = thresholdsOf(model);
  if (type === 'truth') {
    const p = answer?.probability;
    if (!isNum(p)) throw new Error('probability が数ではありません');
    return p >= t.noul.highAtOrAbove || p <= t.noul.highAtOrBelow ? 'high' : 'middle';
  }
  if (type === 'select' || type === 'grade') {
    const c = answer?.confidence;
    if (!isNum(c)) throw new Error('confidence が数ではありません');
    if (c >= t.choiceScore.highAtOrAbove) return 'high';
    return c >= t.choiceScore.middleAtOrAbove ? 'middle' : 'unclear';
  }
  throw new Error(`未知の質問の種類です：${type}`);
}

const suffix = level => `（確信度：${level === 'high' ? '高' : '中間'}）`;

function leaderText(a, horses, model) {
  const level = classify('select', a, model);
  if (a.selected === 'unclear' || level === 'unclear') return '特定できない';
  const m = /^h(\d{2,})$/.exec(a.selected);
  const horse = m && horses.find(h => pad(h.num) === m[1]);
  if (!horse) throw new Error(`選択肢 ${a.selected} に対応する馬が出走馬にありません`);
  return `${horse.num}番 ${horse.name}${suffix(level)}`;
}

function battleText(a, model) {
  const t = thresholdsOf(model).noul;
  classify('truth', a, model);
  if (a.probability >= t.highAtOrAbove) return '激しくなる';
  if (a.probability <= t.highAtOrBelow) return '激しくならない';
  return 'どちらとも言えない';
}

/* grade の probabilities を検証し、確率が最大の段階のラベルを返す（同点なら null） */
function topGrade(a, labels) {
  const ps = a.probabilities;
  if (!Array.isArray(ps) || ps.length !== labels.length) throw new Error('pace の段階の数が契約と一致しません');
  const seen = new Set();
  for (const x of ps) {
    if (!Number.isInteger(x.level) || x.level < 0 || x.level >= labels.length || seen.has(x.level) || !isNum(x.p)) {
      throw new Error('pace の probabilities が契約の段階と一致しません');
    }
    seen.add(x.level);
  }
  const max = Math.max(...ps.map(x => x.p));
  const top = ps.filter(x => x.p === max);
  return top.length > 1 ? null : labels[top[0].level];
}

function paceText(a, model) {
  const top = topGrade(a, paceLabels());
  const level = classify('grade', a, model);
  if (level === 'unclear' || top === null) return '判断できない';
  return `${top}${suffix(level)}`;
}

const byProbabilityDesc = rows => rows
  .map((r, i) => ({ r, i }))
  .sort((x, y) => y.r.probability - x.r.probability || x.i - y.i) // 同率は元の順
  .map(x => x.r);

/* 1つの質問の表示内容。labels は select：キー→表示名のオブジェクト、grade：段階のラベルの配列 */
export function describeAnswer(kind, answer, model, labels) {
  const level = classify(kind, answer, model);
  const base = { kind, level, levelLabel: levelLabel(level) };
  if (kind === 'truth') {
    const p = answer.probability;
    return { ...base, selected: battleText(answer, model), confidence: null,
      rows: [{ key: 'true', label: '真', probability: p }, { key: 'false', label: '偽', probability: Math.round((1 - p) * 1e10) / 1e10 }] };
  }
  if (kind === 'select') {
    const ps = answer.probabilities;
    if (!Array.isArray(ps) || !ps.length) throw new Error('select の probabilities がありません');
    const name = key => {
      if (!labels || !Object.hasOwn(labels, key)) throw new Error(`選択肢 ${key} の表示名がありません`);
      return labels[key];
    };
    const rows = byProbabilityDesc(ps.map(x => {
      if (!isNum(x.p)) throw new Error(`選択肢 ${x.option} の確率が数ではありません`);
      return { key: x.option, label: name(x.option), probability: x.p };
    }));
    return { ...base, selected: name(answer.selected), confidence: answer.confidence, rows };
  }
  if (kind === 'grade') {
    if (!Array.isArray(labels)) throw new Error('grade には段階のラベルの配列が必要です');
    const top = topGrade(answer, labels);
    const rows = byProbabilityDesc(answer.probabilities.map(x => ({ key: String(x.level), label: labels[x.level], probability: x.p })));
    return { ...base, selected: top === null ? '判断できない' : top, confidence: answer.confidence, rows };
  }
  throw new Error(`未知の質問の種類です：${kind}`);
}

/* STEP3 の答え（parseResponse の結果）から STEP4 の race_outlook を作る。overrides は利用者が手で選んだ値 */
export function outlookFromAnswers(parsed, horses, overrides = {}) {
  const answers = parsed?.answers ?? {};
  const model = parsed?.answeredModel;
  const ov = overrides || {};
  const overridden = [];
  const outlook = {};
  const items = [
    ['leader', 'expected_leader', () => answers.lead_horse && leaderText(answers.lead_horse, horses, model)],
    ['battle', 'early_lead_battle', () => answers.early_lead_battle && battleText(answers.early_lead_battle, model)],
    ['pace', 'pace', () => answers.pace && paceText(answers.pace, model)],
  ];
  for (const [ovKey, key, fromJev] of items) {
    const o = ov[ovKey];
    if (o !== undefined && o !== null && o !== '') { outlook[key] = o; overridden.push(ovKey); continue; }
    const v = fromJev();
    if (v) outlook[key] = v;
  }
  return { outlook: Object.keys(outlook).length ? { note: OUTLOOK_NOTE, ...outlook } : null, overridden };
}

/* 手入力の値（leader・battle・pace）から race_outlook を作る。値のある項目だけを含める */
export function outlookFromValues({ leader, battle, pace } = {}) {
  return outlookFromAnswers(null, [], { leader, battle, pace }).outlook;
}

/* ---------- 結果と判定を照らす採点（scoring@1）。画面・記録には触れない ---------- */
export const SCORING_SCHEMA = 'scoring@3';

/* 区分の順序（先頭→後方）とキー・表示名の対応は derive.js の zoneRanges から取る（十分な頭数なら4区分すべてが出る） */
const ZONES = zoneRanges(18);
const ZONE_KEYS = ZONES.map(z => z.key);
const KEY_OF_LABEL = Object.fromEntries(ZONES.map(z => [z.label, z.key]));
const CORNERS = ['first_corner', 'last_corner'];
const RECORD_KEY = { first_corner: 'firstCorner', last_corner: 'lastCorner' };
const LEVELS = ['high', 'middle', 'unclear'];
const W = (code, message) => ({ code, message });

/* 確率が最大の選択肢のキー。同点で最大が複数なら null（tie）。答えがない・読めないなら undefined */
function topKey(answer) {
  const ps = answer?.probabilities;
  if (!Array.isArray(ps) || !ps.length || ps.some(x => !isNum(x?.probability))) return undefined;
  const max = Math.max(...ps.map(x => x.probability));
  const top = ps.filter(x => x.probability === max);
  return top.length > 1 ? { tie: true } : { key: top[0].key };
}

const emptyCount = () => ({ scored: 0, correct: 0, unscorable: 0, missing: 0 });
const emptyConfusion = () => Object.fromEntries(ZONE_KEYS.map(a => [a, Object.fromEntries(ZONE_KEYS.map(p => [p, 0]))]));

function scoreItem(corner, answer, actualInfo, num, warnings) {
  const item = { predicted: null, actual: null, status: null, correct: null, distance: null,
    confidence: answer?.confidence ?? null, level: answer?.level ?? null };
  if (actualInfo && !actualInfo.ambiguous && actualInfo.zone in KEY_OF_LABEL) item.actual = KEY_OF_LABEL[actualInfo.zone];
  const top = answer && !answer.error ? topKey(answer) : undefined;
  if (top === undefined) { item.status = 'missing'; item.confidence = null; item.level = null; return item; }
  if (top.tie) item.status = 'unscorable_predicted';
  else if (!ZONE_KEYS.includes(top.key)) {
    warnings.push(W('unknown_choice_key', `${num}番の${corner}：予測の選択肢キー「${top.key}」が今回の選択肢にありません`));
    item.status = 'unscorable_predicted';
  } else item.predicted = top.key;
  if (item.actual === null) {
    // 実際が確定できないときは、予測の側の事情より優先して unscorable_actual にする
    item.status = 'unscorable_actual';
    return item;
  }
  if (item.status) return item;
  item.status = 'scored';
  item.correct = item.predicted === item.actual;
  item.distance = Math.abs(ZONE_KEYS.indexOf(item.predicted) - ZONE_KEYS.indexOf(item.actual));
  return item;
}

const failResult = (reasons, warnings, nEntry, nResult) => ({
  schema: SCORING_SCHEMA, ok: false, reasons, warnings, n_entry: nEntry, n_result: nResult, horses: [], leader: null, summary: null, facts: null, baselines: null,
  contracts: null, strata: null,
});

/* 簡単な基準（Jev が何を上乗せしているかを測る目安。予想の方法ではない）。Jev と同じ項目だけを対象にする */
const ZONE_FIELD = { first_corner: 'firstZone', last_corner: 'lastZone' };
const addTo = (acc, ok) => { acc.scored++; if (ok) acc.correct++; };
const sumCounts = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] + b[k]]));

/* 番手の数が最も多い区分（同数なら順序で先のもの） */
function largestZone(n) {
  let best = null;
  for (const z of zoneRanges(n)) if (!best || z.to - z.from > best.to - best.from) best = z;
  return best.key;
}
/* 過去走（新しい順）のうち、そのコーナーの区分がある最も新しいもの */
function lastRun(horse, corner) {
  for (const p of horse?.past ?? []) {
    const k = KEY_OF_LABEL[p?.[ZONE_FIELD[corner]]];
    if (k) return { zone: k, run: p };
  }
  return null;
}
const lastRunZone = (horse, corner) => lastRun(horse, corner)?.zone ?? null;
/* 前走の区分に使った過去走の通過順の個数の層（解釈は変えず、数えるだけ） */
function cornerCountStratum(horse, corner) {
  const n = lastRun(horse, corner)?.run?.corners?.length;
  if (!Number.isInteger(n) || n < 1) return 'unknown';
  return n >= 4 ? '4' : '3-';
}
function computeBaselines(targets, horses, nEntry) {
  const zone = largestZone(nEntry);
  const A = {}, B = {}, J = {};
  for (const c of CORNERS) {
    A[c] = { scored: 0, correct: 0 }; B[c] = { scored: 0, correct: 0, no_data: 0 }; J[c] = { scored: 0, correct: 0 };
    for (const h of targets) {
      const item = horses.find(x => x.number === h.num)[c];
      if (item.actual === null || !['scored', 'unscorable_predicted'].includes(item.status)) continue;
      addTo(A[c], zone === item.actual);
      const lr = lastRunZone(h, c);
      if (lr === null) { B[c].no_data++; continue; }
      addTo(B[c], lr === item.actual);
      if (item.status === 'scored') addTo(J[c], item.correct);
    }
  }
  const tot = X => CORNERS.map(c => X[c]).reduce(sumCounts);
  return {
    always_largest: { zone, ...A, total: tot(A) },
    last_run: { ...B, total: tot(B) },
    jev_same_items: { ...J, total: tot(J) },
  };
}

/* ---------- 前走との一致と層ごとの正答率（層の定義は結果を見る前に固定した。調整しない） ---------- */
export const STRATA_DEFINITIONS = {
  item: '項目＝馬×コーナー（first_corner / last_corner）。集計に使うのは status が scored（Jev の答えがあり、実際の区分が確定している）の項目だけ',
  last_run: '前走の区分＝過去走（新しい順）のうち、そのコーナーの区分がある最も新しい走の区分。なければ「前走なし」',
  run_count: '実質走数＝取消・除外を除いた過去走の数（facts.ranCount。なければ past から数える）。0〜2 は「0-2」、3 は「3」、4 以上は「4+」',
  variety: '通過順のばらつき＝そのコーナーの区分がある過去走を集め、3走未満は「na」、区分が1種類だけは「same」、2種類以上は「varied」。コーナー別に定義する。層ごとの馬の数は first_corner の層で数える',
  last_run_corner_count: '前走の通過順の個数。コーナー別に、前走の区分に使った過去走の通過順の数。4個は「4」、3個以下は「3-」、前走の区分がなければ「unknown」',
};
const ranCountOf = h => (Number.isInteger(h?.facts?.ranCount) ? h.facts.ranCount : (h?.past ?? []).filter(p => !didNotRun(p)).length);
const runCountStratum = n => (n <= 2 ? '0-2' : n === 3 ? '3' : '4+');
function varietyStratum(horse, corner) {
  const zs = (horse?.past ?? []).map(p => p?.[ZONE_FIELD[corner]]).filter(Boolean);
  if (zs.length < 3) return 'na';
  return new Set(zs).size === 1 ? 'same' : 'varied';
}
const emptyStratum = () => ({ horses: 0, items: 0, jev_correct: 0, always_largest_correct: 0, with_last_run: { items: 0, jev_correct: 0, last_run_correct: 0 } });
const emptyCountStratum = () => ({ items: 0, jev_correct: 0, last_run_correct: 0 });
const emptyAgreement = () => ({ agree: { items: 0, correct: 0 }, deviate: { items: 0, jev_correct: 0, last_run_correct: 0 }, no_last_run: { items: 0 } });

function computeStrata(targets, horses, nEntry) {
  const largest = largestZone(nEntry);
  const agreement = { total: emptyAgreement(), first_corner: emptyAgreement(), last_corner: emptyAgreement() };
  const byRun = { '0-2': emptyStratum(), '3': emptyStratum(), '4+': emptyStratum() };
  const byVar = { same: emptyStratum(), varied: emptyStratum(), na: emptyStratum() };
  const byCount = { '4': emptyCountStratum(), '3-': emptyCountStratum(), unknown: emptyCountStratum() };
  for (const h of targets) {
    byRun[runCountStratum(ranCountOf(h))].horses++;
    byVar[varietyStratum(h, 'first_corner')].horses++;
    const row = horses.find(x => x.number === h.num);
    for (const c of CORNERS) {
      const item = row[c];
      if (item.status !== 'scored') continue;
      const lr = lastRunZone(h, c);
      const strata = [byRun[runCountStratum(ranCountOf(h))], byVar[varietyStratum(h, c)]];
      for (const S of strata) {
        S.items++;
        if (item.correct) S.jev_correct++;
        if (largest === item.actual) S.always_largest_correct++;
        if (lr !== null) {
          S.with_last_run.items++;
          if (item.correct) S.with_last_run.jev_correct++;
          if (lr === item.actual) S.with_last_run.last_run_correct++;
        }
      }
      const K = byCount[cornerCountStratum(h, c)];
      K.items++;
      if (item.correct) K.jev_correct++;
      if (lr !== null && lr === item.actual) K.last_run_correct++;
      for (const A of [agreement[c], agreement.total]) {
        if (lr === null) A.no_last_run.items++;
        else if (item.predicted === lr) { A.agree.items++; if (item.correct) A.agree.correct++; }
        else { A.deviate.items++; if (item.correct) A.deviate.jev_correct++; if (lr === item.actual) A.deviate.last_run_correct++; }
      }
    }
  }
  return { definitions: { ...STRATA_DEFINITIONS }, agreement, by_run_count: byRun, by_variety: byVar, by_last_run_corner_count: byCount };
}

export function scoreRace({ entry, stage3 = null, stage4 = null, result } = {}) {
  const eHorses = entry?.horses ?? [], rHorses = (result?.horses ?? []).filter(h => h.status === null || h.status === '中止' || h.status === '失格');
  const nEntry = eHorses.length, nResult = result?.race?.starters ?? rHorses.length;
  const warnings = [];

  const er = entry?.race ?? {}, rr = result?.race ?? {};
  const pairs = [['日付', er.date, rr.date], ['競馬場', er.venue, rr.venue], ['レース番号', er.raceNo, rr.race_no],
    ['距離', er.distance, rr.distance], ['馬場種別', er.surface, rr.surface]];
  const diffs = pairs.filter(([, a, b]) => a !== b || a == null).map(([k, a, b]) => `${k}（出馬表：${a ?? '不明'}／結果：${b ?? '不明'}）`);
  if (diffs.length) return failResult([W('race_mismatch', `出馬表と結果のレースが一致しません：${diffs.join('、')}`)], warnings, nEntry, nResult);

  // 馬の照合
  const started = new Map(rHorses.map(h => [h.number, h]));
  const inEntry = new Set(eHorses.map(h => h.num));
  const targets = [];
  for (const h of [...eHorses].sort((a, b) => a.num - b.num)) {
    if (started.has(h.num)) targets.push(h);
    else warnings.push(W('horse_not_started', `${h.num}番 ${h.name}：結果に出走馬としていないため（取消・除外など）、採点から外しました`));
  }
  for (const h of rHorses) {
    if (!inEntry.has(h.number)) warnings.push(W('horse_not_in_entry', `${h.number}番 ${h.name}：出馬表にいないため、採点しません`));
  }
  if (nEntry !== nResult) {
    warnings.push(W('starters_changed', `頭数が出馬表（${nEntry}頭）と結果（${nResult}頭）で違います。実際の位置区分は結果の頭数で求めたもの、予測は出馬表の頭数での区分の範囲で出たものなので、境目の馬は食い違うことがあります`));
  }

  const s4List = Array.isArray(stage4) ? stage4 : stage4?.results ?? [];
  const s4By = new Map(s4List.map(r => [r.num, r]));
  const posBy = new Map((result.positions ?? []).map(p => [p.number, p]));

  const horses = [], total = emptyCount(), byCorner = { first_corner: emptyCount(), last_corner: emptyCount() };
  const byLevel = Object.fromEntries(LEVELS.map(l => [l, { scored: 0, correct: 0 }]));
  const confusion = { first_corner: emptyConfusion(), last_corner: emptyConfusion() };
  const misses = [];

  for (const h of targets) {
    const rec = s4By.get(h.num), ok = rec?.status === 'ok', pos = posBy.get(h.num);
    const row = { number: h.num, name: h.name };
    for (const c of CORNERS) {
      const item = scoreItem(c, ok ? rec[RECORD_KEY[c]] : null, pos?.[c], h.num, warnings);
      row[c] = item;
      const bucket = item.status === 'scored' ? 'scored' : item.status === 'missing' ? 'missing' : 'unscorable';
      total[bucket]++; byCorner[c][bucket]++;
      if (item.status === 'scored') {
        if (item.correct) { total.correct++; byCorner[c].correct++; }
        confusion[c][item.actual][item.predicted]++;
        if (item.level in byLevel) { byLevel[item.level].scored++; if (item.correct) byLevel[item.level].correct++; }
        if (item.level === 'high' && !item.correct) {
          misses.push({ number: h.num, name: h.name, corner: c, predicted: item.predicted, actual: item.actual, confidence: item.confidence });
        }
      }
    }
    horses.push(row);
  }

  // ハナを切った馬
  const lead = stage3?.answers?.lead_horse;
  const leader = { predicted: null, predicted_status: 'missing', actual: result.leader?.number ?? null, candidates: result.leader?.candidates ?? [],
    status: null, correct: null, probability: null, confidence: lead?.confidence ?? null, level: lead?.level ?? null, step4_front: [] };
  const top = lead && !lead.error ? topKey(lead) : undefined;
  if (top === undefined) { leader.confidence = null; leader.level = null; }
  else if (top.tie) leader.predicted_status = 'unscorable_predicted';
  else if (top.key === 'unclear') leader.predicted_status = 'abstain';
  else {
    const m = /^h(\d{2,})$/.exec(top.key);
    const num = m ? +m[1] : null;
    if (num == null || !inEntry.has(num)) {
      warnings.push(W('unknown_choice_key', `ハナの予測の選択肢キー「${top.key}」に対応する馬が出馬表にありません`));
      leader.predicted_status = 'unscorable_predicted';
    } else {
      leader.predicted = num; leader.predicted_status = 'predicted';
      leader.probability = lead.probabilities.find(x => x.key === top.key).probability;
    }
  }
  if (leader.actual === null) leader.status = 'unscorable_actual';
  else if (leader.predicted_status === 'predicted') { leader.status = 'scored'; leader.correct = leader.predicted === leader.actual; }
  else leader.status = leader.predicted_status === 'abstain' ? 'abstain' : leader.predicted_status;
  leader.step4_front = targets.filter(h => topKey(s4By.get(h.num)?.status === 'ok' ? s4By.get(h.num).firstCorner : null)?.key === 'front').map(h => h.num);

  return {
    schema: SCORING_SCHEMA, ok: true, reasons: [], warnings, n_entry: nEntry, n_result: nResult, horses, leader,
    summary: { total, by_corner: byCorner, by_level: byLevel, confusion, high_confidence_misses: misses },
    facts: { pace: result.pace, race: result.race },
    baselines: computeBaselines(targets, horses, nEntry),
    contracts: { outlook: stage3?.contract ?? null, position: stage4?.contract ?? null },
    strata: computeStrata(targets, horses, nEntry),
  };
}

/* ---------- 段階間の矛盾（STEP3 のハナの想定と、STEP4 の first_corner の答え）。記録の consistency に入れる ---------- */
/* stage3・stage4 は記録の形（buildRecord の stage3・stage4）。Jev の答えは変えず、突き合わせるだけ */
export function consistencyOf(stage3, stage4) {
  const lead = stage3?.answers?.lead_horse;
  const top = lead && !lead.error ? topKey(lead) : undefined;
  let leaderNum = null, prob = null, level = null;
  if (top && !top.tie && top.key !== 'unclear') {
    const m = /^h(\d{2,})$/.exec(top.key);
    if (m) { leaderNum = +m[1]; prob = lead.probabilities.find(x => x.key === top.key).probability; level = lead.level ?? null; }
  }
  const results = stage4?.results ?? [];
  const okNums = new Set(results.filter(r => r.status === 'ok').map(r => r.num));
  const front = results.filter(r => r.status === 'ok' && topKey(r.firstCorner)?.key === 'front').map(r => r.num).sort((a, b) => a - b);
  // STEP4 でその馬の答えがない（未実行・失敗）ときは、矛盾とはみなさない
  const conflict = leaderNum !== null && okNums.has(leaderNum) && !front.includes(leaderNum);
  return {
    leader_vs_step4_front: { step3_leader: leaderNum, step3_probability: prob, step3_level: level, step4_front: front, conflict },
    step4_front_count: front.length,
  };
}

/* 混同行列（confusion[実際][予測]）から、区分ごとの予測の頭数と実際の頭数 */
export function zoneCounts(confusion) {
  const predicted = Object.fromEntries(ZONE_KEYS.map(k => [k, 0])), actual = Object.fromEntries(ZONE_KEYS.map(k => [k, 0]));
  for (const a of ZONE_KEYS) for (const p of ZONE_KEYS) { const n = confusion?.[a]?.[p] ?? 0; predicted[p] += n; actual[a] += n; }
  return { predicted, actual };
}

const ZONE_LABEL_JA = Object.fromEntries(ZONES.map(z => [z.key, z.label]));
const nums = a => (a.length ? a.map(n => `${n}番`).join('、') : 'なし');
/* 段階間の照合の文。画面と要約で同じ文面を使う */
export function consistencyText(c) {
  const L = c?.leader_vs_step4_front;
  if (!L) return '—';
  const f = `STEP4 で first_corner が先頭：${nums(L.step4_front)}`;
  if (L.step3_leader == null) return `STEP3 の想定なし（${f}）`;
  if (L.conflict) return `STEP3 の想定（${L.step3_leader}番）と STEP4 の答えが一致しません（${f}）`;
  if (L.step4_front.includes(L.step3_leader)) return `STEP3 の想定（${L.step3_leader}番）と STEP4 の答えは一致（${f}）`;
  return `STEP3 の想定（${L.step3_leader}番）は、STEP4 のその馬の答えがないため照合できません（${f}）`;
}
/* 頭数の比較の文（コーナー1つ分） */
export function zoneCountsText(confusion) {
  const z = zoneCounts(confusion), t = o => ZONE_KEYS.map(k => `${ZONE_LABEL_JA[k]}${o[k]}`).join(' ');
  return `予測 ${t(z.predicted)} ／ 実際 ${t(z.actual)}`;
}
export const FEW_ITEMS = 10;
/* 前走と違えた項目の文 */
export function deviateText(agreement) {
  const D = agreement?.total?.deviate;
  if (!D) return '—';
  return `${D.items}件、Jev の正解 ${D.jev_correct}件、前走の区分の正解 ${D.last_run_correct}件${D.items < FEW_ITEMS ? '（件数が少ないため判断できない）' : ''}`;
}
