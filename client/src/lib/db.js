import { supabase, supabaseConfigured } from './supabaseClient';

// Decks and quiz progress sync to Supabase Postgres for signed-in users (RLS-scoped to
// their own rows), so they follow the account across devices. Guest mode (no Supabase
// configured, or no session) falls back to IndexedDB — localStorage is too small once
// slide images are embedded in cards.
const DB_NAME = 'synapsecards';
const DB_VERSION = 3;
const DECKS_STORE = 'decks';
const QUIZZES_STORE = 'quizzes';
const ANATOMY_DECKS_STORE = 'anatomyDecks';
const ANATOMY_PROGRESS_STORE = 'anatomyProgress';

async function getUserId() {
  if (!supabaseConfigured) return null;
  // getSession() reads the already-cached local session (the SDK keeps it refreshed in
  // the background) instead of getUser(), which hits Supabase's auth server over the
  // network on every call — this runs before every deck/quiz operation, so that extra
  // round-trip was adding real, visible lag to what should feel instant.
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
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
      if (!db.objectStoreNames.contains(ANATOMY_DECKS_STORE)) {
        db.createObjectStore(ANATOMY_DECKS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ANATOMY_PROGRESS_STORE)) {
        db.createObjectStore(ANATOMY_PROGRESS_STORE, { keyPath: 'deckId' });
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
  return deck;
}

async function deleteDeckLocal(id) {
  await withStore(DECKS_STORE, 'readwrite', (store) => store.delete(id));
  await withStore(QUIZZES_STORE, 'readwrite', (store) => store.delete(id));
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

async function loadAllQuizStatesLocal() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUIZZES_STORE, 'readonly');
    const req = tx.objectStore(QUIZZES_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).map((r) => r.state));
    req.onerror = () => reject(req.error);
  });
}

// --- IndexedDB (guest mode) — Anatomy Quiz ---

async function loadAnatomyDecksLocal() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ANATOMY_DECKS_STORE, 'readonly');
    const req = tx.objectStore(ANATOMY_DECKS_STORE).getAll();
    req.onsuccess = () => {
      const decks = req.result || [];
      decks.sort((a, b) => b.createdAt - a.createdAt);
      resolve(decks);
    };
    req.onerror = () => reject(req.error);
  });
}

async function upsertAnatomyDeckLocal(deck) {
  await withStore(ANATOMY_DECKS_STORE, 'readwrite', (store) => store.put(deck));
  return deck;
}

async function deleteAnatomyDeckLocal(id) {
  await withStore(ANATOMY_DECKS_STORE, 'readwrite', (store) => store.delete(id));
  await withStore(ANATOMY_PROGRESS_STORE, 'readwrite', (store) => store.delete(id));
}

async function loadAnatomyProgressLocal(deckId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ANATOMY_PROGRESS_STORE, 'readonly');
    const req = tx.objectStore(ANATOMY_PROGRESS_STORE).get(deckId);
    req.onsuccess = () => resolve(req.result?.state ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function saveAnatomyProgressLocal(deckId, state) {
  await withStore(ANATOMY_PROGRESS_STORE, 'readwrite', (store) =>
    store.put({ deckId, state, updatedAt: Date.now() })
  );
}

// --- Supabase (signed-in) ---

function rowToDeck(row) {
  return { id: row.id, name: row.name, sourceFile: row.source_file, createdAt: row.created_at, cards: row.cards };
}

// Postgres error code 57014 = statement timeout. A large/slow-to-write deck can trip this
// transiently (e.g. under momentary DB load) even when the payload itself is reasonable,
// so one retry after a short pause is worth it before giving up.
function isRetryableSaveError(error) {
  return error?.code === '57014' || /statement timeout/i.test(error?.message || '');
}

// Fast path for the initial list paint: no `cards` column at all, so this stays tiny (a
// few KB) and quick regardless of how much card/image data the account has accumulated.
// `cards: null` is a sentinel the UI reads as "still loading detail" rather than "empty" —
// loadDecksRemote() below fills it in shortly after, in the background.
async function loadDecksMetaRemote(userId) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from('decks')
      .select('id, name, source_file, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (!error) return data.map((row) => ({ ...rowToDeck(row), cards: null }));
    lastError = error;
    if (!isRetryableSaveError(error)) throw error;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastError;
}

// This SELECT pulls the full cards column (including every embedded slide image) for
// EVERY deck the user owns — for an account with several large decks that's tens of MB.
// It used to be the ONLY way decks were loaded, which made the whole app feel like it
// hung on every sign-in and was genuinely prone to timing out. Now it only runs in the
// background after loadDecksMetaRemote() has already gotten the list on screen — see
// fetchDecks() in Dashboard.jsx. The real fix is not needing this at all for the list
// view (only for actually studying/quizzing/exporting a deck) — tracked in HANDOFF.md,
// needs a schema change (e.g. a server-side card-count function) to do properly.
async function loadDecksRemote(userId) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from('decks')
      .select('id, name, source_file, created_at, cards')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (!error) return data.map(rowToDeck);
    lastError = error;
    if (!isRetryableSaveError(error)) throw error;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastError;
}

async function upsertDeckRemote(userId, deck) {
  const row = {
    id: deck.id,
    user_id: userId,
    name: deck.name,
    source_file: deck.sourceFile,
    created_at: deck.createdAt,
    cards: deck.cards,
  };

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.from('decks').upsert(row);
    // Deliberately not reloading the full deck list here: that used to re-SELECT every
    // deck's cards (including images) just to hand back an updated array, so saving one
    // small deck could still fail if ANY other deck in the account was large enough to make
    // that reload trip the statement timeout. The caller already has the deck it just
    // saved — no need to round-trip for it.
    if (!error) return deck;
    lastError = error;
    if (!isRetryableSaveError(error)) throw error;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastError;
}

async function deleteDeckRemote(userId, id) {
  await supabase.from('quizzes').delete().eq('deck_id', id);
  const { error } = await supabase.from('decks').delete().eq('id', id);
  if (error) throw error;
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

async function loadAllQuizStatesRemote(userId) {
  const { data, error } = await supabase.from('quizzes').select('state').eq('user_id', userId);
  if (error) throw error;
  return data.map((r) => r.state);
}

// --- Supabase (signed-in) — Anatomy Quiz ---

function rowToAnatomyDeck(row) {
  return { id: row.id, name: row.name, sourceFile: row.source_file, createdAt: row.created_at, pages: row.pages };
}

// Same fast-path-then-fill-in shape as loadDecksMetaRemote/loadDecksRemote — a deck's
// `pages` column carries the same kind of embedded slide images decks.cards does, so an
// anatomy deck list should never block on it either. `pages: null` is the "still loading
// detail" sentinel, matching decks' `cards: null`.
async function loadAnatomyDecksMetaRemote(userId) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from('anatomy_decks')
      .select('id, name, source_file, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (!error) return data.map((row) => ({ ...rowToAnatomyDeck(row), pages: null }));
    lastError = error;
    if (!isRetryableSaveError(error)) throw error;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastError;
}

async function loadAnatomyDecksRemote(userId) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from('anatomy_decks')
      .select('id, name, source_file, created_at, pages')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (!error) return data.map(rowToAnatomyDeck);
    lastError = error;
    if (!isRetryableSaveError(error)) throw error;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastError;
}

async function upsertAnatomyDeckRemote(userId, deck) {
  const row = {
    id: deck.id,
    user_id: userId,
    name: deck.name,
    source_file: deck.sourceFile,
    created_at: deck.createdAt,
    pages: deck.pages,
  };

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.from('anatomy_decks').upsert(row);
    if (!error) return deck;
    lastError = error;
    if (!isRetryableSaveError(error)) throw error;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastError;
}

async function deleteAnatomyDeckRemote(userId, id) {
  await supabase.from('anatomy_progress').delete().eq('deck_id', id);
  const { error } = await supabase.from('anatomy_decks').delete().eq('id', id);
  if (error) throw error;
}

async function loadAnatomyProgressRemote(deckId) {
  const { data, error } = await supabase.from('anatomy_progress').select('state').eq('deck_id', deckId).maybeSingle();
  if (error) throw error;
  return data?.state ?? null;
}

async function saveAnatomyProgressRemote(userId, deckId, state) {
  const { error } = await supabase.from('anatomy_progress').upsert({ deck_id: deckId, user_id: userId, state });
  if (error) throw error;
}

// --- Public API: dispatches to remote or local depending on sign-in state ---

// Guest mode (IndexedDB) is already fast/local, so it has no separate lightweight path —
// this and loadDecks() both just read straight from IndexedDB there.
export async function loadDecksMeta() {
  const userId = await getUserId();
  return userId ? loadDecksMetaRemote(userId) : loadDecksLocal();
}

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

// Every quiz state the user has, across all their decks — used by the app-wide Stats page.
export async function loadAllQuizStates() {
  const userId = await getUserId();
  return userId ? loadAllQuizStatesRemote(userId) : loadAllQuizStatesLocal();
}

// --- Public API — Anatomy Quiz ---

export async function loadAnatomyDecksMeta() {
  const userId = await getUserId();
  return userId ? loadAnatomyDecksMetaRemote(userId) : loadAnatomyDecksLocal();
}

export async function loadAnatomyDecks() {
  const userId = await getUserId();
  return userId ? loadAnatomyDecksRemote(userId) : loadAnatomyDecksLocal();
}

export async function upsertAnatomyDeck(deck) {
  const userId = await getUserId();
  return userId ? upsertAnatomyDeckRemote(userId, deck) : upsertAnatomyDeckLocal(deck);
}

export async function deleteAnatomyDeck(id) {
  const userId = await getUserId();
  return userId ? deleteAnatomyDeckRemote(userId, id) : deleteAnatomyDeckLocal(id);
}

export async function loadAnatomyProgress(deckId) {
  const userId = await getUserId();
  return userId ? loadAnatomyProgressRemote(deckId) : loadAnatomyProgressLocal(deckId);
}

export async function saveAnatomyProgress(deckId, state) {
  const userId = await getUserId();
  return userId ? saveAnatomyProgressRemote(userId, deckId, state) : saveAnatomyProgressLocal(deckId, state);
}
