import {
  sfenToPosition,
  doMove,
  pieceToKanji,
  isPromoted,
  moveToKanji,
} from "./shogi.js";

const worker = new Worker(new URL("./worker.js", import.meta.url), {
  type: "module",
});

const boardElement = document.getElementById("board");
const handTopElement = document.getElementById("hand-top");
const handBottomElement = document.getElementById("hand-bottom");
const statusElement = document.getElementById("status");
const difficultyElement = document.getElementById("difficulty");
const movesElement = document.getElementById("moves");

const newProblemButton = document.getElementById("new-problem");
const resetButton = document.getElementById("reset");
const revealButton = document.getElementById("reveal");
const installButton = document.getElementById("install-button");

let problem = null;
let position = null;
let solution = [];
let moveHistory = [];
let ply = 0;
let selected = null;
let autoReplyTimer = null;

let deferredInstallPrompt = null;

// ============================================================
// 描画
// ============================================================

function render() {
  renderBoard();
  renderHands();
  renderMoves();
}

function renderBoard() {
  boardElement.innerHTML = "";

  if (!position) return;

  for (let square = 0; square < 81; square++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.dataset.sq = String(square);

    const piece = position.board[square];

    if (piece !== 0) {
      cell.textContent = pieceToKanji(piece);
      cell.classList.add(piece > 0 ? "black" : "white");

      if (isPromoted(piece)) {
        cell.classList.add("promoted");
      }
    }

    if (selected && selected.type === "board" && selected.from === square) {
      cell.classList.add("selected");
    }

    cell.addEventListener("click", () => onSquareClick(square));
    boardElement.appendChild(cell);
  }
}

function renderHands() {
  renderHand(handTopElement, position ? position.hands[1] : null, false);
  renderHand(handBottomElement, position ? position.hands[0] : null, true);
}

function renderHand(element, hand, interactive) {
  element.innerHTML = "";

  if (!hand) return;

  const order = [7, 6, 5, 4, 3, 2, 1];
  const labels = {
    1: "歩",
    2: "香",
    3: "桂",
    4: "銀",
    5: "金",
    6: "角",
    7: "飛",
  };

  let hasPiece = false;

  for (const type of order) {
    const count = hand[type];
    if (count <= 0) continue;

    hasPiece = true;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = count > 1 ? `${labels[type]}×${count}` : labels[type];

    if (
      interactive &&
      selected &&
      selected.type === "hand" &&
      selected.drop === type
    ) {
      button.classList.add("selected");
    }

    if (interactive) {
      button.addEventListener("click", () => onHandClick(type));
    } else {
      button.disabled = true;
    }

    element.appendChild(button);
  }

  if (!hasPiece) {
    const empty = document.createElement("span");
    empty.className = "empty";
    empty.textContent = "持駒なし";
    element.appendChild(empty);
  }
}

function renderMoves() {
  movesElement.innerHTML = "";

  if (!moveHistory.length) {
    movesElement.textContent = "";
    return;
  }

  const lines = moveHistory.map((move, index) => {
    const prev = index > 0 ? moveHistory[index - 1] : null;
    return `${index + 1}. ${moveToKanji(move, prev)}`;
  });

  movesElement.textContent = lines.join(" / ");
}

// ============================================================
// 状態表示
// ============================================================

function setStatus(text, mode = "") {
  statusElement.textContent = text;
  statusElement.className = "status";

  if (mode) {
    statusElement.classList.add(mode);
  }
}

function updateDifficulty() {
  if (!problem || !problem.difficulty) {
    difficultyElement.textContent = "";
    return;
  }

  difficultyElement.textContent =
    `難易度: ${problem.difficulty.label} / スコア ${problem.difficulty.score}`;
}

// ============================================================
// 操作
// ============================================================

function isUserTurn() {
  return position && position.turn === 1 && (ply === 0 || ply === 2);
}

function expectedMove() {
  if (!solution.length) return null;
  if (ply >= solution.length) return null;
  return solution[ply];
}

function onSquareClick(square) {
  if (!isUserTurn()) return;

  const expected = expectedMove();
  if (!expected) return;

  if (selected && selected.type === "hand") {
    if (
      expected.drop != null &&
      selected.drop === expected.drop &&
      square === expected.to
    ) {
      applyExpectedMove();
    } else {
      selected = null;
      render();
    }
    return;
  }

  if (selected && selected.type === "board") {
    if (selected.from === square) {
      selected = null;
      render();
      return;
    }

    if (
      expected.drop == null &&
      selected.from === expected.from &&
      square === expected.to
    ) {
      applyExpectedMove();
      return;
    }

    const piece = position.board[square];
    if (piece > 0) {
      selected = { type: "board", from: square };
    } else {
      selected = null;
    }

    render();
    return;
  }

  const piece = position.board[square];
  if (piece > 0) {
    selected = { type: "board", from: square };
    render();
  }
}

function onHandClick(type) {
  if (!isUserTurn()) return;

  selected = { type: "hand", drop: type };
  render();
}

function applyExpectedMove() {
  const move = expectedMove();
  if (!move) return;

  position = doMove(position, move);
  moveHistory.push(move);
  selected = null;
  ply++;

  render();

  if (ply === 1) {
    setStatus("受方の応手…");

    autoReplyTimer = setTimeout(() => {
      playDefenderReply();
    }, 650);
  } else if (ply >= 3) {
    setStatus("🎉 正解です！ 3手詰です。", "success");
  } else {
    setStatus("最終手を指してください。");
  }
}

function playDefenderReply() {
  if (!problem || ply !== 1) return;

  const reply = solution[1];
  if (!reply) return;

  position = doMove(position, reply);
  moveHistory.push(reply);
  ply = 2;

  render();
  setStatus("最終手を指してください。");
}

// ============================================================
// 問題管理
// ============================================================

function newProblem() {
  clearTimeout(autoReplyTimer);

  problem = null;
  position = null;
  solution = [];
  moveHistory = [];
  ply = 0;
  selected = null;

  render();
  setStatus("問題を生成中…（数秒かかる場合があります）");
  difficultyElement.textContent = "";

  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;

  worker.postMessage({
    type: "generate",
    seed,
    options: {
      budget: 8000,
      workerRetries: 2,
    },
  });
}

function resetProblem() {
  if (!problem) return;

  clearTimeout(autoReplyTimer);

  position = sfenToPosition(problem.sfen);
  moveHistory = [];
  ply = 0;
  selected = null;

  render();
  setStatus("先手番です。3手で詰ませてください。");
}

function revealSolution() {
  if (!problem) return;

  clearTimeout(autoReplyTimer);

  position = sfenToPosition(problem.sfen);
  moveHistory = [];
  ply = 0;
  selected = null;

  for (const move of problem.solution) {
    position = doMove(position, move);
    moveHistory.push(move);
    ply++;
  }

  render();
  setStatus("解答を表示しました。", "success");
}

// ============================================================
// Worker 通信
// ============================================================

worker.addEventListener("message", (event) => {
  const message = event.data;

  if (message.type === "problem") {
    problem = message.problem;
    solution = message.problem.solution;
    position = sfenToPosition(message.problem.sfen);
    moveHistory = [];
    ply = 0;
    selected = null;

    render();
    updateDifficulty();
    setStatus("先手番です。3手で詰ませてください。");
  } else if (message.type === "error") {
    setStatus(`エラー: ${message.error}`, "error");
  }
});

worker.addEventListener("error", (event) => {
  setStatus(`Workerエラー: ${event.message || "unknown error"}`, "error");
});

// ============================================================
// ボタン
// ============================================================

newProblemButton.addEventListener("click", () => {
  newProblem();
});

resetButton.addEventListener("click", () => {
  resetProblem();
});

revealButton.addEventListener("click", () => {
  revealSolution();
});

// ============================================================
// PWA インストール
// ============================================================

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;

  installButton.style.display = "inline-block";
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;

  deferredInstallPrompt = null;
  installButton.style.display = "none";
});

window.addEventListener("appinstalled", () => {
  installButton.style.display = "none";
});

// ============================================================
// Service Worker 登録
// ============================================================

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    } catch (error) {
      console.error("Service Worker registration failed:", error);
    }
  });
}

// ============================================================
// 初期化
// ============================================================

newProblem();