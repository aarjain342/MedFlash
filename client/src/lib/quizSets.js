// A deck's saved quiz, as an easy set and/or a hard set kept side by side, so switching
// difficulty never means re-uploading the file or losing progress on the other set.
//
// It is stored in the same per-deck JSON blob the quiz already used (no schema change):
//   { version: 2, active: 'hard' | 'easy', sets: { hard?: <quiz state>, easy?: <quiz state> } }
// Quizzes saved before this existed are a bare quiz state; toStore() wraps one on load, and the
// next save writes the new shape.

export const DIFFICULTIES = ['hard', 'easy'];

export const normalizeDifficulty = (d) => (d === 'easy' ? 'easy' : 'hard');
export const otherDifficulty = (d) => (normalizeDifficulty(d) === 'easy' ? 'hard' : 'easy');

const isState = (value) => Boolean(value && typeof value === 'object' && value.topics && value.order);
const isStore = (value) => Boolean(value && value.version === 2 && value.sets && typeof value.sets === 'object');

// What was saved -> a store (or null if nothing usable was saved). A quiz saved before sets
// existed didn't record which difficulty it was generated at, so `legacyDifficulty` is the
// caller's best guess (the student's current preference).
export function toStore(saved, legacyDifficulty = 'hard') {
  if (isStore(saved)) {
    const sets = {};
    for (const d of DIFFICULTIES) if (isState(saved.sets[d])) sets[d] = saved.sets[d];
    const present = Object.keys(sets);
    if (present.length === 0) return null;
    const active = sets[normalizeDifficulty(saved.active)] ? normalizeDifficulty(saved.active) : present[0];
    return { version: 2, active, sets };
  }
  if (isState(saved)) {
    const difficulty = normalizeDifficulty(legacyDifficulty);
    return { version: 2, active: difficulty, sets: { [difficulty]: saved } };
  }
  return null;
}

export function emptyStore(difficulty = 'hard') {
  return { version: 2, active: normalizeDifficulty(difficulty), sets: {} };
}

export const hasSet = (store, difficulty) => Boolean(store?.sets?.[normalizeDifficulty(difficulty)]);
export const activeSet = (store) => store?.sets?.[store.active] || null;

// Adds (or replaces) a set and makes it the active one.
export function putSet(store, difficulty, state) {
  const d = normalizeDifficulty(difficulty);
  store.sets[d] = state;
  store.active = d;
  return store;
}

// Makes an existing set the active one. Returns false (and changes nothing) if there isn't one.
export function switchTo(store, difficulty) {
  const d = normalizeDifficulty(difficulty);
  if (!store?.sets?.[d]) return false;
  store.active = d;
  return true;
}

// Drops a set. If it was the active one, another set (if any) takes over.
export function removeSet(store, difficulty) {
  const d = normalizeDifficulty(difficulty);
  delete store.sets[d];
  if (store.active === d) {
    const left = Object.keys(store.sets);
    if (left.length > 0) store.active = left[0];
  }
  return store;
}

// Topics the student chose to skip, across every set. A new set is generated without them, so
// "avoid this topic" holds when they switch difficulty.
export function skippedTopicNames(store) {
  const names = new Set();
  for (const state of Object.values(store?.sets || {})) {
    for (const topic of Object.values(state?.topics || {})) if (topic.skipped) names.add(topic.name);
  }
  return [...names];
}

// "12 of 40" for a set's button: questions answered correctly out of those still in the set
// (omitted questions and skipped topics don't count).
export function setProgress(state) {
  let done = 0;
  let total = 0;
  for (const topic of Object.values(state?.topics || {})) {
    if (topic.skipped) continue;
    topic.questions.forEach((_, i) => {
      if (topic.omitted && topic.omitted[i]) return;
      total += 1;
      if (topic.correctFlags[i]) done += 1;
    });
  }
  return { done, total };
}
