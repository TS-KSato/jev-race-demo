// 記録の区画の状態表示を決める純粋関数（ui.js から使う）
export function recordStatus({ hasRecord, hasResult, scoring }) {
  if (!hasRecord) return { kind: 'none', text: 'STEP3 または STEP4 を実行すると、記録を作れます' };
  if (hasResult && scoring && scoring.ok === true) return { kind: 'scored', text: 'この記録には、結果と採点が含まれます' };
  if (hasResult && scoring && scoring.ok === false) {
    const msg = scoring.reasons?.[0]?.message ?? '不明';
    return { kind: 'failed', text: `結果は貼り付けられていますが、採点できませんでした（理由：${msg}）。この記録には、採点の失敗の理由が入ります` };
  }
  return { kind: 'unscored', text: 'この記録には、結果と採点が含まれません。STEP5 で結果ページを貼り付けて採点したあとに、もう一度ダウンロードしてください' };
}
