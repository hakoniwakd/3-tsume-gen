// problem-controller.js
import { positionToSfen, sfenToPosition, moveToUsi, usiToMove, moveToKanji } from './sfen.js';
import { doMove, undoMove, generateLegalMoves } from './engine.js';

export class ProblemController extends EventTarget {
  constructor(worker) {
    super();
    this.worker = worker;
    this.initialPosition = null;
    this.currentPosition = null;
    this.problem = null;
    this.playerMoves = [];   // ユーザーの指した手
    this.state = 'LOADING';  // LOADING | PLAYING | SOLVED | REVEALED

    this.worker.addEventListener('message', (e) => this._onWorkerMessage(e));
  }

  async newProblem(opts = {}) {
    this.state = 'LOADING';
    this._emit('state-change');
    this.worker.postMessage({
      type: 'generate',
      seed: Date.now() & 0x7fffffff,
      opts,
    });
  }

  _onWorkerMessage(e) {
    const msg = e.data;
    if (msg.type === 'problem') {
      this.problem = msg.problem;
      this.initialPosition = sfenToPosition(msg.problem.sfen).position;
      this.currentPosition = this._clonePosition(this.initialPosition);
      this.playerMoves = [];
      this.state = 'PLAYING';
      this._emit('problem-loaded');
    } else if (msg.type === 'validation') {
      this._handleValidation(msg);
    } else if (msg.type === 'error') {
      this.state = 'ERROR';
      this._emit('error', msg.error);
    }
  }

  applyPlayerMove(move) {
    // 生成した合法手の中に一致するものを探す
    const legal = this._legalMovesCache();
    const matched = legal.find(m => this._movesEqual(m, move));
    if (!matched) return;

    doMove(this.currentPosition, matched);
    this.playerMoves.push(matched);
    this._emit('move-applied', { move: matched, ply: this.playerMoves.length });

    // 1 手目を指した後：ワーカーに検証を依頼して受方応手を貰う
    if (this.playerMoves.length === 1) {
      this.worker.postMessage({
        type: 'validate-first-move',
        sfen: positionToSfen(this.initialPosition),
        move: moveToUsi(matched),
      });
    } else if (this.playerMoves.length === 3) {
      // 3 手指し切ったので詰みかを確認
      this.worker.postMessage({
        type: 'validate-final',
        sfen: positionToSfen(this.initialPosition),
        moves: this.playerMoves.map(moveToUsi),
      });
    }
  }

  _handleValidation(msg) {
    if (msg.kind === 'first-move') {
      if (msg.correct) {
        // 受方応手を自動再生
        const reply = usiToMove(msg.defenderReply, this.currentPosition);
        setTimeout(() => {
          doMove(this.currentPosition, reply);
          this.playerMoves.push(reply);
          this._emit('move-applied', { move: reply, ply: this.playerMoves.length });
        }, 400);   // アニメーション用の遅延
      } else {
        this._emit('wrong-move', { message: msg.reason });
        // 巻き戻し
        const last = this.playerMoves.pop();
        undoMove(this.currentPosition, this._undoInfo(last));
        this._emit('move-reverted');
      }
    } else if (msg.kind === 'final') {
      if (msg.correct) {
        this.state = 'SOLVED';
        this._emit('solved');
      } else {
        this._emit('wrong-move', { message: msg.reason });
        const last = this.playerMoves.pop();
        undoMove(this.currentPosition, this._undoInfo(last));
        this._emit('move-reverted');
      }
    }
  }

  getLegalMovesFrom(from) {
    return this._legalMovesCache().filter(m => m.drop == null && m.from === from);
  }

  getLegalDropTargets(t) {
    const set = new Set();
    for (const m of this._legalMovesCache()) {
      if (m.drop === t) set.add(m.to);
    }
    return set;
  }

  _legalMovesCache() {
    // 手番が変わっていなければキャッシュを流用したい所だが、
    // 3 手詰は手数が短いので都度生成でも十分速い
    return generateLegalMoves(this.currentPosition);
  }

  _movesEqual(a, b) {
    if (a.drop != null || b.drop != null) {
      return a.drop === b.drop && a.to === b.to;
    }
    return a.from === b.from && a.to === b.to && !!a.promote === !!b.promote;
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  reset() {
    this.currentPosition = this._clonePosition(this.initialPosition);
    this.playerMoves = [];
    this.state = 'PLAYING';
    this._emit('reset');
  }

  reveal() {
    this.state = 'REVEALED';
    this._emit('revealed', { solution: this.problem.solution });
  }
}
