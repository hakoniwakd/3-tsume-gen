// hand-view.js
export class HandView {
  constructor(container, side) {
    this.container = container;
    this.side = side;   // 1=先手, -1=後手
    this.onPieceClick = null;
  }

  setHand(hand) {
    this.container.innerHTML = '';
    const HAND_ORDER = [7, 6, 5, 4, 3, 2, 1];   // 飛角金銀桂香歩
    const LABELS = { 1: '歩', 2: '香', 3: '桂', 4: '銀', 5: '金', 6: '角', 7: '飛' };

    for (const t of HAND_ORDER) {
      const n = hand[t];
      if (n <= 0) continue;
      const el = document.createElement('button');
      el.className = 'hand-piece';
      el.textContent = n > 1 ? `${LABELS[t]}×${n}` : LABELS[t];
      el.dataset.pieceType = t;
      el.addEventListener('click', () => {
        if (this.onPieceClick) this.onPieceClick(t);
      });
      this.container.appendChild(el);
    }
    if (this.container.children.length === 0) {
      this.container.textContent = '持駒なし';
    }
  }
}
