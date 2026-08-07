// board-view.js
export class BoardView {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cellSize = opts.cellSize || 60;
    this.padding = opts.padding || 0;
    this.pos = null;
    this.highlightSquares = new Set();   // マス番号（0..80）
    this.lastMove = null;                 // { from, to } で to をハイライト
    this.selectedSquare = -1;             // クリック中の駒
    this.moveTargets = new Set();         // 選択駒の移動可能先
    this.onSquareClick = null;
    this.onHandClick = null;

    // 座標系: 画面左上が (0,0)、file=0 (9筋) が画面左、rank=0 (1段目) が画面上
    // = SFEN の並びと自然に一致

    this._setupInput();
  }

  setPosition(pos) {
    this.pos = pos;
    this.render();
  }

  highlightMove(move) {
    this.lastMove = move;
    this.render();
  }

  select(sq, targets) {
    this.selectedSquare = sq;
    this.moveTargets = new Set(targets || []);
    this.render();
  }

  clearSelection() {
    this.selectedSquare = -1;
    this.moveTargets.clear();
    this.render();
  }

  render() {
    const ctx = this.ctx;
    const cs = this.cellSize;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 盤の背景
    ctx.fillStyle = '#f0d9a6';
    ctx.fillRect(0, 0, 9 * cs, 9 * cs);

    // マスの区切り線
    ctx.strokeStyle = '#5a3a1a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 9; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cs, 0);
      ctx.lineTo(i * cs, 9 * cs);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cs);
      ctx.lineTo(9 * cs, i * cs);
      ctx.stroke();
    }

    // 星（4隅の付近に打つ点）
    ctx.fillStyle = '#5a3a1a';
    for (const [f, r] of [[3, 3], [3, 6], [6, 3], [6, 6]]) {
      ctx.beginPath();
      ctx.arc(f * cs, r * cs, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 直前手のハイライト
    if (this.lastMove && this.lastMove.to != null) {
      this._fillSquare(this.lastMove.to, 'rgba(255,200,80,0.4)');
    }

    // 選択駒の移動可能先
    for (const to of this.moveTargets) {
      this._fillSquare(to, 'rgba(100,180,255,0.35)');
    }
    if (this.selectedSquare >= 0) {
      this._fillSquare(this.selectedSquare, 'rgba(100,180,255,0.6)');
    }

    // 駒
    if (this.pos) this._drawPieces();
  }

  _fillSquare(sq, color) {
    const f = (sq / 9) | 0, r = sq % 9;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(f * this.cellSize, r * this.cellSize,
                     this.cellSize, this.cellSize);
  }

  _drawPieces() {
    const cs = this.cellSize;
    for (let sq = 0; sq < 81; sq++) {
      const p = this.pos.board[sq];
      if (p === 0) continue;
      const f = (sq / 9) | 0, r = sq % 9;
      const cx = f * cs + cs / 2;
      const cy = r * cs + cs / 2;
      this._drawPiece(cx, cy, p);
    }
  }

  _drawPiece(cx, cy, piece) {
    const ctx = this.ctx;
    const side = piece > 0 ? 1 : -1;
    const abs = Math.abs(piece);
    const label = PIECE_LABEL[abs];
    const isPromoted = abs > 8 && abs !== 8;

    // 駒台形（五角形）を描画
    ctx.save();
    ctx.translate(cx, cy);
    if (side === -1) ctx.rotate(Math.PI);   // 後手は上下反転

    const w = this.cellSize * 0.85;
    const h = this.cellSize * 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(w / 2, -h / 4);
    ctx.lineTo(w / 2, h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.lineTo(-w / 2, -h / 4);
    ctx.closePath();
    ctx.fillStyle = '#f5deb3';
    ctx.fill();
    ctx.strokeStyle = '#5a3a1a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 文字
    ctx.fillStyle = isPromoted ? '#a00' : '#111';
    ctx.font = `${Math.floor(this.cellSize * 0.5)}px "游明朝", "Yu Mincho", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 2);

    ctx.restore();
  }

  _setupInput() {
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const f = Math.floor(x / this.cellSize);
      const r = Math.floor(y / this.cellSize);
      if (f < 0 || f >= 9 || r < 0 || r >= 9) return;
      const sq = f * 9 + r;
      if (this.onSquareClick) this.onSquareClick(sq);
    });
  }
}

const PIECE_LABEL = {
  1: '歩', 2: '香', 3: '桂', 4: '銀', 5: '金',
  6: '角', 7: '飛', 8: '玉',
  9: 'と', 10: '杏', 11: '圭', 12: '全',
  14: '馬', 15: '龍',
};
