// app.js
import { BoardView } from './board-view.js';
import { HandView } from './hand-view.js';
import { InputController } from './input-controller.js';
import { ProblemController } from './problem-controller.js';

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const canvas = document.getElementById('board');
const boardView = new BoardView(canvas);
const handAttacker = new HandView(document.getElementById('hand-attacker'), 1);
const handDefender = new HandView(document.getElementById('hand-defender'), -1);
const controller = new ProblemController(worker);
const input = new InputController(boardView, handAttacker, controller);

// ---- UI 更新 ----
const status = document.getElementById('status');
const badge = document.getElementById('difficulty-badge');
const moveList = document.getElementById('move-list');

controller.addEventListener('problem-loaded', () => {
  const p = controller.problem;
  boardView.setPosition(controller.currentPosition);
  handAttacker.setHand(controller.currentPosition.hands[0]);
  handDefender.setHand(controller.currentPosition.hands[1]);
  status.textContent = '先手の手番です。3 手で詰ましてください。';
  badge.textContent = `${p.difficulty.label} (${p.difficulty.score})`;
  badge.className = `difficulty-badge label-${p.difficulty.label}`;
  if (p.difficulty.tags.length > 0) {
    badge.textContent += ' ' + p.difficulty.tags.map(t => `#${t}`).join(' ');
  }
  moveList.innerHTML = '';
});

controller.addEventListener('move-applied', (e) => {
  const { move, ply } = e.detail;
  boardView.setPosition(controller.currentPosition);
  boardView.highlightMove(move);
  handAttacker.setHand(controller.currentPosition.hands[0]);
  handDefender.setHand(controller.currentPosition.hands[1]);

  const li = document.createElement('div');
  li.className = 'move-entry';
  li.textContent = `${ply}. ${moveToKanji(move, controller.playerMoves[ply - 2])}`;
  moveList.appendChild(li);
});

controller.addEventListener('wrong-move', (e) => {
  status.textContent = '❌ ' + e.detail.message;
  status.className = 'status status-error';
});

controller.addEventListener('move-reverted', () => {
  boardView.setPosition(controller.currentPosition);
  const last = moveList.lastElementChild;
  if (last) last.remove();
});

controller.addEventListener('solved', () => {
  status.textContent = '🎉 詰みました！お見事です。';
  status.className = 'status status-success';
});

controller.addEventListener('revealed', (e) => {
  const solution = e.detail.solution;
  status.textContent = `解答: ${solution.join(' → ')}`;
});

// ---- ボタンハンドラ ----
document.getElementById('new-problem').addEventListener('click', () => {
  const difficulty = document.getElementById('difficulty').value;
  controller.newProblem(difficulty ? { targetLabel: difficulty } : {});
});

document.getElementById('reset').addEventListener('click', () => controller.reset());
document.getElementById('reveal').addEventListener('click', () => controller.reveal());
document.getElementById('undo').addEventListener('click', () => {
  // 直近 1 手を戻す（自分の手番に戻す）
  if (controller.playerMoves.length === 0) return;
  const last = controller.playerMoves.pop();
  undoMove(controller.currentPosition, /* undo 情報を保持する必要あり */);
  boardView.setPosition(controller.currentPosition);
});

document.getElementById('hint').addEventListener('click', () => {
  const solution = controller.problem.solution;
  const ply = controller.playerMoves.length;
  if (ply >= solution.length) return;
  const hint = solution[ply];
  status.textContent = `ヒント: ${hint.substring(0, 2)} のマスに注目`;
});

// ---- 起動 ----
controller.newProblem();
