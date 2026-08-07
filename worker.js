// worker.js
import { generateMateIn3, isMateIn3, attackerCanMate } from './generator.js';
import { sfenToPosition, positionToSfen, usiToMove, moveToUsi } from './sfen.js';
import { doMove, undoMove, generateLegalMoves } from './engine.js';

self.addEventListener('message', async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'generate') {
      const problem = await generateMateIn3(msg.seed, msg.opts);
      self.postMessage({ type: 'problem', problem });
    } else if (msg.type === 'validate-first-move') {
      handleFirstMove(msg);
    } else if (msg.type === 'validate-final') {
      handleFinal(msg);
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err) });
  }
});

function handleFirstMove(msg) {
  const { position } = sfenToPosition(msg.sfen);
  const move = usiToMove(msg.move, position);
  const u = doMove(position, move);

  // その手で 1 手詰以下に持ち込めるか（受方全応手について）
  const replies = generateLegalMoves(position);
  if (replies.length === 0) {
    // 1 手詰だった
    undoMove(position, u);
    self.postMessage({
      type: 'validation',
      kind: 'first-move',
      correct: false,
      reason: 'これは 1 手詰めです。3 手詰めの初手を指してください。',
    });
    return;
  }

  // 受方の最善応手を選ぶ（最も長引く応手）
  let bestReply = replies[0];
  let bestScore = -Infinity;
  for (const r of replies) {
    const ur = doMove(position, r);
    const mateMove = attackerCanMate(position, 1);
    undoMove(position, ur);
    const score = mateMove ? 0 : 100;   // 詰まされない応手を最優先
    if (score > bestScore) { bestScore = score; bestReply = r; }
  }

  // 選ばれた応手の後、攻方が 1 手で詰ませられるか
  const ur = doMove(position, bestReply);
  const finalMove = attackerCanMate(position, 1);
  undoMove(position, ur);

  if (!finalMove) {
    undoMove(position, u);
    self.postMessage({
      type: 'validation',
      kind: 'first-move',
      correct: false,
      reason: 'この手では詰みません。',
    });
    return;
  }

  undoMove(position, u);
  self.postMessage({
    type: 'validation',
    kind: 'first-move',
    correct: true,
    defenderReply: moveToUsi(bestReply),
  });
}

function handleFinal(msg) {
  const { position } = sfenToPosition(msg.sfen);
  for (const usi of msg.moves) {
    const m = usiToMove(usi, position);
    doMove(position, m);
  }
  const replies = generateLegalMoves(position);
  const mated = replies.length === 0;

  self.postMessage({
    type: 'validation',
    kind: 'final',
    correct: mated,
    reason: mated ? null : 'まだ詰んでいません。',
  });
}
