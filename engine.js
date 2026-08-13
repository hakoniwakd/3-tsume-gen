// engine.js —— 局面表現・合法手生成・王手生成・3手詰探索のコア

export const EMPTY = 0;
export const PAWN = 1, LANCE = 2, KNIGHT = 3, SILVER = 4,
             GOLD = 5, BISHOP = 6, ROOK = 7, KING = 8;
export const PROMOTED = 8; // 成駒は +8

// 先手視点のステップオフセット（dr の負 = 前）
export const SILVER_STEPS = [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1]];
export const GOLD_STEPS   = [[-1,-1],[1,-1],[-1,0],[1,0],[0,-1],[0,1]];
export const KING_STEPS   = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

// 座標: index = file*9 + rank。file0=9筋(左), file8=1筋(右)。rank0=1段目(上/後手玉側), rank8=9段目(下/先手玉側)
export const sq      = (f, r) => f * 9 + r;
export const fileOf  = (s) => (s / 9) | 0;
export const rankOf  = (s) => s % 9;
export const inBoard = (f, r) => f >= 0 && f < 9 && r >= 0 && r < 9;
export const rawType   = (abs) => abs >= 9 ? abs - 8 : abs;
export const isPromoted = (abs) => abs >= 9 && abs <= 15 && abs !== 13;
export const chebyshev = (a, b) =>
  Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));

export class Position {
  constructor() {
    this.board = new Int8Array(81);              // 正=先手(攻方), 負=後手(受方)
    this.hands = [new Int8Array(8), new Int8Array(8)]; // [先手, 後手], index 1..7
    this.turn  = 1;                              // 1=先手(攻方), -1=後手(受方)
  }
  clone() {
    const p = new Position();
    p.board.set(this.board);
    p.hands[0].set(this.hands[0]);
    p.hands[1].set(this.hands[1]);
    p.turn = this.turn;
    return p;
  }
}

export function inPromotionZone(side, rank) {
  return side === 1 ? rank <= 2 : rank >= 6;
}
export function mustPromote(side, type, toRank) {
  if (type === PAWN || type === LANCE) return side === 1 ? toRank === 0 : toRank === 8;
  if (type === KNIGHT) return side === 1 ? toRank <= 1 : toRank >= 7;
  return false;
}
export function canDropHere(side, type, toRank) {
  if (type === PAWN || type === LANCE) {
    if (side === 1 && toRank === 0) return false;
    if (side === -1 && toRank === 8) return false;
  }
  if (type === KNIGHT) {
    if (side === 1 && toRank <= 1) return false;
    if (side === -1 && toRank >= 7) return false;
  }
  return true;
}
export function hasOwnPawnOnFile(board, file, side) {
  for (let r = 0; r < 9; r++) if (board[file * 9 + r] === side * PAWN) return true;
  return false;
}
export function findKing(board, side) {
  const code = side * KING;
  for (let i = 0; i < 81; i++) if (board[i] === code) return i;
  return -1;
}

function stepMatch(steps, df, dr) {
  for (const [a, b] of steps) if (a === df && b === dr) return true;
  return false;
}

// side 側の駒(type/promoted)が from から to に利くか
export function attacks(board, from, to, type, promoted, side) {
  const f1 = fileOf(from), r1 = rankOf(from);
  const f2 = fileOf(to),   r2 = rankOf(to);
  const df = f2 - f1;
  const dr = (r2 - r1) * side; // side 視点で前=-1
  let eff = type;
  if (promoted && type !== BISHOP && type !== ROOK) eff = GOLD; // と・杏・圭・全は金
  switch (eff) {
    case PAWN:   return df === 0 && dr === -1;
    case KNIGHT: return (df === -1 || df === 1) && dr === -2;
    case SILVER: return stepMatch(SILVER_STEPS, df, dr);
    case GOLD:   return stepMatch(GOLD_STEPS, df, dr);
    case KING:   return Math.abs(df) <= 1 && Math.abs(dr) <= 1 && (df !== 0 || dr !== 0);
    case LANCE:
      if (df !== 0 || dr >= 0) return false;
      return rayClear(board, from, to);
    case BISHOP:
      if (Math.abs(df) !== Math.abs(dr) || df === 0) {
        if (promoted && (Math.abs(df) + Math.abs(dr) === 1)) return true; // 馬の縦横1歩
        return false;
      }
      return rayClear(board, from, to);
    case ROOK:
      if (df !== 0 && dr !== 0) {
        if (promoted && Math.abs(df) === 1 && Math.abs(dr) === 1) return true; // 竜の斜め1歩
        return false;
      }
      return rayClear(board, from, to);
  }
  return false;
}
function rayClear(board, from, to) {
  const f1 = fileOf(from), r1 = rankOf(from);
  const f2 = fileOf(to),   r2 = rankOf(to);
  const df = Math.sign(f2 - f1), dr = Math.sign(r2 - r1);
  let f = f1 + df, r = r1 + dr;
  while (f !== f2 || r !== r2) {
    if (board[f * 9 + r] !== 0) return false;
    f += df; r += dr;
  }
  return true;
}

// target が side 側の駒に利かれているか
export function isSquareAttacked(board, target, side) {
  for (let i = 0; i < 81; i++) {
    const p = board[i];
    if (p === 0 || (p > 0 ? 1 : -1) !== side) continue;
    const abs = Math.abs(p);
    if (attacks(board, i, target, rawType(abs), isPromoted(abs), side)) return true;
  }
  return false;
}

// 駒の移動先列挙（成り・ピンは考慮しない擬似的な到達点）
export function* pieceDestinations(board, from, type, promoted, side) {
  const f = fileOf(from), r = rankOf(from);
  let eff = type;
  if (promoted && type !== BISHOP && type !== ROOK) eff = GOLD;
  let steps = null;
  if (eff === PAWN) steps = [[0,-1]];
  else if (eff === KNIGHT) steps = [[-1,-2],[1,-2]];
  else if (eff === SILVER) steps = SILVER_STEPS;
  else if (eff === GOLD) steps = GOLD_STEPS;
  else if (eff === KING) steps = KING_STEPS;
  if (steps) {
    for (const [df, dr] of steps) {
      const nf = f + df, nr = r + dr * side;
      if (inBoard(nf, nr)) yield sq(nf, nr);
    }
  }
  const rays = [];
  if (eff === ROOK) rays.push([0,-1],[0,1],[-1,0],[1,0]);
  if (eff === BISHOP) rays.push([-1,-1],[1,-1],[-1,1],[1,1]);
  if (eff === LANCE) rays.push([0,-1]);
  for (const [df, drBase] of rays) {
    const dr = drBase * side;
    let nf = f + df, nr = r + dr;
    while (inBoard(nf, nr)) {
      const s = sq(nf, nr);
      yield s;
      if (board[s] !== 0) break;
      nf += df; nr += dr;
    }
  }
  if (promoted && type === BISHOP) {
    for (const [df, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nf = f + df, nr = r + dr;
      if (inBoard(nf, nr)) yield sq(nf, nr);
    }
  }
  if (promoted && type === ROOK) {
    for (const [df, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
      const nf = f + df, nr = r + dr;
      if (inBoard(nf, nr)) yield sq(nf, nr);
    }
  }
}

// ---- 着手 / 巻き戻し ----
export function doMove(pos, move) {
  const side = pos.turn;
  const handIdx = side === 1 ? 0 : 1;
  const undo = { move, side, captured: 0, wasPromoted: false };
  if (move.drop != null) {
    pos.hands[handIdx][move.drop]--;
    pos.board[move.to] = side * move.drop;
  } else {
    const moving = pos.board[move.from];
    const target = pos.board[move.to];
    if (target !== 0) {
      undo.captured = target;
      pos.hands[handIdx][rawType(Math.abs(target))]++;
    }
    let placed = moving;
    if (move.promote) {
      placed = side * (Math.abs(moving) + PROMOTED);
      undo.wasPromoted = true;
    }
    pos.board[move.from] = 0;
    pos.board[move.to] = placed;
  }
  pos.turn = -side;
  return undo;
}
export function undoMove(pos, undo) {
  const { move, side, captured, wasPromoted } = undo;
  const handIdx = side === 1 ? 0 : 1;
  pos.turn = side;
  if (move.drop != null) {
    pos.board[move.to] = 0;
    pos.hands[handIdx][move.drop]++;
  } else {
    const placed = pos.board[move.to];
    const original = wasPromoted ? side * (Math.abs(placed) - PROMOTED) : placed;
    pos.board[move.from] = original;
    pos.board[move.to] = captured;
    if (captured !== 0) pos.hands[handIdx][rawType(Math.abs(captured))]--;
  }
}

// 盤上駒の擬似手（打ちを除く）
export function generatePseudoMovesNoDrops(pos) {
  const side = pos.turn, board = pos.board, moves = [];
  for (let from = 0; from < 81; from++) {
    const p = board[from];
    if (p === 0 || (p > 0 ? 1 : -1) !== side) continue;
    const abs = Math.abs(p), type = rawType(abs), promoted = isPromoted(abs);
    for (const to of pieceDestinations(board, from, type, promoted, side)) {
      if (board[to] !== 0 && (board[to] > 0 ? 1 : -1) === side) continue;
      const canPromote = !promoted && type !== GOLD && type !== KING &&
        (inPromotionZone(side, rankOf(from)) || inPromotionZone(side, rankOf(to)));
      const must = mustPromote(side, type, rankOf(to));
      if (must) {
        moves.push({ from, to, drop: null, piece: p, promote: true });
      } else {
        moves.push({ from, to, drop: null, piece: p, promote: false });
        if (canPromote) moves.push({ from, to, drop: null, piece: p, promote: true });
      }
    }
  }
  return moves;
}

// 王手駒のリスト（kingSq を狙う敵駒）
export function findCheckers(board, kingSq, side) {
  const enemy = -side, res = [];
  for (let i = 0; i < 81; i++) {
    const p = board[i];
    if (p === 0 || (p > 0 ? 1 : -1) !== enemy) continue;
    const abs = Math.abs(p);
    if (attacks(board, i, kingSq, rawType(abs), isPromoted(abs), enemy)) res.push(i);
  }
  return res;
}

// a と b の間の升（両端含まず）。直線上にない場合は []
export function squaresBetween(a, b) {
  const f1 = fileOf(a), r1 = rankOf(a), f2 = fileOf(b), r2 = rankOf(b);
  const df = f2 - f1, dr = r2 - r1, res = [];
  if (df === 0 && dr === 0) return res;
  const aligned = (df === 0) || (dr === 0) || (Math.abs(df) === Math.abs(dr));
  if (!aligned) return res;
  const sf = Math.sign(df), sr = Math.sign(dr);
  let f = f1 + sf, r = r1 + sr;
  while (f !== f2 || r !== r2) { res.push(sq(f, r)); f += sf; r += sr; }
  return res;
}

// 王手されている側の「合駒候補マス」（線で1枚王手のときのみ。二歩/不成等は呼び出し側で判定）
function computeDropCandidates(pos, side, kingSq) {
  const board = pos.board;
  const checkers = findCheckers(board, kingSq, side);
  if (checkers.length === 0) {
    const res = [];
    for (let i = 0; i < 81; i++) if (board[i] === 0) res.push(i);
    return res;
  }
  if (checkers.length > 1) return []; // 両王手は合駒不可
  return squaresBetween(kingSq, checkers[0]);
}

// 持ち駒を打って王手になる升（敵玉から逆算）
export function* checkDropSquares(board, type, side, ekSq) {
  const kf = fileOf(ekSq), kr = rankOf(ekSq);
  if (type === PAWN) {
    const r = kr + (side === 1 ? 1 : -1);
    if (inBoard(kf, r)) yield sq(kf, r);
    return;
  }
  if (type === KNIGHT) {
    const dr = side === 1 ? 2 : -2;
    for (const df of [-1, 1]) { const nf = kf + df, nr = kr + dr; if (inBoard(nf, nr)) yield sq(nf, nr); }
    return;
  }
  if (type === SILVER) {
    for (const [df, dr] of SILVER_STEPS) { const nf = kf - df, nr = kr - dr * side; if (inBoard(nf, nr)) yield sq(nf, nr); }
    return;
  }
  if (type === GOLD) {
    for (const [df, dr] of GOLD_STEPS) { const nf = kf - df, nr = kr - dr * side; if (inBoard(nf, nr)) yield sq(nf, nr); }
    return;
  }
  if (type === LANCE) {
    const dir = side === 1 ? 1 : -1;
    let r = kr + dir;
    while (inBoard(kf, r)) { yield sq(kf, r); if (board[sq(kf, r)] !== 0) break; r += dir; }
    return;
  }
  if (type === BISHOP) {
    for (const [df, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
      let nf = kf + df, nr = kr + dr;
      while (inBoard(nf, nr)) { yield sq(nf, nr); if (board[sq(nf, nr)] !== 0) break; nf += df; nr += dr; }
    }
    return;
  }
  if (type === ROOK) {
    for (const [df, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      let nf = kf + df, nr = kr + dr;
      while (inBoard(nf, nr)) { yield sq(nf, nr); if (board[sq(nf, nr)] !== 0) break; nf += df; nr += dr; }
    }
    return;
  }
}

// その手を指したとき「自玉が安全」かつ「敵玉に王手」か（打ち歩詰めも除外）
function isCheckMove(pos, m) {
  const side = pos.turn;
  const undo = doMove(pos, m);
  let ok = true;
  const myK = findKing(pos.board, side);
  if (myK >= 0 && isSquareAttacked(pos.board, myK, -side)) ok = false;
  if (ok) {
    const ek = findKing(pos.board, -side);
    if (ek < 0 || !isSquareAttacked(pos.board, ek, side)) ok = false;
  }
  if (ok && m.drop === PAWN) { if (isPawnDropMate(pos)) ok = false; }
  undoMove(pos, undo);
  return ok;
}

// pos.turn 側が王手されているとき、逃れ手が皆無か（打ち歩詰め判定用・再帰なし）
export function isPawnDropMate(pos) {
  const side = pos.turn; // 王手されている側
  const kingSq = findKing(pos.board, side);
  if (kingSq < 0) return false;
  if (!isSquareAttacked(pos.board, kingSq, -side)) return false;
  const pseudo = generatePseudoMovesNoDrops(pos);
  const hand = pos.hands[side === 1 ? 0 : 1];
  const dropSq = computeDropCandidates(pos, side, kingSq);
  for (let t = PAWN; t <= ROOK; t++) {
    if (hand[t] <= 0) continue;
    for (const to of dropSq) {
      if (pos.board[to] !== 0) continue;
      if (!canDropHere(side, t, rankOf(to))) continue;
      if (t === PAWN && hasOwnPawnOnFile(pos.board, fileOf(to), side)) continue;
      pseudo.push({ from: -1, to, drop: t, piece: side * t, promote: false });
    }
  }
  for (const m of pseudo) {
    const undo = doMove(pos, m);
    const ks = findKing(pos.board, side);
    const safe = !(ks >= 0 && isSquareAttacked(pos.board, ks, -side));
    undoMove(pos, undo);
    if (safe) return false;
  }
  return true;
}

// 王手になる手の列挙（攻方用）
export function generateChecks(pos) {
  const side = pos.turn, board = pos.board;
  const ekSq = findKing(board, -side);
  const checks = [];
  if (ekSq < 0) return checks;
  for (const m of generatePseudoMovesNoDrops(pos)) if (isCheckMove(pos, m)) checks.push(m);
  const hand = pos.hands[side === 1 ? 0 : 1];
  for (let t = PAWN; t <= ROOK; t++) {
    if (hand[t] <= 0) continue;
    for (const to of checkDropSquares(board, t, side, ekSq)) {
      if (board[to] !== 0) continue;
      if (!canDropHere(side, t, rankOf(to))) continue;
      if (t === PAWN && hasOwnPawnOnFile(board, fileOf(to), side)) continue;
      const m = { from: -1, to, drop: t, piece: side * t, promote: false };
      if (isCheckMove(pos, m)) checks.push(m);
    }
  }
  return checks;
}

// 全合法手列挙（受方の応手・詰み判定用）
export function generateLegalMoves(pos) {
  const side = pos.turn, board = pos.board;
  const kingSq = findKing(board, side);
  const pseudo = generatePseudoMovesNoDrops(pos);
  const hand = pos.hands[side === 1 ? 0 : 1];
  const dropCandidates = computeDropCandidates(pos, side, kingSq);
  for (let t = PAWN; t <= ROOK; t++) {
    if (hand[t] <= 0) continue;
    for (const to of dropCandidates) {
      if (board[to] !== 0) continue;
      if (!canDropHere(side, t, rankOf(to))) continue;
      if (t === PAWN && hasOwnPawnOnFile(board, fileOf(to), side)) continue;
      pseudo.push({ from: -1, to, drop: t, piece: side * t, promote: false });
    }
  }
  const legal = [];
  for (const m of pseudo) {
    const undo = doMove(pos, m);
    const ks = findKing(pos.board, side);
    const inCheck = ks >= 0 && isSquareAttacked(pos.board, ks, -side);
    let ok = !inCheck;
    if (ok && m.drop === PAWN) { if (isPawnDropMate(pos)) ok = false; }
    undoMove(pos, undo);
    if (ok) legal.push(m);
  }
  return legal;
}

// ---- 詰探索 ----
// n = 攻方の残り指し手回数。3手詰は attackerCanMate(pos, 2)
export function attackerCanMate(pos, n) {
  if (n === 0) return null;
  for (const m of generateChecks(pos)) {
    const undo = doMove(pos, m);
    const mated = defenderAllMated(pos, n - 1);
    undoMove(pos, undo);
    if (mated) return m;
  }
  return null;
}
export function defenderAllMated(pos, n) {
  const replies = generateLegalMoves(pos);
  if (replies.length === 0) return true; // 詰み
  for (const r of replies) {
    const undo = doMove(pos, r);
    const win = attackerCanMate(pos, n);
    undoMove(pos, undo);
    if (!win) return false;
  }
  return true;
}
export function isMateIn1(pos) {
  for (const m of generateChecks(pos)) {
    const undo = doMove(pos, m);
    const replies = generateLegalMoves(pos);
    undoMove(pos, undo);
    if (replies.length === 0) return true;
  }
  return false;
}
export function countMatingFirstMoves(pos) {
  let count = 0, firstMove = null;
  for (const m of generateChecks(pos)) {
    const undo = doMove(pos, m);
    const mated = defenderAllMated(pos, 1);
    undoMove(pos, undo);
    if (mated) { count++; firstMove = m; if (count > 1) return { count, firstMove }; }
  }
  return { count, firstMove };
}
export function isMateIn3(pos) { return attackerCanMate(pos, 2) !== null; }

// 解手順 [攻1, 受, 攻2] を抽出
export function extractMateLine(pos) {
  const m1 = attackerCanMate(pos, 2);
  if (!m1) return null;
  const u1 = doMove(pos, m1);
  const replies = generateLegalMoves(pos);
  let reply = null, m3 = null;
  for (const r of replies) {
    const u2 = doMove(pos, r);
    const mm = attackerCanMate(pos, 1);
    undoMove(pos, u2);
    if (mm) { reply = r; m3 = mm; break; }
  }
  undoMove(pos, u1);
  if (!reply) return [m1];
  return [m1, reply, m3];
}

// 生成候補の最低限の正当性チェック
export function isSanePosition(pos) {
  const ak = findKing(pos.board, 1);
  const dk = findKing(pos.board, -1);
  if (ak < 0 || dk < 0) return false;
  if (chebyshev(ak, dk) <= 1) return false;
  if (isSquareAttacked(pos.board, ak, -1)) return false; // 攻方玉が王手（着手側なので不可）
  if (isSquareAttacked(pos.board, dk, 1)) return false;  // 受方玉が王手（初期局面では不正）
  return true;
}