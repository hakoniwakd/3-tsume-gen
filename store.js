// store.js —— 問題プールの IndexedDB 永続化
const DB_NAME = 'shogi-problems';
const DB_VERSION = 2;
const STORE_NAME = 'problems';

export class ProblemStore {
  constructor() {
    this.dbPromise = this._openDB();
  }
  _openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.target.transaction;
        let store;
        if (db.objectStoreNames.contains(STORE_NAME)) {
          store = tx.objectStore(STORE_NAME);
        } else {
          store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('label', 'label', { unique: false });
          store.createIndex('solved', 'solved', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!store.indexNames.contains('tagIds')) {
          store.createIndex('tagIds', 'tagIds', { multiEntry: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }
  async save(problem) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record = {
        sfen: problem.sfen,
        solution: problem.solution,
        kanji: problem.kanji,
        label: problem.difficulty.label,
        score: problem.difficulty.score,
        tags: problem.difficulty.tags,
        tagIds: problem.difficulty.tagIds,
        seed: problem.seed,
        solved: false,
        createdAt: Date.now(),
      };
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async pickUnsolved(label = null) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      const found = [];
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const rec = cursor.value;
          if (!rec.solved && (!label || rec.label === label)) found.push(rec);
          cursor.continue();
        } else {
          resolve(found.length > 0 ? found[Math.floor(Math.random() * found.length)] : null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }
  async markSolved(id) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const rec = getReq.result;
        if (!rec) return resolve();
        rec.solved = true;
        rec.solvedAt = Date.now();
        const putReq = store.put(rec);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }
  async count(label = null) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = label
        ? store.index('label').count(IDBKeyRange.only(label))
        : store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}

// Persistent Storage の要求（初回保存時に呼ぶ）
export async function ensurePersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const persisted = await navigator.storage.persisted();
    if (!persisted) await navigator.storage.persist();
  }
}