// input-controller.js
export class InputController {
  constructor(boardView, handView, controller) {
    this.boardView = boardView;
    this.handView = handView;
    this.controller = controller;   // ProblemController

    this.state = 'IDLE';   // IDLE | PIECE_SELECTED | HAND_SELECTED
    this.selectedFrom = -1;
    this.selectedHandType = 0;

    boardView.onSquareClick = (sq) => this._onSquareClick(sq);
    handView.onPieceClick = (t) => this._onHandClick(t);
  }

  _onSquareClick(sq) {
    const pos = this.controller.currentPosition;

    if (this.state === 'IDLE') {
      // 自分の駒があれば選択、なければ無視
      const p = pos.board[sq];
      if (p === 0 || (p > 0 ? 1 : -1) !== pos.turn) return;
      this._selectPiece(sq);
    } else if (this.state === 'PIECE_SELECTED') {
      if (sq === this.selectedFrom) {
        this._clearSelection();
        return;
      }
      // 移動先候補に含まれていれば着手
      const targets = this._getMoveTargets(this.selectedFrom);
      const promoteVariants = targets.filter(t => t.to === sq);
      if (promoteVariants.length > 0) {
        this._commitBoardMove(this.selectedFrom, sq, promoteVariants);
      } else {
        // 別の自駒に選択切替
        const p = pos.board[sq];
        if (p !== 0 && (p > 0 ? 1 : -1) === pos.turn) {
          this._selectPiece(sq);
        } else {
          this._clearSelection();
        }
      }
    } else if (this.state === 'HAND_SELECTED') {
      // 打つ先マスをクリック
      const targets = this._getDropTargets(this.selectedHandType);
      if (targets.has(sq)) {
        this._commitDrop(this.selectedHandType, sq);
      } else {
        this._clearSelection();
      }
    }
  }

  _onHandClick(t) {
    const pos = this.controller.currentPosition;
    if (pos.turn !== 1) return;   // 攻方（先手）のみ操作可
    if (pos.hands[0][t] <= 0) return;

    this.state = 'HAND_SELECTED';
    this.selectedHandType = t;
    this.selectedFrom = -1;
    const targets = this._getDropTargets(t);
    this.boardView.select(-1, [...targets]);
  }

  _selectPiece(sq) {
    this.state = 'PIECE_SELECTED';
    this.selectedFrom = sq;
    this.selectedHandType = 0;
    const targets = this._getMoveTargets(sq);
    this.boardView.select(sq, targets.map(m => m.to));
  }

  _clearSelection() {
    this.state = 'IDLE';
    this.selectedFrom = -1;
    this.selectedHandType = 0;
    this.boardView.clearSelection();
  }

  _getMoveTargets(from) {
    // ProblemController に生成器の合法手を問い合わせる
    return this.controller.getLegalMovesFrom(from);
  }

  _getDropTargets(t) {
    return this.controller.getLegalDropTargets(t);
  }

  _commitBoardMove(from, to, variants) {
    // 成り／不成の両方が可能なら確認ダイアログ
    let promote = false;
    if (variants.length === 2) {
      promote = window.confirm('成りますか？');
    } else {
      promote = variants[0].promote;
    }
    this.controller.applyPlayerMove({ from, to, drop: null, promote });
    this._clearSelection();
  }

  _commitDrop(t, to) {
    this.controller.applyPlayerMove({ from: -1, to, drop: t, promote: false });
    this._clearSelection();
  }
}
