// Minimal IndexedDB wrapper for decks and their quiz progress. localStorage is too small
// once slide images are embedded in cards, so everything lives in IndexedDB instead.
const DB_NAME = 'synapsecards';
const DB_VERSION = 2;
const DECKS_STORE = 'decks';
const QUIZZES_STORE = 'quizzes';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DECKS_STORE)) {
        db.createObjectStore(DECKS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(QUIZZES_STORE)) {
        db.createObjectStore(QUIZZES_STORE, { keyPath: 'deckId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadDecks() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DECKS_STORE, 'readonly');
    const store = tx.objectStore(DECKS_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const decks = req.result || [];
      decks.sort((a, b) => b.createdAt - a.createdAt);
      resolve(decks);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function upsertDeck(deck) {
  await withStore(DECKS_STORE, 'readwrite', (store) => store.put(deck));
  return loadDecks();
}

export async function deleteDeck(id) {
  await withStore(DECKS_STORE, 'readwrite', (store) => store.delete(id));
  await withStore(QUIZZES_STORE, 'readwrite', (store) => store.delete(id));
  return loadDecks();
}

export async function loadQuizState(deckId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUIZZES_STORE, 'readonly');
    const req = tx.objectStore(QUIZZES_STORE).get(deckId);
    req.onsuccess = () => resolve(req.result?.state ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveQuizState(deckId, state) {
  await withStore(QUIZZES_STORE, 'readwrite', (store) =>
    store.put({ deckId, state, updatedAt: Date.now() })
  );
}
