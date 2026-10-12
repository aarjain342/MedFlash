// Adaptive USMLE-style quiz engine.
//
// Each topic gets a small pool of pre-generated questions, ascending in difficulty. The
// session round-robins across topics; getting a question right moves on to the next topic,
// getting it wrong keeps you on the SAME topic for the next question — but always a
// DIFFERENT one from that topic's pool, never the exact question you just missed. A topic is
// "mastered" once all of its questions have been answered correctly (in any order) and then
// drops out of rotation.
//
// The student can also take material out of the session: "omit" a single question (it never
// comes back, and the topic no longer needs it to be mastered) or "skip" a whole topic. Both are
// reversible, because both are just flags on the saved state.

// Defensive check on top of the server's own validation — guards against stale cached
// quiz state from before a schema/validation change, so a malformed question degrades to
// "just skip it" instead of crashing the render to a blank screen.
function isValidQuestion(q) {
  return (
    q &&
    typeof q.stem === 'string' && q.stem.trim().length > 0 &&
    Array.isArray(q.options) && q.options.length >= 2 &&
    q.options.every((o) => typeof o === 'string') &&
    Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.options.length
  );
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Saved states from before omit/skip existed have no `omitted`/`skipped`; both read as "no".
const isOmitted = (topic, i) => Boolean(topic.omitted && topic.omitted[i]);
// A question no longer needs answering once it is right, or the student has omitted it.
const isResolved = (topic, i) => Boolean(topic.correctFlags[i]) || isOmitted(topic, i);
const inPlay = (topic) => !topic.mastered && !topic.skipped;

function buildTopicEntry(name, questions) {
  const valid = (questions || []).filter(isValidQuestion);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => (a.difficulty || 0) - (b.difficulty || 0));
  return {
    name,
    questions: sorted,
    correctFlags: sorted.map(() => false),
    // Per-question attempt history — this is what backs the question-bank sidebar and
    // the right/wrong stats, on top of correctFlags which only drives mastery/picking.
    stats: sorted.map(() => ({ attempts: 0, correct: 0, wrong: 0 })),
    qCursor: 0, // index into `questions` of the one to present next
    omitted: sorted.map(() => false), // questions the student asked never to see again
    skipped: false, // the whole topic taken out of the session
    mastered: false,
    attempts: 0,
    wrongInARow: 0,
  };
}

// `shuffle: true` randomizes topic order (independent of slide order) instead of following
// the order topics were generated in, which itself follows slide order. `originalOrder`
// keeps the un-shuffled (slide/arrival) order around so shuffle can be toggled on/off later
// in the session, not just chosen once up front — see setShuffleMode.
export function initQuizState(topicsWithQuestions, { shuffle = false } = {}) {
  const topics = {};
  const originalOrder = [];

  for (const { name, questions } of topicsWithQuestions) {
    const entry = buildTopicEntry(name, questions);
    if (!entry) continue;
    topics[name] = entry;
    originalOrder.push(name);
  }

  const order = shuffle ? shuffleArray(originalOrder) : [...originalOrder];

  return { topics, order, originalOrder, cursor: 0, complete: order.length === 0, shuffle: !!shuffle };
}

// Merges a topic that finished generating AFTER the quiz session already started (background
// generation) into a live state object, mutating it in place. New topics join the rotation —
// appended in order, or spliced in at a random remaining position when shuffle mode is on, so
// they don't all cluster at the very end of the session.
export function addTopicToState(state, name, questions) {
  const entry = buildTopicEntry(name, questions);
  if (!entry || state.topics[name]) return;
  state.topics[name] = entry;
  if (!state.originalOrder) state.originalOrder = [...state.order]; // backfill for older saved state
  state.originalOrder.push(name);

  if (state.shuffle && state.order.length > 0) {
    const insertAt = 1 + Math.floor(Math.random() * state.order.length);
    state.order.splice(insertAt, 0, name);
  } else {
    state.order.push(name);
  }
  state.complete = false;
}

// Switches between slide order and shuffled order at any point in a session, not just at
// setup — re-derives `order` from `originalOrder` (topics still in play only) rather than
// re-shuffling in place, so toggling shuffle off actually restores slide order exactly.
export function setShuffleMode(state, shuffle) {
  if (!state.originalOrder) state.originalOrder = [...state.order];
  state.shuffle = !!shuffle;
  const remaining = state.originalOrder.filter((name) => state.topics[name] && inPlay(state.topics[name]));
  state.order = shuffle ? shuffleArray(remaining) : remaining;
  if (state.cursor >= state.order.length) state.cursor = 0;
}

// Jumps straight to a specific question the user picked from the topic/question list,
// instead of the engine's automatic pick order. Doesn't disturb progression state — the
// question's position in its topic's rotation (qCursor) is updated so the auto-picker
// resumes sensibly afterward, and submitAnswer(...) works exactly the same either way.
export function presentQuestion(state, topicName, index) {
  const topic = state.topics[topicName];
  if (!topic || !topic.questions[index] || isOmitted(topic, index)) return null;
  topic.qCursor = index;
  const question = topic.questions[index];
  return { topicName, index, tier: question.difficulty, presented: shuffleOptions(question) };
}

function shuffleOptions(question) {
  const indices = question.options.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return {
    options: indices.map((i) => question.options[i]),
    correctIndex: indices.indexOf(question.correctIndex),
    stem: question.stem,
    explanation: question.explanation,
    memoryAid: typeof question.memoryAid === 'string' ? question.memoryAid : '',
    difficulty: question.difficulty,
  };
}

// Picks the next question in the topic's pool that is neither answered correctly nor omitted,
// starting from qCursor and wrapping around — so a wrong answer's retry is always a different
// question, never the one just missed, until every question in the pool has been tried.
function pickQuestion(topic) {
  const n = topic.questions.length;
  for (let step = 0; step < n; step++) {
    const idx = (topic.qCursor + step) % n;
    if (!isResolved(topic, idx)) return idx;
  }
  return topic.qCursor % n; // everything already resolved (shouldn't happen — topic would be finished)
}

// Drops any topics that finished (mastered or skipped). Returns null when none are left (quiz
// complete).
function advanceCursor(state) {
  state.order = state.order.filter((name) => state.topics[name] && inPlay(state.topics[name]));
  if (state.order.length === 0) {
    state.complete = true;
    return null;
  }
  if (state.cursor >= state.order.length) state.cursor = 0;
  return state.order[state.cursor];
}

// Takes a finished topic out of the rotation. The cursor moves back one if the topic sat before
// it, so the topic that was next stays next. (Filtering only after the cursor had already moved
// on used to jump over the following topic whenever one was mastered.)
function dropFromOrder(state, name) {
  const at = state.order.indexOf(name);
  if (at === -1) return;
  state.order.splice(at, 1);
  if (at < state.cursor) state.cursor -= 1;
  if (state.order.length === 0) state.complete = true;
}

// A topic is finished once every question is right or omitted. All right (or right plus omitted)
// is mastery; every question omitted counts as skipping the topic. Returns whether it finished.
function settleTopic(topic) {
  if (!topic.questions.every((_, i) => isResolved(topic, i))) return false;
  if (topic.correctFlags.some(Boolean)) topic.mastered = true;
  else topic.skipped = true;
  return true;
}

function rejoin(state, topicName) {
  const topic = state.topics[topicName];
  if (inPlay(topic) && !state.order.includes(topicName)) {
    state.order.push(topicName);
    state.complete = false;
  }
}

// Never show this question again. The topic can finish without it. Moves on to the next topic
// when the question was the one on screen, like a right answer would.
export function omitQuestion(state, topicName, index) {
  const topic = state.topics[topicName];
  if (!topic || !topic.questions[index]) return null;
  if (!topic.omitted) topic.omitted = topic.questions.map(() => false);
  if (topic.omitted[index]) return { topicName, index, topicDone: false };

  topic.omitted[index] = true;
  const wasCurrent = state.order[state.cursor] === topicName;
  topic.qCursor = (index + 1) % topic.questions.length;

  const topicDone = settleTopic(topic);
  if (topicDone) dropFromOrder(state, topicName);
  else if (wasCurrent) state.cursor += 1;
  return { topicName, index, topicDone };
}

// Undoes omitQuestion. If that omission had finished the topic, the topic comes back.
export function restoreQuestion(state, topicName, index) {
  const topic = state.topics[topicName];
  if (!topic || !topic.omitted || !topic.omitted[index]) return false;
  topic.omitted[index] = false;
  if (!topic.questions.every((_, i) => isResolved(topic, i))) {
    topic.mastered = false;
    topic.skipped = false;
  }
  rejoin(state, topicName);
  return true;
}

// "Avoid this topic": out of the rotation, and out of the progress totals.
export function skipTopic(state, topicName) {
  const topic = state.topics[topicName];
  if (!topic || topic.skipped) return false;
  topic.skipped = true;
  dropFromOrder(state, topicName);
  return true;
}

// Undoes skipTopic. Questions the student had omitted individually come back with it, since
// bringing a topic back with nothing left to ask would be pointless.
export function restoreTopic(state, topicName) {
  const topic = state.topics[topicName];
  if (!topic || !topic.skipped) return false;
  topic.skipped = false;
  topic.omitted = topic.questions.map(() => false);
  if (topic.questions.every((_, i) => isResolved(topic, i))) topic.mastered = true;
  rejoin(state, topicName);
  return true;
}

// Returns the current question to show: { topicName, index, tier, presented: { stem, options, correctIndex, explanation, memoryAid, difficulty } }
// or null if the quiz is complete. `index` must be passed back into submitAnswer.
export function getCurrentQuestion(state) {
  const topicName = advanceCursor(state);
  if (!topicName) return null;
  const topic = state.topics[topicName];
  const index = pickQuestion(topic);
  topic.qCursor = index;
  const question = topic.questions[index];
  return { topicName, index, tier: question.difficulty, presented: shuffleOptions(question) };
}

// Call with the option index the user picked (relative to the shuffled `presented.options`
// from the question you just showed) and the `index` from getCurrentQuestion. Returns
// { correct, mastered, topicName }.
export function submitAnswer(state, topicName, index, presented, selectedIndex) {
  const topic = state.topics[topicName];
  const correct = selectedIndex === presented.correctIndex;
  topic.attempts += 1;

  // Older saved quiz state (from before stats existed) won't have this — backfill lazily.
  if (!topic.stats) topic.stats = topic.questions.map(() => ({ attempts: 0, correct: 0, wrong: 0 }));
  const qStats = topic.stats[index];
  qStats.attempts += 1;
  if (correct) qStats.correct += 1;
  else qStats.wrong += 1;

  if (correct) {
    topic.wrongInARow = 0;
    topic.correctFlags[index] = true;
    state.cursor += 1; // move on to the next topic in rotation
    if (settleTopic(topic)) dropFromOrder(state, topicName);
  } else {
    topic.wrongInARow += 1;
    // state.cursor intentionally not advanced — same topic comes back as the next question
  }
  topic.qCursor = (index + 1) % topic.questions.length; // next pick starts from a different question

  return { correct, mastered: topic.mastered, topicName };
}

// Full question-bank view for the sidebar: every topic with every one of its questions,
// each tagged with its current status (correct / wrong-only-so-far / unattempted / omitted).
export function getTopicSummaries(state) {
  return Object.values(state.topics).map((t) => {
    const nextQuestion = t.questions[t.qCursor] || t.questions[t.questions.length - 1];
    const stats = t.stats || t.questions.map(() => ({ attempts: 0, correct: 0, wrong: 0 }));
    return {
      name: t.name,
      tier: nextQuestion?.difficulty || 1,
      mastered: t.mastered,
      skipped: Boolean(t.skipped),
      struggling: t.wrongInARow >= 2,
      questions: t.questions.map((q, i) => ({
        index: i,
        stem: q.stem,
        memoryAid: q.memoryAid || '',
        difficulty: q.difficulty,
        correct: t.correctFlags[i],
        omitted: isOmitted(t, i),
        attempts: stats[i]?.attempts || 0,
        wrong: stats[i]?.wrong || 0,
      })),
    };
  });
}

// A saved quiz is one state, or (since a deck can have both an easy and a hard set) a store
// holding several; see quizSets.js. Both are accepted wherever stats are summed.
function statesIn(entry) {
  if (entry && entry.sets && typeof entry.sets === 'object') return Object.values(entry.sets).filter(Boolean);
  return [entry];
}

// Aggregate right/wrong counts across the whole session, for the stats bar.
export function getOverallStats(state) {
  return getStatsAcross([state]);
}

// Same shape, but summed across every quiz state the user has (one per deck they've
// quizzed on) — this is what the app-wide Stats page shows, not just the active session.
export function getStatsAcross(states) {
  let correct = 0;
  let wrong = 0;
  let topicsTotal = 0;
  let topicsMastered = 0;

  for (const state of states.flatMap(statesIn)) {
    if (!state?.topics) continue;
    for (const topic of Object.values(state.topics)) {
      // Skipped topics are material the student has chosen not to be tested on.
      if (!topic.skipped) topicsTotal += 1;
      if (topic.mastered && !topic.skipped) topicsMastered += 1;
      for (const s of topic.stats || []) {
        correct += s.correct;
        wrong += s.wrong;
      }
    }
  }

  const attempted = correct + wrong;
  return {
    correct,
    wrong,
    attempted,
    accuracy: attempted > 0 ? Math.round((correct / attempted) * 100) : null,
    topicsTotal,
    topicsMastered,
  };
}

const STRONG_ACCURACY = 80;
const WEAK_ACCURACY = 70;
const LIST_LIMIT = 5;
const MISSED_PER_TOPIC = 3;

// The end-of-session debrief: what went well, what didn't, and what to do next. Built from the
// saved stats alone (no AI call), so it is instant and works on any quiz, old or new.
export function getSessionSummary(state) {
  const overall = getOverallStats(state);
  const strengths = [];
  const weaknesses = [];
  let skippedTopics = 0;
  let omittedQuestions = 0;

  for (const topic of Object.values(state.topics)) {
    if (topic.skipped) {
      skippedTopics += 1;
      continue;
    }
    omittedQuestions += (topic.omitted || []).filter(Boolean).length;

    const stats = topic.stats || [];
    const attempts = stats.reduce((sum, s) => sum + s.attempts, 0);
    const right = stats.reduce((sum, s) => sum + s.correct, 0);
    const wrong = stats.reduce((sum, s) => sum + s.wrong, 0);
    if (attempts === 0) continue;
    const accuracy = Math.round((right / attempts) * 100);

    if (wrong > 0 && accuracy < WEAK_ACCURACY) {
      const missed = topic.questions
        .map((q, i) => ({ q, wrongCount: stats[i]?.wrong || 0, omitted: isOmitted(topic, i) }))
        .filter(({ wrongCount, omitted }) => wrongCount > 0 && !omitted)
        .sort((a, b) => b.wrongCount - a.wrongCount)
        .slice(0, MISSED_PER_TOPIC)
        .map(({ q }) => ({ stem: q.stem, memoryAid: q.memoryAid || '' }));
      weaknesses.push({ name: topic.name, correct: right, wrong, attempts, accuracy, mastered: topic.mastered, missed });
    } else if (accuracy >= STRONG_ACCURACY) {
      strengths.push({ name: topic.name, correct: right, wrong, attempts, accuracy, mastered: topic.mastered });
    }
  }

  strengths.sort((a, b) => b.accuracy - a.accuracy || b.attempts - a.attempts);
  weaknesses.sort((a, b) => b.wrong - a.wrong || a.accuracy - b.accuracy);

  const topWeak = weaknesses.slice(0, LIST_LIMIT);
  const unfinished = Object.values(state.topics).filter((t) => inPlay(t)).length;
  const plan = [];
  if (topWeak.length > 0) {
    const names = topWeak.slice(0, 3).map((w) => w.name);
    plan.push(`Reread your flashcards for ${names.join(', ')} before your next attempt.`);
    if (topWeak.some((w) => w.missed.some((m) => m.memoryAid))) {
      plan.push('Read the memory tricks above out loud once; the silly ones stick best.');
    }
  }
  if (unfinished > 0 && overall.attempted > 0) {
    plan.push(`${unfinished} topic${unfinished === 1 ? ' is' : 's are'} still in play. Keep going until each one is mastered.`);
  }
  if (overall.attempted > 0 && topWeak.length === 0 && unfinished === 0) {
    plan.push('Nothing is dragging you down. Come back in a few days and check how much you kept.');
  }
  if (overall.attempted === 0) {
    plan.push('Answer a few questions and a plan for what to review shows up here.');
  }

  return {
    ...overall,
    strengths: strengths.slice(0, LIST_LIMIT),
    weaknesses: topWeak,
    plan,
    skippedTopics,
    omittedQuestions,
  };
}
