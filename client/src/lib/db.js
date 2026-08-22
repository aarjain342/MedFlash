import { supabase, supabaseConfigured } from './supabaseClient';

// Decks and quiz progress sync to Supabase Postgres for signed-in users (RLS-scoped to
// their own rows), so they follow the account across devices. Guest mode (no Supabase
// configured, or no session) falls back to IndexedDB — localStorage is too small once
// slide images are embedded in cards.
const DB_NAME = 'synapsecards';
const DB_VERSION = 2;
const DECKS_STORE = 'decks';
const QUIZZES_STORE = 'quizzes';

async function getUserId() {
  if (!supabaseConfigured) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

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

// --- IndexedDB (guest mode) ---

async function loadDecksLocal() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DECKS_STORE, 'readonly');
    const req = tx.objectStore(DECKS_STORE).getAll();
    req.onsuccess = () => {
      const decks = req.result || [];
      decks.sort((a, b) => b.createdAt - a.createdAt);
      resolve(decks);
    };
    req.onerror = () => reject(req.error);
  });
}

async function upsertDeckLocal(deck) {
  await withStore(DECKS_STORE, 'readwrite', (store) => store.put(deck));
  return loadDecksLocal();
}

async function deleteDeckLocal(id) {
  await withStore(DECKS_STORE, 'readwrite', (store) => store.delete(id));
  await withStore(QUIZZES_STORE, 'readwrite', (store) => store.delete(id));
  return loadDecksLocal();
}

async function loadQuizStateLocal(deckId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUIZZES_STORE, 'readonly');
    const req = tx.objectStore(QUIZZES_STORE).get(deckId);
    req.onsuccess = () => resolve(req.result?.state ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function saveQuizStateLocal(deckId, state) {
  await withStore(QUIZZES_STORE, 'readwrite', (store) =>
    store.put({ deckId, state, updatedAt: Date.now() })
  );
}

// --- Supabase (signed-in) ---

function rowToDeck(row) {
  return { id: row.id, name: row.name, sourceFile: row.source_file, createdAt: row.created_at, cards: row.cards };
}

async function loadDecksRemote(userId) {
  const { data, error } = await supabase
    .from('decks')
    .select('id, name, source_file, created_at, cards')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(rowToDeck);
}

async function upsertDeckRemote(userId, deck) {
  const { error } = await supabase.from('decks').upsert({
    id: deck.id,
    user_id: userId,
    name: deck.name,
    source_file: deck.sourceFile,
    created_at: deck.createdAt,
    cards: deck.cards,
  });
  if (error) throw error;
  return loadDecksRemote(userId);
}

async function deleteDeckRemote(userId, id) {
  await supabase.from('quizzes').delete().eq('deck_id', id);
  const { error } = await supabase.from('decks').delete().eq('id', id);
  if (error) throw error;
  return loadDecksRemote(userId);
}

async function loadQuizStateRemote(deckId) {
  const { data, error } = await supabase.from('quizzes').select('state').eq('deck_id', deckId).maybeSingle();
  if (error) throw error;
  return data?.state ?? null;
}

async function saveQuizStateRemote(userId, deckId, state) {
  const { error } = await supabase.from('quizzes').upsert({ deck_id: deckId, user_id: userId, state });
  if (error) throw error;
}

// --- Public API: dispatches to remote or local depending on sign-in state ---

export async function loadDecks() {
  const userId = await getUserId();
  return userId ? loadDecksRemote(userId) : loadDecksLocal();
}

export async function upsertDeck(deck) {
  const userId = await getUserId();
  return userId ? upsertDeckRemote(userId, deck) : upsertDeckLocal(deck);
}

export async function deleteDeck(id) {
  const userId = await getUserId();
  return userId ? deleteDeckRemote(userId, id) : deleteDeckLocal(id);
}

export async function loadQuizState(deckId) {
  const userId = await getUserId();
  return userId ? loadQuizStateRemote(deckId) : loadQuizStateLocal(deckId);
}

export async function saveQuizState(deckId, state) {
  const userId = await getUserId();
  return userId ? saveQuizStateRemote(userId, deckId, state) : saveQuizStateLocal(deckId, state);
}
