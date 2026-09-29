import { pad } from './util.js';
import { paceLabels } from './contracts.js';

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

function paceText(a, model) {
  const labels = paceLabels();
  const ps = a.probabilities;
  if (!Array.isArray(ps) || ps.length !== labels.length) throw new Error('pace の段階の数が契約と一致しません');
  const seen = new Set();
  for (const x of ps) {
    if (!Number.isInteger(x.level) || x.level < 0 || x.level >= labels.length || seen.has(x.level) || !isNum(x.p)) {
      throw new Error('pace の probabilities が契約の段階と一致しません');
    }
    seen.add(x.level);
  }
  const level = classify('grade', a, model);
  if (level === 'unclear') return '判断できない';
  const max = Math.max(...ps.map(x => x.p));
  const top = ps.filter(x => x.p === max);
  if (top.length > 1) return '判断できない';
  return `${labels[top[0].level]}${suffix(level)}`;
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
