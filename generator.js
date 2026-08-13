// generator.js —— ランダム局面生成 + 3手詰生成 + 難易度推定 + タグ分類
import {
  Position, PAWN, LANCE, KNIGHT, SILVER, GOLD, BISHOP, ROOK, KING,
  sq, fileOf, rankOf, inBoard, findKing, isSquareAttacked, hasOwnPawnOnFile,
  isSanePosition, isMateIn1, countMatingFirstMoves, extractMateLine,
  generateChecks, generateLegalMoves, doMove, undoMove, chebyshev,
  rawType, isPromoted, attackerCanMate, defenderAllMated, isPawnDropMate,
  inPromotionZone, canDropHere, checkDropSquares,
} from './engine.js';
import { positionToSfen, moveToUsi, moveToKanji } from './sfen.js';

// ================= PRNG =================
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (rng, n) => Math.floor(rng() * n);
const randRange = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pickOne = (rng, arr) => arr[randInt(rng, arr.length)];
function pickWeighted(rng, items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// ================= ランダム局面生成 =================
// 受方玉を端寄りの上段に選ぶ
function pickDefenderKingSquare(rng) {
  const spots = [];
  for (let r = 0; r < 3; r++) {
    for (let f = 0; f < 9; f++) {
      const dEdge = Math.min(f, 8 - f);
      const w = (4 - Math.min(dEdge, 3)) + (2 - r); // 端寄り・上段ほど重い
      spots.push({ s: sq(f, r), w });
    }
  }
  const total = spots.reduce((a, b) => a + b.w, 0);
  let x = rng() * total;
  for (const it of spots) { x -= it.w; if (x <= 0) return it.s; }
  return spots[0].s;
}

function neighborsWithin(kingSq, radius) {
  const kf = fileOf(kingSq), kr = rankOf(kingSq), res = [];
  for (let df = -radius; df <= radius; df++) {
    for (let dr = -radius; dr <= radius; dr++) {
      if (df === 0 && dr === 0) continue;
      const nf = kf + df, nr = kr + dr;
      if (inBoard(nf, nr)) res.push(sq(nf, nr));
    }
  }
  return res;
}

function placeAttackerPieces(pos, rng, kingSq, count) {
  const kinds = [GOLD, SILVER, KNIGHT, LANCE, PAWN, BISHOP, ROOK];
  const weights = [5, 5, 3, 2, 3, 1, 1]; // 金銀中心・大駒は抑えめ（余詰防止）
  const near = neighborsWithin(kingSq, 1);
  const mid = neighborsWithin(kingSq, 3);
  for (let i = 0; i < count; i++) {
    const pool = (i === 0) ? near : mid;
    for (let tries = 0; tries < 30; tries++) {
      const s = pool[randInt(rng, pool.length)];
      if (pos.board[s] !== 0) continue;
      const kind = pickWeighted(rng, kinds, weights);
      if (kind === PAWN && rankOf(s) === 0) continue;
      if (kind === LANCE && rankOf(s) === 0) continue;
      if (kind === KNIGHT && rankOf(s) <= 1) continue;
      if (kind === PAWN && hasOwnPawnOnFile(pos.board, fileOf(s), 1)) continue;
      pos.board[s] = kind; // 先手（攻方）
      break;
    }
  }
}

function placeDefenderPieces(pos, rng, kingSq, count) {
  const kinds = [PAWN, SILVER, GOLD, KNIGHT, LANCE];
  const spots = neighborsWithin(kingSq, 3);
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 30; tries++) {
      const s = spots[randInt(rng, spots.length)];
      if (pos.board[s] !== 0) continue;
      const kind = kinds[randInt(rng, kinds.length)];
      if (kind === PAWN && rankOf(s) === 8) continue;
      if (kind === LANCE && rankOf(s) === 8) continue;
      if (kind === KNIGHT && rankOf(s) >= 7) continue;
      if (kind === PAWN && hasOwnPawnOnFile(pos.board, fileOf(s), -1)) continue;
      pos.board[s] = -kind; // 後手（受方）
      break;
    }
  }
}

function giveAttackerHand(pos, rng) {
  const n = randRange(rng, 1, 3);
  const kinds = [GOLD, SILVER, KNIGHT, LANCE, PAWN, ROOK, BISHOP];
  const weights = [4, 4, 3, 3, 4, 1, 1]; // 軽い駒優先
  for (let i = 0; i < n; i++) pos.hands[0][pickWeighted(rng, kinds, weights)]++;
}

export function randomPosition(rng) {
  const pos = new Position();
  const kingSq = pickDefenderKingSquare(rng);
  pos.board[kingSq] = -KING;
  // 攻方玉は受方玉から離れた下段へ
  let akSq;
  do { akSq = sq(randInt(rng, 9), randRange(rng, 6, 8)); }
  while (chebyshev(akSq, kingSq) < 4 || pos.board[akSq] !== 0);
  pos.board[akSq] = KING;
  placeAttackerPieces(pos, rng, kingSq, randRange(rng, 2, 3));
  placeDefenderPieces(pos, rng, kingSq, randRange(rng, 0, 2));
  giveAttackerHand(pos, rng);
  pos.turn = 1;
  return pos;
}

// ================= 品質チェック（不要駒） =================
// 攻方の駒を 1 枚除いてもまだ詰むなら、その駒は不要（冗長）
export function hasRedundantPiece(pos) {
  // 盤上の攻方駒（玉を除く）
  for (let i = 0; i < 81; i++) {
    const p = pos.board[i];
    if (p <= 0 || p === KING) continue;
    const clone = pos.clone();
    clone.board[i] = 0;
    if (attackerCanMate(clone, 2)) return true;
  }
  // 攻方持ち駒
  for (let t = PAWN; t <= ROOK; t++) {
    if (pos.hands[0][t] > 0) {
      const clone = pos.clone();
      clone.hands[0][t]--;
      if (attackerCanMate(clone, 2)) return true;
    }
  }
  return false;
}

// ================= 難易度特徴量 =================
function sumHand(hand) {
  let n = 0;
  for (let t = PAWN; t <= ROOK; t++) n += hand[t];
  return n;
}

function countKingMobility(pos, side) {
  const kingSq = findKing(pos.board, side);
  if (kingSq < 0) return 0;
  const kf = fileOf(kingSq), kr = rankOf(kingSq);
  let count = 0;
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const nf = kf + df, nr = kr + dr;
      if (!inBoard(nf, nr)) continue;
      const to = sq(nf, nr);
      const p = pos.board[to];
      if (p !== 0 && (p > 0 ? 1 : -1) === side) continue;
      if (!isSquareAttacked(pos.board, to, -side)) count++;
    }
  }
  return count;
}

function canHavePromoted(pos, move) {
  if (move.drop != null) return false;
  const abs = Math.abs(move.piece);
  const type = rawType(abs);
  if (type === GOLD || type === KING) return false;
  if (isPromoted(abs)) return false;
  const side = pos.turn;
  return inPromotionZone(side, rankOf(move.from)) || inPromotionZone(side, rankOf(move.to));
}

function firstMoveRequiresNoPromote(pos, m1) {
  if (m1.drop != null || m1.promote) return false;
  if (!canHavePromoted(pos, m1)) return false;
  const side = pos.turn;
  const alt = { ...m1, promote: true };
  const u = doMove(pos, alt);
  const myK = findKing(pos.board, side);
  const legal = !(myK >= 0 && isSquareAttacked(pos.board, myK, -side));
  let mated = false;
  if (legal) mated = defenderAllMated(pos, 1);
  undoMove(pos, u);
  return !mated; // 成ると詰まない → 不成必須
}

function involvesPawnDropIssue(pos, m1) {
  const side = pos.turn;
  const hand = pos.hands[side === 1 ? 0 : 1];
  if (hand[PAWN] <= 0) return false;
  const ekSq = findKing(pos.board, -side);
  if (ekSq < 0) return false;
  const nr = rankOf(ekSq) + (side === 1 ? 1 : -1);
  if (!inBoard(fileOf(ekSq), nr)) return false;
  const dropSq = sq(fileOf(ekSq), nr);
  if (pos.board[dropSq] !== 0) return false;
  if (hasOwnPawnOnFile(pos.board, fileOf(dropSq), side)) return false;
  const trial = { from: -1, to: dropSq, drop: PAWN, piece: side * PAWN, promote: false };
  const u = doMove(pos, trial);
  const result = isPawnDropMate(pos); // その歩打ちが打ち歩詰め（反則）になるか
  undoMove(pos, u);
  return result;
}

function isDropSquareUnique(pos, m1) {
  const t = m1.drop, side = pos.turn;
  const ekSq = findKing(pos.board, -side);
  let mateCount = 0;
  const seen = new Set();
  for (const to of checkDropSquares(pos.board, t, side, ekSq)) {
    if (seen.has(to)) continue; seen.add(to);
    if (pos.board[to] !== 0) continue;
    if (!canDropHere(side, t, rankOf(to))) continue;
    if (t === PAWN && hasOwnPawnOnFile(pos.board, fileOf(to), side)) continue;
    const trial = { from: -1, to, drop: t, piece: side * t, promote: false };
    const u = doMove(pos, trial);
    const myK = findKing(pos.board, side);
    const okSelf = !(myK >= 0 && isSquareAttacked(pos.board, myK, -side));
    let mated = false;
    if (okSelf) {
      if (t === PAWN && isPawnDropMate(pos)) { undoMove(pos, u); continue; }
      mated = defenderAllMated(pos, 1);
    }
    undoMove(pos, u);
    if (mated) { mateCount++; if (mateCount > 1) return false; }
  }
  return mateCount === 1;
}

function distanceFromDefenderKing(pos, to) {
  const ekSq = findKing(pos.board, -pos.turn);
  return Math.max(Math.abs(fileOf(to) - fileOf(ekSq)), Math.abs(rankOf(to) - rankOf(ekSq)));
}

function givesLineCheck(pos, m1) {
  const t = m1.drop != null ? m1.drop : rawType(Math.abs(pos.board[m1.from]));
  return t === ROOK || t === BISHOP || t === LANCE;
}

// 簡易版「捨駒」: 初手で動かした駒を受方応手が取れる場合
function isSacrifice(pos, m1) {
  const u1 = doMove(pos, m1);
  const replies = generateLegalMoves(pos);
  const captured = replies.some(r => r.drop == null && r.to === m1.to);
  undoMove(pos, u1);
  return captured;
}

export function extractFeatures(pos, line) {
  const [m1] = line;
  const f = {};
  f.firstIsDrop = m1.drop != null;
  f.firstIsCapture = m1.drop == null && pos.board[m1.to] !== 0;
  f.firstIsPromote = !!m1.promote;
  f.firstIsNoPromote = m1.drop == null && !m1.promote && canHavePromoted(pos, m1);
  f.numFirstMoveCandidates = generateChecks(pos).length;
  const u1 = doMove(pos, m1);
  f.numDefenderReplies = generateLegalMoves(pos).length;
  undoMove(pos, u1);
  f.initialKingMobility = countKingMobility(pos, -1);
  let att = 0, def = 0;
  for (let i = 0; i < 81; i++) {
    const p = pos.board[i];
    if (p === 0 || Math.abs(p) === KING) continue;
    if (p > 0) att++; else def++;
  }
  f.attackerPiecesOnBoard = att;
  f.defenderPiecesOnBoard = def;
  f.attackerHandTotal = sumHand(pos.hands[0]);
  f.defenderHandTotal = sumHand(pos.hands[1]);
  f.requiresNoPromote = firstMoveRequiresNoPromote(pos, m1);
  f.involvesPawnDropMateAvoidance = involvesPawnDropIssue(pos, m1);
  if (m1.drop != null) {
    f.dropDistance = distanceFromDefenderKing(pos, m1.to);
    f.dropSquareIsUnique = isDropSquareUnique(pos, m1);
  } else {
    f.dropDistance = 0;
    f.dropSquareIsUnique = false;
  }
  f.firstMoveGivesLineCheck = givesLineCheck(pos, m1);
  f.firstIsSacrifice = isSacrifice(pos, m1);
  return f;
}

export function computeScore(f) {
  let s = 10;
  if (f.numFirstMoveCandidates >= 12) s += 20;
  else if (f.numFirstMoveCandidates >= 8) s += 14;
  else if (f.numFirstMoveCandidates >= 5) s += 8;
  else if (f.numFirstMoveCandidates >= 3) s += 4;
  if (f.numDefenderReplies >= 6) s += 12;
  else if (f.numDefenderReplies >= 4) s += 8;
  else if (f.numDefenderReplies >= 2) s += 4;
  s += f.initialKingMobility * 2;
  if (f.firstIsDrop) {
    s += 6;
    if (f.dropDistance >= 3) s += 10;      // 遠打
    if (f.dropSquareIsUnique) s += 8;      // 限定打
  }
  if (f.firstIsCapture) s -= 4;
  if (f.firstIsNoPromote && f.requiresNoPromote) s += 18; // 不成必須
  if (f.firstIsPromote) s -= 2;
  if (f.firstMoveGivesLineCheck) s -= 3;
  if (f.involvesPawnDropMateAvoidance) s += 12;
  if (f.firstIsSacrifice) s += 15;
  const totalOnBoard = f.attackerPiecesOnBoard + f.defenderPiecesOnBoard;
  if (totalOnBoard <= 3) s += 6;
  else if (totalOnBoard >= 8) s -= 4;
  return Math.max(0, Math.min(100, s));
}

export const SPECIAL_TAGS = {
  unpromote:    { id: 'unpromote',    label: '不成' },
  pawn_drop:    { id: 'pawn_drop',    label: '打歩詰' },
  limited_drop: { id: 'limited_drop', label: '限定打' },
  distant_drop: { id: 'distant_drop', label: '遠打' },
  small_pieces: { id: 'small_pieces', label: '小駒問題' },
  no_hand:      { id: 'no_hand',      label: '持駒なし' },
  sacrifice:    { id: 'sacrifice',    label: '捨駒' },
};

export function classify(score, f) {
  const tags = [], tagIds = [];
  const add = (id) => { tagIds.push(id); tags.push(SPECIAL_TAGS[id].label); };
  if (f.firstIsNoPromote && f.requiresNoPromote) add('unpromote');
  if (f.involvesPawnDropMateAvoidance) add('pawn_drop');
  if (f.firstIsDrop && f.dropSquareIsUnique) add('limited_drop');
  if (f.firstIsDrop && f.dropDistance >= 3) add('distant_drop');
  if (f.attackerPiecesOnBoard + f.defenderPiecesOnBoard <= 3) add('small_pieces');
  if (f.attackerHandTotal === 0) add('no_hand');
  if (f.firstIsSacrifice) add('sacrifice');
  const label = score < 35 ? '初級' : score < 60 ? '中級' : score < 80 ? '上級' : '有段';
  return { label, tags, tagIds };
}

export function matchesTagRequirements(tagIds, requireTags = [], excludeTags = []) {
  const set = new Set(tagIds);
  for (const t of requireTags) if (!set.has(t)) return false;
  for (const t of excludeTags) if (set.has(t)) return false;
  return true;
}

// ================= 問題注釈・生成ループ =================
function annotateProblem(pos, line, meta) {
  const sfen = positionToSfen(pos, 1);
  const usi = line.map(moveToUsi);
  const kanji = [];
  let prev = null;
  for (const m of line) { kanji.push(moveToKanji(m, prev)); prev = m; }
  return {
    sfen,
    solution: usi,
    kanji,
    moveCount: line.length,
    difficulty: { label: meta.label, score: meta.score, tags: meta.tags, tagIds: meta.tagIds },
    seed: meta.seed,
    attempts: meta.attempts,
  };
}

// 任意の局面から「注釈付き問題」を作る（load-sfen でも再利用）
export function finalizeProblem(pos, seed, attempts) {
  const line = extractMateLine(pos);
  if (!line || line.length < 3) return null;
  const features = extractFeatures(pos, line);
  const score = computeScore(features);
  const { label, tags, tagIds } = classify(score, features);
  return annotateProblem(pos, line, { seed, attempts, label, score, tags, tagIds });
}

export function generateMateIn3(seed, opts = {}) {
  const {
    targetLabel = null,
    requireTags = [],
    excludeTags = [],
    budget = 4000,
    checkRedundancy = true,
    onProgress = null,
  } = opts;
  const rng = mulberry32(seed);
  const stats = { tried: 0, sane: 0, candidate: 0, passed: 0 };
  for (let i = 0; i < budget; i++) {
    stats.tried++;
    if (onProgress && (i % 200 === 0)) onProgress(stats);
    const pos = randomPosition(rng);
    if (!isSanePosition(pos)) continue;
    stats.sane++;
    if (isMateIn1(pos)) continue;                    // 早詰除外
    const { count } = countMatingFirstMoves(pos);
    if (count !== 1) continue;                       // 余詰 / 不詰除外（唯一解）
    stats.candidate++;
    if (checkRedundancy && hasRedundantPiece(pos)) continue; // 不要駒除外
    const problem = finalizeProblem(pos, seed, i + 1);
    if (!problem) continue;
    if (targetLabel && problem.difficulty.label !== targetLabel) continue;
    if (!matchesTagRequirements(problem.difficulty.tagIds, requireTags, excludeTags)) continue;
    stats.passed++;
    if (onProgress) onProgress(stats);
    return problem;
  }
  throw new Error('generation budget exhausted');
}