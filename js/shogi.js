// ============================================================
// 3手詰生成コア
// ============================================================

export const EMPTY = 0;
export const PAWN = 1;
export const LANCE = 2;
export const KNIGHT = 3;
export const SILVER = 4;
export const GOLD = 5;
export const BISHOP = 6;
export const ROOK = 7;
export const KING = 8;

const PROMOTED = 8;

const SFEN_LETTERS = {
  1: "P",
  2: "L",
  3: "N",
  4: "S",
  5: "G",
  6: "B",
  7: "R",
  8: "K",
};

const TYPE_BY_CHAR = {
  P: PAWN,
  L: LANCE,
  N: KNIGHT,
  S: SILVER,
  G: GOLD,
  B: BISHOP,
  R: ROOK,
  K: KING,
};

const KANJI_FILES = ["９", "８", "７", "６", "５", "４", "３", "２", "１"];
const KANJI_RANKS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

const KANJI_PIECES = {
  1: "歩",
  2: "香",
  3: "桂",
  4: "銀",
  5: "金",
  6: "角",
  7: "飛",
  8: "玉",
  9: "と",
  10: "杏",
  11: "圭",
  12: "全",
  14: "馬",
  15: "龍",
};

const PIECE_LIMITS = [0, 9, 4, 4, 4, 4, 1, 1, 0];

const KING_STEPS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
];

const GOLD_STEPS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
            [0, 1],
];

const SILVER_STEPS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 1],           [1, 1],
];

const BISHOP_RAYS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

const ROOK_RAYS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

// ============================================================
// Position
// ============================================================

export class Position {
  constructor() {
    this.board = new Int8Array(81);
    this.hands = [new Int8Array(8), new Int8Array(8)]; // [先手, 後手]
    this.turn = 1; // 1=先手 / -1=後手
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

// ============================================================
// 座標・駒ユーティリティ
// ============================================================

export function sq(file, rank) {
  return file * 9 + rank;
}

export function fileOf(square) {
  return Math.floor(square / 9);
}

export function rankOf(square) {
  return square % 9;
}

function inBoard(file, rank) {
  return file >= 0 && file < 9 && rank >= 0 && rank < 9;
}

function sideOf(piece) {
  return piece > 0 ? 1 : -1;
}

export function rawType(piece) {
  const abs = Math.abs(piece);
  return abs >= 9 ? abs - PROMOTED : abs;
}

export function isPromoted(piece) {
  return Math.abs(piece) >= 9;
}

export function pieceToKanji(piece) {
  const abs = Math.abs(piece);
  return KANJI_PIECES[abs] || "";
}

function canPromoteZone(side, rank) {
  return side === 1 ? rank <= 2 : rank >= 6;
}

function mustPromote(raw, side, toRank) {
  if (raw === PAWN || raw === LANCE) {
    return side === 1 ? toRank === 0 : toRank === 8;
  }
  if (raw === KNIGHT) {
    return side === 1 ? toRank <= 1 : toRank >= 7;
  }
  return false;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function chebyshev(a, b) {
  return Math.max(
    Math.abs(fileOf(a) - fileOf(b)),
    Math.abs(rankOf(a) - rankOf(b))
  );
}

// ============================================================
// 駒の動き
// ============================================================

function getMovement(piece) {
  const raw = rawType(piece);
  const promoted = isPromoted(piece);

  const steps = [];
  const rays = [];

  if (raw === KING) {
    steps.push(...KING_STEPS);
    return { steps, rays };
  }

  if (promoted && raw !== BISHOP && raw !== ROOK) {
    steps.push(...GOLD_STEPS);
    return { steps, rays };
  }

  switch (raw) {
    case PAWN:
      steps.push([0, -1]);
      break;

    case KNIGHT:
      steps.push([-1, -2], [1, -2]);
      break;

    case SILVER:
      steps.push(...SILVER_STEPS);
      break;

    case GOLD:
      steps.push(...GOLD_STEPS);
      break;

    case BISHOP:
      rays.push(...BISHOP_RAYS);
      if (promoted) steps.push(...KING_STEPS);
      break;

    case ROOK:
      rays.push(...ROOK_RAYS);
      if (promoted) steps.push(...KING_STEPS);
      break;

    case LANCE:
      rays.push([0, -1]);
      break;
  }

  return { steps, rays };
}

// ============================================================
// 利き判定
// ============================================================

function attacks(board, from, to, piece) {
  const side = sideOf(piece);
  const f1 = fileOf(from);
  const r1 = rankOf(from);
  const f2 = fileOf(to);
  const r2 = rankOf(to);

  const { steps, rays } = getMovement(piece);

  for (const [df, drBase] of steps) {
    const dr = drBase * side;
    if (f1 + df === f2 && r1 + dr === r2) {
      return true;
    }
  }

  for (const [df, drBase] of rays) {
    const dr = drBase * side;
    const tf = f2 - f1;
    const tr = r2 - r1;

    if (df === 0) {
      if (tf !== 0) continue;
      if (Math.sign(tr) !== Math.sign(dr)) continue;
    } else if (dr === 0) {
      if (tr !== 0) continue;
      if (Math.sign(tf) !== Math.sign(df)) continue;
    } else {
      if (Math.abs(tf) !== Math.abs(tr)) continue;
      if (Math.sign(tf) !== Math.sign(df)) continue;
      if (Math.sign(tr) !== Math.sign(dr)) continue;
    }

    let f = f1 + df;
    let r = r1 + dr;

    while (f !== f2 || r !== r2) {
      if (!inBoard(f, r)) return false;
      if (board[sq(f, r)] !== EMPTY) return false;
      f += df;
      r += dr;
    }

    return true;
  }

  return false;
}

export function isSquareAttacked(board, target, attackerSide) {
  for (let s = 0; s < 81; s++) {
    const piece = board[s];
    if (piece === EMPTY) continue;
    if (sideOf(piece) !== attackerSide) continue;

    if (attacks(board, s, target, piece)) {
      return true;
    }
  }

  return false;
}

export function findKing(board, side) {
  const kingCode = side * KING;
  for (let s = 0; s < 81; s++) {
    if (board[s] === kingCode) return s;
  }
  return -1;
}

// ============================================================
// 着手
// ============================================================

export function doMove(pos, move) {
  const next = pos.clone();
  const side = pos.turn;
  const handIndex = side === 1 ? 0 : 1;

  if (move.drop != null) {
    const type = move.drop;
    if (next.hands[handIndex][type] <= 0) return next;

    next.hands[handIndex][type]--;
    next.board[move.to] = side * type;
  } else {
    const piece = next.board[move.from];
    if (piece === EMPTY) return next;

    const target = next.board[move.to];

    if (target !== EMPTY) {
      const raw = rawType(target);
      if (raw !== KING) {
        next.hands[handIndex][raw]++;
      }
    }

    let placed = piece;
    if (move.promote) {
      placed = side * (Math.abs(piece) + PROMOTED);
    }

    next.board[move.from] = EMPTY;
    next.board[move.to] = placed;
  }

  next.turn = -side;
  return next;
}

// ============================================================
// 擬似手生成
// ============================================================

function hasOwnPawnOnFile(board, file, side) {
  for (let rank = 0; rank < 9; rank++) {
    if (board[sq(file, rank)] === side * PAWN) return true;
  }
  return false;
}

function legalDropSquare(pos, type, to) {
  if (pos.board[to] !== EMPTY) return false;

  const side = pos.turn;
  const file = fileOf(to);
  const rank = rankOf(to);

  if (type === PAWN) {
    if (side === 1 && rank === 0) return false;
    if (side === -1 && rank === 8) return false;
    if (hasOwnPawnOnFile(pos.board, file, side)) return false;
  }

  if (type === LANCE) {
    if (side === 1 && rank === 0) return false;
    if (side === -1 && rank === 8) return false;
  }

  if (type === KNIGHT) {
    if (side === 1 && rank <= 1) return false;
    if (side === -1 && rank >= 7) return false;
  }

  return true;
}

function tryAddBoardMove(pos, moves, from, to, piece) {
  const target = pos.board[to];

  if (target !== EMPTY) {
    if (rawType(target) === KING) return;
    if (sideOf(target) === sideOf(piece)) return;
  }

  const raw = rawType(piece);
  const promoted = isPromoted(piece);
  const side = sideOf(piece);

  const fromRank = rankOf(from);
  const toRank = rankOf(to);

  const canPromote =
    !promoted &&
    raw !== GOLD &&
    raw !== KING &&
    (canPromoteZone(side, fromRank) || canPromoteZone(side, toRank));

  const must = !promoted && mustPromote(raw, side, toRank);

  if (must) {
    moves.push({
      from,
      to,
      drop: null,
      promote: true,
      piece,
    });
    return;
  }

  moves.push({
    from,
    to,
    drop: null,
    promote: false,
    piece,
  });

  if (canPromote) {
    moves.push({
      from,
      to,
      drop: null,
      promote: true,
      piece,
    });
  }
}

function generatePseudoMoves(pos) {
  const moves = [];
  const side = pos.turn;
  const handIndex = side === 1 ? 0 : 1;

  for (let from = 0; from < 81; from++) {
    const piece = pos.board[from];
    if (piece === EMPTY) continue;
    if (sideOf(piece) !== side) continue;

    const file = fileOf(from);
    const rank = rankOf(from);
    const { steps, rays } = getMovement(piece);

    for (const [df, drBase] of steps) {
      const dr = drBase * side;
      const nf = file + df;
      const nr = rank + dr;

      if (!inBoard(nf, nr)) continue;
      tryAddBoardMove(pos, moves, from, sq(nf, nr), piece);
    }

    for (const [df, drBase] of rays) {
      const dr = drBase * side;
      let nf = file + df;
      let nr = rank + dr;

      while (inBoard(nf, nr)) {
        const to = sq(nf, nr);
        const target = pos.board[to];

        if (target === EMPTY) {
          tryAddBoardMove(pos, moves, from, to, piece);
        } else {
          if (sideOf(target) !== side) {
            tryAddBoardMove(pos, moves, from, to, piece);
          }
          break;
        }

        nf += df;
        nr += dr;
      }
    }
  }

  for (let type = PAWN; type <= ROOK; type++) {
    if (pos.hands[handIndex][type] <= 0) continue;

    for (let to = 0; to < 81; to++) {
      if (!legalDropSquare(pos, type, to)) continue;

      moves.push({
        from: -1,
        to,
        drop: type,
        promote: false,
        piece: side * type,
      });
    }
  }

  return moves;
}

// ============================================================
// 合法手生成
// ============================================================

export function generateLegalMoves(pos, checkDropPawn = true) {
  const side = pos.turn;
  const pseudo = generatePseudoMoves(pos);
  const legal = [];

  for (const move of pseudo) {
    const next = doMove(pos, move);

    const king = findKing(next.board, side);
    if (king < 0) continue;

    if (isSquareAttacked(next.board, king, -side)) continue;

    if (checkDropPawn && move.drop === PAWN && isDropPawnMate(next, side)) {
      continue;
    }

    legal.push(move);
  }

  return legal;
}

function isDropPawnMate(nextPos, sideJustMoved) {
  const opponent = -sideJustMoved;
  const king = findKing(nextPos.board, opponent);

  if (king < 0) return false;
  if (!isSquareAttacked(nextPos.board, king, sideJustMoved)) return false;

  const replies = generateLegalMoves(nextPos, false);
  return replies.length === 0;
}

function givesCheck(pos, move) {
  const next = doMove(pos, move);
  const enemyKing = findKing(next.board, -pos.turn);

  if (enemyKing < 0) return false;

  return isSquareAttacked(next.board, enemyKing, pos.turn);
}

// ============================================================
// 3手詰探索
// ============================================================

export function attackerCanMate(pos, depth) {
  if (depth <= 0) return null;

  const moves = generateLegalMoves(pos);

  for (const move of moves) {
    if (!givesCheck(pos, move)) continue;

    const next = doMove(pos, move);
    if (defenderAllMated(next, depth - 1)) {
      return move;
    }
  }

  return null;
}

function defenderAllMated(pos, attackerDepth) {
  const replies = generateLegalMoves(pos);

  if (replies.length === 0) return true;

  for (const reply of replies) {
    const next = doMove(pos, reply);
    if (!attackerCanMate(next, attackerDepth)) {
      return false;
    }
  }

  return true;
}

export function isMateIn1(pos) {
  return attackerCanMate(pos, 1) != null;
}

export function uniqueFirstMove(pos) {
  let count = 0;
  let firstMove = null;

  const moves = generateLegalMoves(pos);

  for (const move of moves) {
    if (!givesCheck(pos, move)) continue;

    const next = doMove(pos, move);
    if (defenderAllMated(next, 1)) {
      count++;
      firstMove = move;

      if (count > 1) return null;
    }
  }

  return count === 1 ? firstMove : null;
}

export function extractSolution(pos, firstMove) {
  const line = [firstMove];

  let next = doMove(pos, firstMove);
  const replies = generateLegalMoves(next);

  if (replies.length === 0) {
    return line;
  }

  let replyMove = null;

  for (const reply of replies) {
    const afterReply = doMove(next, reply);
    if (attackerCanMate(afterReply, 1)) {
      replyMove = reply;
      break;
    }
  }

  if (!replyMove) return null;

  line.push(replyMove);

  const afterReply = doMove(next, replyMove);
  const finalMove = attackerCanMate(afterReply, 1);

  if (!finalMove) return null;

  line.push(finalMove);
  return line;
}

// ============================================================
// 局面合法性
// ============================================================

export function isLegalPosition(pos) {
  const blackKing = findKing(pos.board, 1);
  const whiteKing = findKing(pos.board, -1);

  if (blackKing < 0 || whiteKing < 0) return false;

  if (isSquareAttacked(pos.board, blackKing, -1)) return false;
  if (isSquareAttacked(pos.board, whiteKing, 1)) return false;

  return true;
}

// ============================================================
// SFEN
// ============================================================

function pieceToSfenToken(piece) {
  if (piece === EMPTY) return "";

  const raw = rawType(piece);
  const promoted = isPromoted(piece);

  let letter = SFEN_LETTERS[raw];
  if (!letter) return "";

  if (sideOf(piece) === -1) {
    letter = letter.toLowerCase();
  }

  return promoted ? `+${letter}` : letter;
}

export function positionToSfen(pos, moveNumber = 1) {
  const rows = [];

  for (let rank = 0; rank < 9; rank++) {
    let row = "";
    let emptyCount = 0;

    for (let file = 0; file < 9; file++) {
      const piece = pos.board[sq(file, rank)];

      if (piece === EMPTY) {
        emptyCount++;
        continue;
      }

      if (emptyCount > 0) {
        row += String(emptyCount);
        emptyCount = 0;
      }

      row += pieceToSfenToken(piece);
    }

    if (emptyCount > 0) {
      row += String(emptyCount);
    }

    rows.push(row);
  }

  const boardField = rows.join("/");
  const turnField = pos.turn === 1 ? "b" : "w";

  const handOrder = [ROOK, BISHOP, GOLD, SILVER, KNIGHT, LANCE, PAWN];
  let handField = "";

  for (const sideIndex of [0, 1]) {
    for (const type of handOrder) {
      const count = pos.hands[sideIndex][type];
      if (count <= 0) continue;

      const letter = SFEN_LETTERS[type];
      const handLetter = sideIndex === 0 ? letter : letter.toLowerCase();

      handField += `${count > 1 ? count : ""}${handLetter}`;
    }
  }

  if (!handField) handField = "-";

  return `${boardField} ${turnField} ${handField} ${moveNumber}`;
}

export function sfenToPosition(sfen) {
  const parts = sfen.trim().split(/\s+/);
  const pos = new Position();

  const rows = parts[0].split("/");

  for (let rank = 0; rank < 9; rank++) {
    const row = rows[rank];
    let file = 0;
    let i = 0;

    while (i < row.length && file < 9) {
      const ch = row[i];

      if (ch >= "1" && ch <= "9") {
        file += parseInt(ch, 10);
        i++;
        continue;
      }

      let promoted = false;
      let pieceChar = ch;

      if (ch === "+") {
        promoted = true;
        i++;
        pieceChar = row[i];
      }

      const upper = pieceChar.toUpperCase();
      const type = TYPE_BY_CHAR[upper];
      const side = pieceChar === upper ? 1 : -1;

      let piece = side * type;
      if (promoted) {
        piece = side * (type + PROMOTED);
      }

      pos.board[sq(file, rank)] = piece;
      file++;
      i++;
    }
  }

  pos.turn = parts[1] === "w" ? -1 : 1;

  if (parts.length >= 3 && parts[2] !== "-") {
    const hand = parts[2];
    let i = 0;

    while (i < hand.length) {
      let count = 1;

      if (hand[i] >= "0" && hand[i] <= "9") {
        let num = "";

        while (i < hand.length && hand[i] >= "0" && hand[i] <= "9") {
          num += hand[i];
          i++;
        }

        count = parseInt(num, 10);
      }

      if (i >= hand.length) break;

      const ch = hand[i];
      i++;

      const upper = ch.toUpperCase();
      const type = TYPE_BY_CHAR[upper];

      if (!type || type === KING) continue;

      const sideIndex = ch === upper ? 0 : 1;
      pos.hands[sideIndex][type] += count;
    }
  }

  return pos;
}

// ============================================================
// 指し手表記
// ============================================================

export function squareToUsi(square) {
  const file = fileOf(square);
  const rank = rankOf(square);

  const usiFile = 9 - file;
  const usiRank = String.fromCharCode("a".charCodeAt(0) + rank);

  return `${usiFile}${usiRank}`;
}

export function moveToUsi(move) {
  if (move.drop != null) {
    return `${SFEN_LETTERS[move.drop]}*${squareToUsi(move.to)}`;
  }

  return (
    squareToUsi(move.from) +
    squareToUsi(move.to) +
    (move.promote ? "+" : "")
  );
}

export function moveToKanji(move, prevMove = null) {
  const sameSquare = prevMove && prevMove.to === move.to;

  const squareText = sameSquare
    ? "同"
    : KANJI_FILES[fileOf(move.to)] + KANJI_RANKS[rankOf(move.to)];

  if (move.drop != null) {
    return `${squareText}${KANJI_PIECES[move.drop]}打`;
  }

  const absPiece = Math.abs(move.piece || 0);
  const pieceText = KANJI_PIECES[absPiece] || "";

  return `${squareText}${pieceText}${move.promote ? "成" : ""}`;
}

export function moveEquals(a, b) {
  if (a.drop != null || b.drop != null) {
    return a.drop === b.drop && a.to === b.to;
  }

  return a.from === b.from && a.to === b.to && !!a.promote === !!b.promote;
}

// ============================================================
// ランダム局面生成
// ============================================================

function mulberry32(seed) {
  let a = seed >>> 0;

  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, n) {
  return Math.floor(rng() * n);
}

function randRange(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pickOne(rng, array) {
  return array[randInt(rng, array.length)];
}

function countPieceType(pos, side, type) {
  const handIndex = side === 1 ? 0 : 1;
  let count = pos.hands[handIndex][type];

  for (let s = 0; s < 81; s++) {
    const piece = pos.board[s];
    if (piece === EMPTY) continue;
    if (sideOf(piece) !== side) continue;
    if (rawType(piece) !== type) continue;

    count++;
  }

  return count;
}

function addHandLimited(pos, side, type, desired) {
  const handIndex = side === 1 ? 0 : 1;
  const current = countPieceType(pos, side, type);
  const limit = PIECE_LIMITS[type] || 0;
  const canAdd = Math.max(0, limit - current);

  pos.hands[handIndex][type] += Math.min(desired, canAdd);
}

function placeNear(pos, rng, center, side, type, maxDistance) {
  if (countPieceType(pos, side, type) >= PIECE_LIMITS[type]) {
    return false;
  }

  const centerFile = fileOf(center);
  const centerRank = rankOf(center);

  for (let attempt = 0; attempt < 40; attempt++) {
    const file = clamp(
      centerFile + randRange(rng, -maxDistance, maxDistance),
      0,
      8
    );

    const rank = clamp(
      centerRank + randRange(rng, -maxDistance, maxDistance),
      0,
      8
    );

    const square = sq(file, rank);

    if (pos.board[square] !== EMPTY) continue;

    if (type === PAWN) {
      if (side === 1 && rank === 0) continue;
      if (side === -1 && rank === 8) continue;
      if (hasOwnPawnOnFile(pos.board, file, side)) continue;
    }

    if (type === LANCE) {
      if (side === 1 && rank === 0) continue;
      if (side === -1 && rank === 8) continue;
    }

    if (type === KNIGHT) {
      if (side === 1 && rank <= 1) continue;
      if (side === -1 && rank >= 7) continue;
    }

    pos.board[square] = side * type;

    const blackKing = findKing(pos.board, 1);
    const whiteKing = findKing(pos.board, -1);

    const blackInCheck =
      blackKing >= 0 && isSquareAttacked(pos.board, blackKing, -1);

    const whiteInCheck =
      whiteKing >= 0 && isSquareAttacked(pos.board, whiteKing, 1);

    if (blackInCheck || whiteInCheck) {
      pos.board[square] = EMPTY;
      continue;
    }

    return true;
  }

  return false;
}

function randomPosition(rng) {
  const pos = new Position();

  const kingCandidates = [
    sq(0, 0),
    sq(1, 0),
    sq(2, 0),
    sq(6, 0),
    sq(7, 0),
    sq(8, 0),
    sq(0, 1),
    sq(8, 1),
  ];

  const defenderKingSquare = pickOne(rng, kingCandidates);
  pos.board[defenderKingSquare] = -KING;

  let attackerKingSquare;

  do {
    attackerKingSquare = sq(randInt(rng, 9), randRange(rng, 6, 8));
  } while (
    attackerKingSquare === defenderKingSquare ||
    chebyshev(attackerKingSquare, defenderKingSquare) < 4
  );

  pos.board[attackerKingSquare] = KING;

  const attackerPieceTypes = [GOLD, GOLD, SILVER, SILVER];
  const attackerPieceCount = randRange(rng, 1, 2);

  for (let i = 0; i < attackerPieceCount; i++) {
    placeNear(
      pos,
      rng,
      defenderKingSquare,
      1,
      pickOne(rng, attackerPieceTypes),
      randRange(rng, 1, 3)
    );
  }

  if (rng() < 0.5) {
    placeNear(
      pos,
      rng,
      defenderKingSquare,
      -1,
      pickOne(rng, [GOLD, SILVER]),
      randRange(rng, 1, 2)
    );
  }

  addHandLimited(pos, 1, GOLD, randRange(rng, 1, 2));

  if (rng() < 0.65) {
    addHandLimited(pos, 1, SILVER, 1);
  }

  if (rng() < 0.35) {
    addHandLimited(pos, 1, GOLD, 1);
  }

  return pos;
}

// ============================================================
// 難易度簡易推定
// ============================================================

function estimateDifficulty(pos, solution) {
  let score = 10;

  const firstMove = solution[0];

  if (firstMove.drop != null) {
    score += 10;
  }

  const afterFirst = doMove(pos, firstMove);
  const replyCount = generateLegalMoves(afterFirst).length;

  score += Math.min(35, replyCount * 6);

  if (firstMove.promote) {
    score += 4;
  }

  score = Math.max(0, Math.min(100, score));

  let label = "初級";

  if (score >= 75) {
    label = "有段";
  } else if (score >= 55) {
    label = "上級";
  } else if (score >= 30) {
    label = "中級";
  }

  return {
    score,
    label,
    tags: [],
  };
}

// ============================================================
// 問題生成
// ============================================================

export function generateProblem(seed, options = {}) {
  const rng = mulberry32(seed);
  const budget = options.budget || 8000;

  for (let attempt = 0; attempt < budget; attempt++) {
    const pos = randomPosition(rng);

    if (!isLegalPosition(pos)) continue;

    if (isMateIn1(pos)) continue;

    const firstMove = uniqueFirstMove(pos);
    if (!firstMove) continue;

    const solution = extractSolution(pos, firstMove);
    if (!solution || solution.length < 3) continue;

    const difficulty = estimateDifficulty(pos, solution);

    return {
      sfen: positionToSfen(pos, 1),
      solution,
      kanji: solution.map((move, index) =>
        moveToKanji(move, solution[index - 1] || null)
      ),
      usi: solution.map((move) => moveToUsi(move)),
      difficulty,
      seed,
      attempts: attempt + 1,
    };
  }

  throw new Error("問題生成に失敗しました。もう一度お試しください。");
}