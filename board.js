// board.js —— BoardView / HandView / InputController
import { fileOf, rankOf } from './engine.js';

const PIECE_LABEL = {
  1:'歩', 2:'香', 3:'桂', 4:'銀', 5:'金', 6:'角', 7:'飛', 8:'玉',
  9:'と', 10:'杏', 11:'圭', 12:'全', 14:'馬', 15:'竜',
};

export class BoardView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cellSize = 56;
    this.pos = null;
    this.selected = -1;
    this.targets = new Set();
    this.lastMove = null;
    this.onSquareClick = null;
    this._resizeCanvas();
    this._setupInput();
  }
  _resizeCanvas() {
    this.canvas.width = this.cellSize * 9;
    this.canvas.height = this.cellSize * 9;
  }
  resize(cellSize) {
    this.cellSize = cellSize;
    this._resizeCanvas();
    this.render();
  }
  setPosition(pos) { this.pos = pos; this.render(); }
  setSelection(selected, targets) {
    this.selected = selected;
    this.targets = new Set(targets || []);
    this.render();
  }
  highlight(move) { this.lastMove = move; this.render(); }
  clearSelection() { this.selected = -1; this.targets = new Set(); this.render(); }

  render() {
    const ctx = this.ctx, cs = this.cellSize, W = cs * 9;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#f0d9a6';
    ctx.fillRect(0, 0, W, W);
    // 格子
    ctx.strokeStyle = '#5a3a1a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 9; i++) {
      ctx.beginPath(); ctx.moveTo(i * cs + 0.5, 0); ctx.lineTo(i * cs + 0.5, W); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cs + 0.5); ctx.lineTo(W, i * cs + 0.5); ctx.stroke();
    }
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, W - 2);
    // 星
    ctx.fillStyle = '#5a3a1a';
    for (const [f, r] of [[3,3],[3,6],[6,3],[6,6]]) {
      ctx.beginPath(); ctx.arc(f * cs, r * cs, 3, 0, Math.PI * 2); ctx.fill();
    }
    // ハイライト
    if (this.lastMove && this.lastMove.to >= 0) this._fill(this.lastMove.to, 'rgba(255,170,0,0.45)');
    if (this.selected >= 0) this._fill(this.selected, 'rgba(80,160,255,0.5)');
    for (const t of this.targets) this._drawTarget(t);
    if (this.pos) this._drawPieces();
  }
  _fill(sqIdx, color) {
    const f = fileOf(sqIdx), r = rankOf(sqIdx);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(f * this.cellSize, r * this.cellSize, this.cellSize, this.cellSize);
  }
  _drawTarget(sqIdx) {
    const cs = this.cellSize;
    const f = fileOf(sqIdx), r = rankOf(sqIdx);
    const cx = f * cs + cs / 2, cy = r * cs + cs / 2;
    this.ctx.fillStyle = 'rgba(30,120,220,0.65)';
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, cs * 0.13, 0, Math.PI * 2);
    this.ctx.fill();
  }
  _drawPieces() {
    for (let sqIdx = 0; sqIdx < 81; sqIdx++) {
      const p = this.pos.board[sqIdx];
      if (p === 0) continue;
      this._drawPiece(sqIdx, p);
    }
  }
  _drawPiece(sqIdx, piece) {
    const ctx = this.ctx, cs = this.cellSize;
    const f = fileOf(sqIdx), r = rankOf(sqIdx);
    const cx = f * cs + cs / 2, cy = r * cs + cs / 2;
    const side = piece > 0 ? 1 : -1;
    const abs = Math.abs(piece);
    const label = PIECE_LABEL[abs];
    const promoted = abs > 8;
    ctx.save();
    ctx.translate(cx, cy);
    if (side === -1) ctx.rotate(Math.PI);
    const w = cs * 0.72, h = cs * 0.82;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(w / 2, -h / 2 + h * 0.28);
    ctx.lineTo(w / 2, h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.lineTo(-w / 2, -h / 2 + h * 0.28);
    ctx.closePath();
    ctx.fillStyle = '#f7e7c0';
    ctx.fill();
    ctx.strokeStyle = '#5a3a1a';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = promoted ? '#c0392b' : '#222';
    ctx.font = `${Math.floor(cs * 0.42)}px "Yu Mincho","Hiragino Mincho ProN",serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, cs * 0.06);
    ctx.restore();
  }
  _setupInput() {
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);
      const f = Math.floor(x / this.cellSize);
      const r = Math.floor(y / this.cellSize);
      if (f < 0 || f > 8 || r < 0 || r > 8) return;
      if (this.onSquareClick) this.onSquareClick(f * 9 + r);
    });
  }
}

export class HandView {
  constructor(container, side) {
    this.container = container;
    this.side = side;
    this.onPieceClick = null;
  }
  setHand(hand) {
    this.container.innerHTML = '';
    const ORDER = [7, 6, 5, 4, 3, 2, 1]; // 飛角金銀桂香歩
    const LABELS = { 1:'歩', 2:'香', 3:'桂', 4:'銀', 5:'金', 6:'角', 7:'飛' };
    let any = false;
    for (const t of ORDER) {
      const n = hand[t];
      if (n <= 0) continue;
      any = true;
      const el = document.createElement('span');
      el.className = 'hand-piece';
      el.textContent = n > 1 ? `${LABELS[t]}×${n}` : LABELS[t];
      el.addEventListener('click', () => { if (this.onPieceClick) this.onPieceClick(t); });
      this.container.appendChild(el);
    }
    if (!any) {
      const el = document.createElement('span');
      el.className = 'hand-empty';
      el.textContent = 'なし';
      this.container.appendChild(el);
    }
  }
}

export class InputController {
  constructor(boardView, handView, controller) {
    this.bv = boardView;
    this.hv = handView;
    this.c = controller;
    this.state = 'IDLE'; // IDLE | PIECE | HAND
    this.selFrom = -1;
    this.selHand = 0;
    boardView.onSquareClick = (sqIdx) => this.onSquare(sqIdx);
    handView.onPieceClick = (t) => this.onHand(t);
  }
  clear() {
    this.state = 'IDLE';
    this.selFrom = -1;
    this.selHand = 0;
    this.bv.clearSelection();
  }
  onSquare(sqIdx) {
    const pos = this.c.currentPosition;
    if (!pos || this.c.state !== 'PLAYING') return;
    if (this.state === 'IDLE') {
      const p = pos.board[sqIdx];
      if (p !== 0 && (p > 0 ? 1 : -1) === pos.turn) this.selectPiece(sqIdx);
    } else if (this.state === 'PIECE') {
      if (sqIdx === this.selFrom) { this.clear(); return; }
      const moves = this.c.getLegalMovesFrom(this.selFrom).filter(m => m.to === sqIdx);
      if (moves.length > 0) { this.commitMove(this.selFrom, sqIdx, moves); return; }
      const p = pos.board[sqIdx];
      if (p !== 0 && (p > 0 ? 1 : -1) === pos.turn) this.selectPiece(sqIdx);
      else this.clear();
    } else if (this.state === 'HAND') {
      const targets = this.c.getLegalDropTargets(this.selHand);
      if (targets.has(sqIdx)) {
        this.c.applyPlayerMove({ from: -1, to: sqIdx, drop: this.selHand, promote: false });
        this.clear();
      } else this.clear();
    }
  }
  selectPiece(sqIdx) {
    const moves = this.c.getLegalMovesFrom(sqIdx);
    this.state = 'PIECE';
    this.selFrom = sqIdx;
    this.bv.setSelection(sqIdx, moves.map(m => m.to));
  }
  onHand(t) {
    const pos = this.c.currentPosition;
    if (!pos || this.c.state !== 'PLAYING') return;
    if (pos.turn !== 1) return;              // 攻方のみ操作可
    if (pos.hands[0][t] <= 0) return;
    const targets = this.c.getLegalDropTargets(t);
    if (targets.size === 0) return;
    this.state = 'HAND';
    this.selHand = t;
    this.bv.setSelection(-1, [...targets]);
  }
  commitMove(from, to, moves) {
    let promote = moves[0].promote;
    if (moves.length === 2) {
      // 成・不成の両方が合法 → 確認（本格運用ではモーダルに差し替え推奨）
      promote = window.confirm('成りますか？（OK＝成る / キャンセル＝不成）');
    }
    this.c.applyPlayerMove({ from, to, drop: null, promote });
    this.clear();
  }
}