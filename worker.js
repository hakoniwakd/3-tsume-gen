// worker.js —— 問題生成・SFEN 検証（メインスレッドをブロックしない）
import { generateMateIn3, finalizeProblem, matchesTagRequirements, hasRedundantPiece } from './generator.js';
import { sfenToPosition } from './sfen.js';
import {
  isSanePosition, isMateIn1, countMatingFirstMoves,
} from './engine.js';

let cancelled = false;

self.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'generate') { handleGenerate(msg); }
  else if (msg.type === 'load-sfen') { handleLoadSfen(msg.sfen); }
  else if (msg.type === 'cancel') { cancelled = true; }
});

async function handleGenerate(msg) {
  cancelled = false;
  let s = (msg.seed >>> 0) || 1;
  const opts = msg.opts || {};
  const perSeedBudget = opts.budget || 4000;
  const maxSeeds = opts.maxSeeds || 25;
  for (let attempt = 0; attempt < maxSeeds; attempt++) {
    if (cancelled) {
      self.postMessage({ type: 'error', error: 'キャンセルしました。' });
      return;
    }
    try {
      const problem = generateMateIn3(s, {
        ...opts,
        budget: perSeedBudget,
        onProgress: (stats) => self.postMessage({ type: 'progress', stats }),
      });
      self.postMessage({ type: 'problem', problem });
      return;
    } catch {
      // seed を進めて再試行
      s = (Math.imul(s, 1103515245) + 12345) >>> 0 || 1;
      await new Promise(r => setTimeout(r, 0)); // キャンセル受付のために譲る
    }
  }
  self.postMessage({
    type: 'error',
    error: '指定条件では生成できませんでした。難易度・タグを緩めて再試行してください。',
  });
}

function handleLoadSfen(sfen) {
  try {
    const { position } = sfenToPosition(sfen);
    if (!isSanePosition(position)) throw new Error('不正な局面です');
    if (isMateIn1(position)) throw new Error('これは1手詰です');
    const { count } = countMatingFirstMoves(position);
    if (count !== 1) throw new Error('3手詰ではないか、余詰があります');
    if (hasRedundantPiece(position)) throw new Error('不要な駒があります');
    const problem = finalizeProblem(position, null, 0);
    if (!problem) throw new Error('解手順の抽出に失敗しました');
    self.postMessage({ type: 'problem', problem });
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err.message || err) });
  }
}