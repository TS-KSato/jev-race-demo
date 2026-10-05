import test from 'node:test';
import assert from 'node:assert/strict';
import { recordStatus } from '../src/record-status.js';

test('記録なし', () => {
  const r = recordStatus({ hasRecord: false, hasResult: true, scoring: { ok: true } });
  assert.equal(r.kind, 'none');
  assert.equal(r.text, 'STEP3 または STEP4 を実行すると、記録を作れます');
});
test('採点を含まない', () => {
  const r = recordStatus({ hasRecord: true, hasResult: false, scoring: null });
  assert.equal(r.kind, 'unscored');
  assert.ok(r.text.startsWith('この記録には、結果と採点が含まれません。'));
});
test('採点を含む', () => {
  const r = recordStatus({ hasRecord: true, hasResult: true, scoring: { ok: true, reasons: [] } });
  assert.equal(r.kind, 'scored');
  assert.equal(r.text, 'この記録には、結果と採点が含まれます');
});
test('採点に失敗：最初の理由の message が入る', () => {
  const r = recordStatus({ hasRecord: true, hasResult: true, scoring: { ok: false, reasons: [{ code: 'a', message: '理由1' }, { code: 'b', message: '理由2' }] } });
  assert.equal(r.kind, 'failed');
  assert.equal(r.text, '結果は貼り付けられていますが、採点できませんでした（理由：理由1）。この記録には、採点の失敗の理由が入ります');
});
