import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResult } from '../src/parse/result.js';
import { formatFirst3f } from '../src/util.js';
import { factsHtml } from '../src/scoreview.js';

// 架空の結果ページ（形式A相当の3頭立て）。距離とハロンタイムだけを変える
const page = (header, furlongs) => [
  ...header,
  '1\t枠1白\t1\tアルファテスト\t牡4\t55.0\t山田 太郎\t2:00.0\t\t',
  '3 3 3 3',
  '34.5\t480(-2)\t鈴木 一郎\t5',
  '2\t枠2黒\t2\tベータサンプル\t牝5\t54.0\t佐藤 花子\t2:00.1\tクビ\t',
  '2 2 2 2',
  '35.0\t496(0)\t高橋 二郎\t3',
  '3\t枠3赤\t3\tガンマダミー\tせん6\t57.0\t田中 三郎\t2:00.3\t１ 1/4\t',
  '1 1 1 1',
  '35.2\t510(+4)\t伊藤 四郎\t1',
  'ハロンタイム\t' + furlongs.map(v => v.toFixed(1)).join(' - '),
].join('\n');
const head = d => ['2031年11月2日（日曜） 9回テスト3日', `コース：${d.toLocaleString('en-US')}メートル（芝・左）`];
const F2500 = [7.0, 11.0, 11.0, 12.0, 12.0, 12.0, 12.0, 12.0, 12.0, 12.0, 11.5, 11.5, 12.0];
const F2000 = [12.0, 11.0, 11.0, 12.0, 12.0, 12.0, 12.0, 12.0, 11.5, 12.0];
const NOTE = '算出しない（距離が200mで割り切れず、最初の区間が200m未満のため）';

test('2500m：前半3Fと差は null、後半3F・後半4F・ハロンは従来どおり', () => {
  const r = parseResult(page(head(2500), F2500));
  assert.equal(r.race.distance, 2500);
  assert.deepStrictEqual(r.pace.furlongs, F2500);
  assert.equal(r.pace.first_3f, null);
  assert.equal(r.pace.first_last_diff, null);
  assert.equal(r.pace.last_3f, 35.0);
  assert.equal(r.pace.last_4f, 47.0);
  assert.ok(!r.warnings.some(w => w.code === 'furlong_count'));
});

test('2000m：前半3Fと差を計算する（差は 後半3F − 前半3F）', () => {
  const r = parseResult(page(head(2000), F2000));
  assert.equal(r.pace.first_3f, 34.0);
  assert.equal(r.pace.last_3f, 35.5);
  assert.equal(r.pace.first_last_diff, 1.5);
});

test('距離が取れない：前半3Fと差は null で、理由を警告に出す', () => {
  const r = parseResult(page(['2031年11月2日（日曜） 9回テスト3日'], F2000));
  assert.equal(r.race.distance, null);
  assert.equal(r.pace.first_3f, null);
  assert.equal(r.pace.first_last_diff, null);
  assert.equal(r.pace.last_3f, 35.5);
  assert.deepStrictEqual(r.warnings.filter(w => w.code === 'first3f_no_distance').map(w => w.message), ['距離が読み取れないため、前半3Fと後半3Fとの差を算出しません']);
});

test('表示：前半3Fが null のときは算出しない理由、差は「—」', () => {
  assert.equal(formatFirst3f(null, 2500), NOTE);
  assert.equal(formatFirst3f(null, null), '算出しない（距離が読み取れないため）');
  assert.equal(formatFirst3f(34, 2000), '34.0');
  const r = parseResult(page(head(2500), F2500));
  const h = factsHtml({ facts: { pace: r.pace, race: r.race } }, r);
  assert.ok(h.includes(`<b>前半3F</b><span>${NOTE}</span>`));
  assert.ok(h.includes('<b>差（後半 − 前半）</b><span>—（'));
});
