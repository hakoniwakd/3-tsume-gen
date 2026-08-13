// sfen.js —— SFEN / USI / 日本語表記 の変換
import {
  PAWN, LANCE, KNIGHT, SILVER, GOLD, BISHOP, ROOK, KING, PROMOTED,
  rawType, isPromoted, sq, fileOf, rankOf, Position,
} from './engine.js';

const SFEN_CHAR = { 1:'P',2:'L',3:'N',4:'S',5:'G',6:'B',7:'R',8:'K' };
const TYPE_BY_CHAR = { P:1,L:2,N:3,S:4,G:5,B:6,R:7,K:8 };

function pieceToToken(piece) {
  if (piece === 0) return '';
  const side = piece > 0 ? 1 : -1;
  const abs = Math.abs(piece);
  let ch = SFEN_CHAR[rawType(abs)];
  if (side === -1) ch = ch.toLowerCase();
  return isPromoted(abs) ? '+' + ch : ch;
}
function tokenToPiece(token) {
  let i = 0, promoted = false;
  if (token[i] === '+') { promoted = true; i++; }
  const ch = token[i];
  const raw = TYPE_BY_CHAR[ch.toUpperCase()];
  const side = ch === ch.toUpperCase() ? 1 : -1;
  return side * (promoted ? raw + PROMOTED : raw);
}

export function positionToSfen(pos, moveNumber = 1) {
  const rows = [];
  for (let r = 0; r < 9; r++) {
    let row = '', empty = 0;
    for (let f = 0; f < 9; f++) {
      const p = pos.board[f * 9 + r];
      if (p === 0) { empty++; continue; }
      if (empty > 0) { row += String(empty); empty = 0; }
      row += pieceToToken(p);
    }
    if (empty > 0) row += String(empty);
    rows.push(row);
  }
  const boardField = rows.join('/');
  const turnField = pos.turn === 1 ? 'b' : 'w';
  const HAND_ORDER = [ROOK, BISHOP, GOLD, SILVER, KNIGHT, LANCE, PAWN];
  let handField = '';
  for (const sideIdx of [0, 1]) {
    const h = pos.hands[sideIdx];
    for (const t of HAND_ORDER) {
      const n = h[t];
      if (n <= 0) continue;
      const ch = sideIdx === 0 ? SFEN_CHAR[t] : SFEN_CHAR[t].toLowerCase();
      handField += (n > 1 ? String(n) : '') + ch;
    }
  }
  if (handField === '') handField = '-';
  return `${boardField} ${turnField} ${handField} ${moveNumber}`;
}

export function sfenToPosition(sfen) {
  const parts = sfen.trim().split(/\s+/);
  const [boardField, turnField, handField, moveField = '1'] = parts;
  const pos = new Position();
  const rows = boardField.split('/');
  if (rows.length !== 9) throw new Error('Invalid SFEN board');
  for (let r = 0; r < 9; r++) {
    const row = rows[r];
    let f = 0, i = 0;
    while (i < row.length) {
      const ch = row[i];
      if (ch >= '1' && ch <= '9') { f += parseInt(ch, 10); i++; }
      else {
        const len = ch === '+' ? 2 : 1;
        pos.board[sq(f, r)] = tokenToPiece(row.slice(i, i + len));
        f++; i += len;
      }
    }
  }
  pos.turn = turnField === 'b' ? 1 : -1;
  if (handField && handField !== '-') {
    let i = 0;
    while (i < handField.length) {
      let count = 1;
      if (handField[i] >= '1' && handField[i] <= '9') {
        let numStr = '';
        while (i < handField.length && handField[i] >= '0' && handField[i] <= '9') { numStr += handField[i]; i++; }
        count = parseInt(numStr, 10);
      }
      const ch = handField[i++];
      const raw = TYPE_BY_CHAR[ch.toUpperCase()];
      if (raw === KING) continue;
      const sideIdx = ch === ch.toUpperCase() ? 0 : 1;
      pos.hands[sideIdx][raw] += count;
    }
  }
  return { position: pos, moveNumber: parseInt(moveField, 10) || 1 };
}

export function isValidSfen(sfen) {
  try {
    const parts = String(sfen).trim().split(/\s+/);
    if (parts.length < 3) return false;
    if (parts[0].split('/').length !== 9) return false;
    if (!/^[bw]$/.test(parts[1])) return false;
    return true;
  } catch { return false; }
}

// ---- USI ----
export function squareToUsi(s) {
  const usiFile = 9 - fileOf(s);
  const usiRank = String.fromCharCode('a'.charCodeAt(0) + rankOf(s));
  return `${usiFile}${usiRank}`;
}
export function usiToSquare(str) {
  const usiFile = parseInt(str[0], 10);
  const usiRank = str.charCodeAt(1) - 'a'.charCodeAt(0);
  return sq(9 - usiFile, usiRank);
}
export function moveToUsi(move) {
  if (move.drop != null) return `${SFEN_CHAR[move.drop]}*${squareToUsi(move.to)}`;
  return squareToUsi(move.from) + squareToUsi(move.to) + (move.promote ? '+' : '');
}
export function usiToMove(usi, pos) {
  if (usi[1] === '*') {
    const raw = TYPE_BY_CHAR[usi[0]];
    return { from: -1, to: usiToSquare(usi.slice(2, 4)), drop: raw, piece: pos.turn * raw, promote: false };
  }
  const from = usiToSquare(usi.slice(0, 2));
  const to = usiToSquare(usi.slice(2, 4));
  const promote = usi.length === 5 && usi[4] === '+';
  return { from, to, drop: null, piece: pos.board[from], promote };
}

// ---- 日本語簡易表記 ----
const KANJI_FILE = ['９','８','７','６','５','４','３','２','１'];
const KANJI_RANK = ['一','二','三','四','五','六','七','八','九'];
const KANJI_RAW = {1:'歩',2:'香',3:'桂',4:'銀',5:'金',6:'角',7:'飛',8:'玉'};
const KANJI_PROMOTED = {1:'と',2:'杏',3:'圭',4:'全',6:'馬',7:'竜'};

export function moveToKanji(move, prevMove = null) {
  const same = prevMove && prevMove.to === move.to;
  const squareStr = same ? '同　' : KANJI_FILE[fileOf(move.to)] + KANJI_RANK[rankOf(move.to)];
  if (move.drop != null) return squareStr + KANJI_RAW[move.drop] + '打';
  const abs = Math.abs(move.piece);
  const raw = rawType(abs);
  const pieceStr = isPromoted(abs) ? (KANJI_PROMOTED[raw] || KANJI_RAW[raw]) : KANJI_RAW[raw];
  return squareStr + pieceStr + (move.promote ? '成' : '');
}