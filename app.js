// app.js —— アプリの中核：状態機械・Worker 通信・プール・PWA
import { BoardView, HandView, InputController } from './board.js';
import { ProblemStore, ensurePersistentStorage } from './store.js';
import { sfenToPosition, usiToMove, moveToKanji } from './sfen.js';
import {
  generateLegalMoves, defenderAllMated, doMove, undoMove,
} from './engine.js';

// ============ ProblemController ============
export class ProblemController extends EventTarget {
  constructor(worker) {
    super();
    this.worker = worker;
    this.problem = null;
    this.initialPosition = null;
    this.currentPosition = null;
    this.solutionMoves = null;
    this.playerMoves = [];
    this.undoStack = [];
    this.state = 'IDLE'; // IDLE | LOADING | PLAYING | SOLVED | REVEALED
    this.awaitingReply = false;
    this.replyTimer = null;
    this.currentDbId = null;
    this.startTime = 0;
  }
  setLoading() { this.state = 'LOADING'; this._emit('state-change', {}); }
  loadProblem(problem) {
    this.problem = problem;
    const { position } = sfenToPosition(problem.sfen);
    this.initialPosition = position;
    this.currentPosition = position.clone();
    this.playerMoves = [];
    this.undoStack = [];
    this.awaitingReply = false;
    this.solutionMoves = this._parseSolution(problem.solution);
    this.state = 'PLAYING';
    this.startTime = Date.now();
    this._emit('problem-loaded', {});
  }
  _parseSolution(usiList) {
    const pos = this.initialPosition.clone();
    const moves = [];
    for (const usi of usiList) {
      const m = usiToMove(usi, pos);
      moves.push(m);
      doMove(pos, m);
    }
    return moves;
  }
  getLegalMovesFrom(from) {
    return generateLegalMoves(this.currentPosition).filter(m => m.drop == null && m.from === from);
  }
  getLegalDropTargets(t) {
    const s = new Set();
    for (const m of generateLegalMoves(this.currentPosition)) if (m.drop === t) s.add(m.to);
    return s;
  }
  movesEqual(a, b) {
    if (a.drop != null || b.drop != null) return a.drop === b.drop && a.to === b.to;
    return a.from === b.from && a.to === b.to && !!a.promote === !!b.promote;
  }
  applyPlayerMove(candidate) {
    if (this.state !== 'PLAYING' || this.awaitingReply) return;
    if (this.currentPosition.turn !== 1) return; // 攻方手番のみ
    const legal = generateLegalMoves(this.currentPosition);
    const matched = legal.find(m => this.movesEqual(m, candidate));
    if (!matched) return;
    const undoInfo = doMove(this.currentPosition, matched);
    this.undoStack.push({ move: matched, undoInfo, player: true });
    this.playerMoves.push(matched);
    this._emit('move-applied', { move: matched, player: true });
    if (this.playerMoves.length === 1) {
      // 初手検証：残り攻方1手で全応手を詰ませられるか
      if (defenderAllMated(this.currentPosition, 1)) {
        this._scheduleReply();
      } else {
        this._undoOne();
        this._emit('wrong-move', { message: 'その手では詰みません。' });
      }
    } else if (this.playerMoves.length === 3) {
      if (generateLegalMoves(this.currentPosition).length === 0) {
        this.state = 'SOLVED';
        this._emit('solved', { elapsedMs: Date.now() - this.startTime });
      } else {
        this._undoOne();
        this._emit('wrong-move', { message: 'まだ詰んでいません。' });
      }
    }
  }
  _scheduleReply() {
    this.awaitingReply = true;
    this._emit('waiting-reply', {});
    this.replyTimer = setTimeout(() => {
      this.awaitingReply = false;
      const reply = this._pickReply();
      if (!reply) return;
      const undoInfo = doMove(this.currentPosition, reply);
      this.undoStack.push({ move: reply, undoInfo, player: false });
      this.playerMoves.push(reply);
      this._emit('move-applied', { move: reply, player: false });
    }, 450);
  }
  _pickReply() {
    const legal = generateLegalMoves(this.currentPosition);
    if (legal.length === 0) return null;
    if (this.solutionMoves && this.solutionMoves.length > 1) {
      const m = legal.find(x => this.movesEqual(x, this.solutionMoves[1]));
      if (m) return m;
    }
    return legal[0];
  }
  _undoOne() {
    const e = this.undoStack.pop();
    if (!e) return;
    undoMove(this.currentPosition, e.undoInfo);
    this.playerMoves.pop();
    this._emit('move-reverted', {});
  }
  undo() {
    if (this.state !== 'PLAYING') return;
    if (this.awaitingReply) {
      clearTimeout(this.replyTimer);
      this.awaitingReply = false;
      this._undoOne();
      return;
    }
    while (this.undoStack.length > 0) {
      const wasPlayer = this.undoStack[this.undoStack.length - 1].player;
      this._undoOne();
      if (wasPlayer) break;
    }
  }
  reset() {
    if (this.awaitingReply) { clearTimeout(this.replyTimer); this.awaitingReply = false; }
    if (!this.initialPosition) return;
    this.currentPosition = this.initialPosition.clone();
    this.playerMoves = [];
    this.undoStack = [];
    this.state = 'PLAYING';
    this.startTime = Date.now();
    this._emit('reset', {});
  }
  reveal() {
    if (!this.problem) return;
    this.state = 'REVEALED';
    this._emit('revealed', { kanji: this.problem.kanji });
  }
  hint() {
    if (!this.solutionMoves || this.state !== 'PLAYING') return;
    const ply = this.playerMoves.length;
    if (ply >= this.solutionMoves.length) return;
    const mv = this.solutionMoves[ply];
    this._emit('hint', { move: mv, kanji: moveToKanji(mv, this.playerMoves[ply - 1] || null) });
  }
  getShareUrl() {
    if (!this.problem) return null;
    const base = location.href.split('?')[0];
    const u = new URL(base);
    if (this.problem.seed != null) {
      u.searchParams.set('seed', String(this.problem.seed));
      if (this.problem.difficulty && this.problem.difficulty.label)
        u.searchParams.set('label', this.problem.difficulty.label);
    } else {
      u.searchParams.set('sfen', this.problem.sfen);
    }
    u.searchParams.set('v', '1');
    return u.toString();
  }
  _emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail })); }
}

// ============ UI 配線 ============
const worker = new Worker('./worker.js', { type: 'module' });
const store = new ProblemStore();
const controller = new ProblemController(worker);

const boardView = new BoardView(document.getElementById('board'));
const handTop = new HandView(document.getElementById('hand-defender'), -1); // 受方（上）
const handBottom = new HandView(document.getElementById('hand-attacker'), 1); // 攻方（下）
const input = new InputController(boardView, handBottom, controller);

const statusEl = document.getElementById('status');
const badgeEl = document.getElementById('difficulty-badge');
const moveListEl = document.getElementById('move-list');
const progressEl = document.getElementById('progress');

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = 'status ' + cls;
}
function refreshViews() {
  boardView.setPosition(controller.currentPosition);
  handTop.setHand(controller.currentPosition.hands[1]);
  handBottom.setHand(controller.currentPosition.hands[0]);
}
function appendMoveEntry(move, player) {
  const ply = controller.playerMoves.length;
  const prev = controller.playerMoves[ply - 2] || null;
  const div = document.createElement('div');
  div.className = 'move-entry ' + (player ? 'player' : 'reply');
  div.textContent = `${ply}. ${player ? '▲' : '△'}${moveToKanji(move, prev)}`;
  moveListEl.appendChild(div);
  moveListEl.scrollTop = moveListEl.scrollHeight;
}

controller.addEventListener('problem-loaded', () => {
  const p = controller.problem;
  input.clear();
  boardView.lastMove = null;
  moveListEl.innerHTML = '';
  refreshViews();
  setStatus('先手番です。3手で詰ましてください。');
  const d = p.difficulty;
  badgeEl.textContent = `${d.label}（${d.score}）` + (d.tags.length ? ' ' + d.tags.map(t => '#' + t).join(' ') : '');
  badgeEl.className = 'difficulty-badge label-' + d.label;
  progressEl.textContent = '';
});
controller.addEventListener('move-applied', (e) => {
  refreshViews();
  boardView.highlight(e.detail.move);
  appendMoveEntry(e.detail.move, e.detail.player);
  if (e.detail.player) setStatus('…受方の応手');
  else setStatus('あなたの番です（詰めの手）。');
});
controller.addEventListener('wrong-move', (e) => {
  refreshViews();
  setStatus('❌ ' + e.detail.message, 'status-error');
});
controller.addEventListener('move-reverted', () => {
  refreshViews();
  const last = moveListEl.lastElementChild;
  if (last) last.remove();
});
controller.addEventListener('solved', async (e) => {
  refreshViews();
  setStatus(`🎉 詰みました！（${(e.detail.elapsedMs / 1000).toFixed(1)} 秒）`, 'status-success');
  if (controller.currentDbId != null) {
    try { await store.markSolved(controller.currentDbId); } catch { /* noop */ }
  }
});
controller.addEventListener('revealed', (e) => {
  setStatus('解答: ' + e.detail.kanji.join(' → '));
});
controller.addEventListener('hint', (e) => {
  setStatus('💡 ヒント: ' + e.detail.kanji, 'status-hint');
});
controller.addEventListener('reset', () => {
  input.clear();
  boardView.lastMove = null;
  moveListEl.innerHTML = '';
  refreshViews();
  setStatus('最初から。3手で詰ましてください。');
});

// ============ Worker 通信 & 問題プール ============
const POOL_TARGET = { '初級': 2, '中級': 2, '上級': 2, '有段': 2 };
const pool = { '初級': [], '中級': [], '上級': [], '有段': [] };
let pendingGenerate = false;
let waitingRequest = null;

const seedCounter = { n: 0 };
function newSeed() {
  seedCounter.n = (seedCounter.n + 1) & 0xff;
  return (((Date.now() & 0xffffff) << 8) | seedCounter.n) >>> 0;
}

function matchesRequest(req, problem) {
  if (!req) return true;
  if (req.targetLabel && problem.difficulty.label !== req.targetLabel) return false;
  if (req.requireTags) {
    const set = new Set(problem.difficulty.tagIds);
    for (const t of req.requireTags) if (!set.has(t)) return false;
  }
  return true;
}

async function deliverProblem(problem) {
  waitingRequest = null;
  controller.loadProblem(problem);
  try {
    await ensurePersistentStorage();
    controller.currentDbId = await store.save(problem);
  } catch { controller.currentDbId = null; }
}

function refillPools() {
  if (pendingGenerate) return;

  // waitingRequest があり、プール内にタグ条件を満たすものがない場合はリクエスト専用で生成
  if (waitingRequest) {
    const reqLabel = waitingRequest.targetLabel;
    const reqTags  = waitingRequest.requireTags || [];
    const poolArr  = reqLabel
      ? (pool[reqLabel] || [])
      : Object.values(pool).flat();
    const hasMatch = poolArr.some(p => matchesRequest(waitingRequest, p));
    if (!hasMatch) {
      pendingGenerate = true;
      worker.postMessage({
        type: 'generate',
        seed: newSeed(),
        opts: { targetLabel: reqLabel || '中級', budget: 4000, requireTags: reqTags },
      });
      return;
    }
  }

  // 通常のプール補充（タグ指定なし）
  let best = null, bestGap = 0;
  for (const [label, target] of Object.entries(POOL_TARGET)) {
    const gap = target - (pool[label] || []).length;
    if (gap > bestGap) { bestGap = gap; best = label; }
  }
  if (!best) return;
  pendingGenerate = true;
  worker.postMessage({
    type: 'generate',
    seed: newSeed(),
    opts: { targetLabel: best, budget: 4000 },
  });
}

function requestNewProblem(opts) {
  waitingRequest = opts;
  setStatus('問題を生成中…');
  controller.setLoading();
  // プールにタグ条件も含めてマッチするものがあれば即応
  const label = opts.targetLabel;
  if (label) {
    const arr = pool[label] || [];
    const idx = arr.findIndex(p => matchesRequest(opts, p));
    if (idx >= 0) { deliverProblem(arr.splice(idx, 1)[0]); }
  } else {
    outer: for (const k of Object.keys(pool)) {
      for (let i = 0; i < pool[k].length; i++) {
        if (matchesRequest(opts, pool[k][i])) {
          deliverProblem(pool[k].splice(i, 1)[0]);
          break outer;
        }
      }
    }
  }
  refillPools();
}

worker.addEventListener('message', async (e) => {
  const msg = e.data;
  if (msg.type === 'problem') {
    pendingGenerate = false;
    if (waitingRequest && matchesRequest(waitingRequest, msg.problem)) {
      await deliverProblem(msg.problem);
    } else {
      const l = msg.problem.difficulty.label;
      (pool[l] = pool[l] || []).push(msg.problem);
    }
    refillPools();
  } else if (msg.type === 'progress') {
    const s = msg.stats;
    progressEl.textContent = `生成中… ${s.tried.toLocaleString()} 局面試行（候補 ${s.candidate}）`;
  } else if (msg.type === 'error') {
    pendingGenerate = false;
    setStatus('⚠️ ' + msg.error, 'status-error');
  }
});

// ============ ボタン ============
function getSelectedTags() {
  return [...document.querySelectorAll('input[name="req"]:checked')].map(b => b.value);
}
document.getElementById('new-problem').addEventListener('click', () => {
  const difficulty = document.getElementById('difficulty').value || null;
  const requireTags = getSelectedTags();
  requestNewProblem({ targetLabel: difficulty, requireTags });
});
document.getElementById('undo').addEventListener('click', () => controller.undo());
document.getElementById('reset').addEventListener('click', () => controller.reset());
document.getElementById('reveal').addEventListener('click', () => controller.reveal());
document.getElementById('hint').addEventListener('click', () => controller.hint());
document.getElementById('daily').addEventListener('click', () => {
  const d = new Date();
  const seed = parseInt(
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`, 10);
  waitingRequest = { targetLabel: '中級' };
  setStatus('デイリー問題を生成中…');
  controller.setLoading();
  worker.postMessage({ type: 'generate', seed, opts: { targetLabel: '中級', budget: 8000 } });
});
document.getElementById('share').addEventListener('click', async () => {
  const url = controller.getShareUrl();
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    setStatus('📤 共有 URL をコピーしました。', 'status-success');
  } catch {
    window.prompt('URL をコピーしてください:', url);
  }
});

// ============ 起動時 URL パラメータ処理 ============
function parseUrlParams() {
  const p = new URLSearchParams(location.search);
  if (p.has('sfen')) return { type: 'sfen', sfen: p.get('sfen') };
  if (p.has('seed')) {
    const seed = parseInt(p.get('seed'), 10);
    if (Number.isFinite(seed)) return { type: 'seed', seed, label: p.get('label') || null };
  }
  return null;
}
function bootstrap() {
  const shared = parseUrlParams();
  if (shared && shared.type === 'sfen') {
    controller.setLoading();
    setStatus('共有局面を検証中…');
    worker.postMessage({ type: 'load-sfen', sfen: shared.sfen });
  } else if (shared && shared.type === 'seed') {
    waitingRequest = { targetLabel: shared.label };
    controller.setLoading();
    setStatus('共有問題を生成中…');
    worker.postMessage({ type: 'generate', seed: shared.seed, opts: { targetLabel: shared.label, budget: 8000 } });
  } else {
    requestNewProblem({ targetLabel: null });
  }
}

// 盤面のレスポンシブ対応
function resizeBoard() {
  const width = Math.min(504, window.innerWidth - 32);
  const cell = Math.max(30, Math.floor(width / 9));
  boardView.resize(cell);
}
window.addEventListener('resize', resizeBoard);
resizeBoard();

bootstrap();

// ============ PWA: Service Worker 登録 ============
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdatePrompt(newSW);
          }
        });
      });
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch (err) {
      console.error('SW registration failed:', err);
    }
  });
}
function showUpdatePrompt(newSW) {
  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.innerHTML = `<span>新しいバージョンがあります。</span>
    <button id="update-now">更新</button>
    <button id="update-later">後で</button>`;
  document.body.appendChild(banner);
  document.getElementById('update-now').onclick = () => newSW.postMessage({ type: 'skip-waiting' });
  document.getElementById('update-later').onclick = () => banner.remove();
}

// インストールプロンプト
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.createElement('button');
  btn.className = 'install-button';
  btn.textContent = '📱 アプリとしてインストール';
  btn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    btn.remove();
  });
  document.querySelector('.app-header').appendChild(btn);
});
// iOS への案内
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
if (isIOS && !window.navigator.standalone) {
  const hint = document.createElement('div');
  hint.className = 'ios-install-hint';
  hint.textContent = 'ホーム画面に追加するには：共有ボタン ⎘ →「ホーム画面に追加」';
  document.body.appendChild(hint);
}