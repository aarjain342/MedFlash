// Adaptive USMLE-style quiz engine.
//
// Each topic gets a small pool of 3 pre-generated questions, ascending in difficulty. The
// session round-robins across topics; getting a question right moves on to the next topic,
// getting it wrong keeps you on the SAME topic for the next question — but always a
// DIFFERENT one from that topic's pool (cycling through the 3), never the exact question
// you just missed. A topic is "mastered" once all 3 of its questions have been answered
// correctly (in any order) and then drops out of rotation.

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

export function initQuizState(topicsWithQuestions) {
  const topics = {};
  const order = [];

  for (const { name, questions } of topicsWithQuestions) {
    const valid = (questions || []).filter(isValidQuestion);
    if (valid.length === 0) continue;

    const sorted = [...valid].sort((a, b) => (a.difficulty || 0) - (b.difficulty || 0));

    topics[name] = {
      name,
      questions: sorted,
      correctFlags: sorted.map(() => false),
      // Per-question attempt history — this is what backs the question-bank sidebar and
      // the right/wrong stats, on top of correctFlags which only drives mastery/picking.
      stats: sorted.map(() => ({ attempts: 0, correct: 0, wrong: 0 })),
      qCursor: 0, // index into `questions` of the one to present next
      mastered: false,
      attempts: 0,
      wrongInARow: 0,
    };
    order.push(name);
  }

  return { topics, order, cursor: 0, complete: order.length === 0 };
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
    difficulty: question.difficulty,
  };
}

// Picks the next not-yet-correct question in the topic's pool, starting from qCursor and
// wrapping around — so a wrong answer's retry is always a different question, never the
// one just missed, until every question in the pool has been tried.
function pickQuestion(topic) {
  const n = topic.questions.length;
  for (let step = 0; step < n; step++) {
    const idx = (topic.qCursor + step) % n;
    if (!topic.correctFlags[idx]) return idx;
  }
  return topic.qCursor % n; // everything already correct (shouldn't happen — topic would be mastered)
}

// Advances past any topics that finished mastering. Returns null when every topic is
// mastered (quiz complete).
function advanceCursor(state) {
  while (true) {
    state.order = state.order.filter((name) => !state.topics[name].mastered);
    if (state.order.length === 0) {
      state.complete = true;
      return null;
    }
    if (state.cursor >= state.order.length) state.cursor = 0;
    return state.order[state.cursor];
  }
}

// Returns the current question to show: { topicName, index, tier, presented: { stem, options, correctIndex, explanation, difficulty } }
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
    if (topic.correctFlags.every(Boolean)) topic.mastered = true;
    state.cursor += 1; // move on to the next topic in rotation
  } else {
    topic.wrongInARow += 1;
    // state.cursor intentionally not advanced — same topic comes back as the next question
  }
  topic.qCursor = (index + 1) % topic.questions.length; // next pick starts from a different question

  return { correct, mastered: topic.mastered, topicName };
}

// Full question-bank view for the sidebar: every topic with every one of its questions,
// each tagged with its current status (correct / wrong-only-so-far / unattempted).
export function getTopicSummaries(state) {
  return Object.values(state.topics).map((t) => {
    const nextQuestion = t.questions[t.qCursor] || t.questions[t.questions.length - 1];
    const stats = t.stats || t.questions.map(() => ({ attempts: 0, correct: 0, wrong: 0 }));
    return {
      name: t.name,
      tier: nextQuestion?.difficulty || 1,
      mastered: t.mastered,
      struggling: t.wrongInARow >= 2,
      questions: t.questions.map((q, i) => ({
        index: i,
        stem: q.stem,
        difficulty: q.difficulty,
        correct: t.correctFlags[i],
        attempts: stats[i]?.attempts || 0,
        wrong: stats[i]?.wrong || 0,
      })),
    };
  });
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

  for (const state of states) {
    if (!state?.topics) continue;
    for (const topic of Object.values(state.topics)) {
      topicsTotal += 1;
      if (topic.mastered) topicsMastered += 1;
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
