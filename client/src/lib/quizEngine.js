// Adaptive USMLE-style quiz engine.
//
// The session runs in rounds by difficulty tier (1 -> 5): every active topic must clear
// its current tier before the round advances, so the whole session gets harder as it
// goes on. A wrong answer keeps the topic on the same tier and re-presents a DIFFERENT
// question from that tier's pool (each tier has 2 pre-generated questions) as the very
// next question — only once both have been shown does it start repeating. A topic is
// "mastered" once its tier-5 question is answered correctly, and drops out of rotation.

export function initQuizState(topicsWithQuestions) {
  const topics = {};
  const order = [];

  for (const { name, questions } of topicsWithQuestions) {
    if (!questions || questions.length === 0) continue;

    const pool = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    for (const q of questions) {
      const tier = Math.min(5, Math.max(1, Math.round(q.difficulty) || 1));
      pool[tier].push(q);
    }
    // Guard against a tier the model left empty — borrow a question from the nearest
    // non-empty tier so getCurrentQuestion never dead-ends on this topic.
    const nonEmpty = [1, 2, 3, 4, 5].map((t) => pool[t]).find((bucket) => bucket.length > 0);
    for (let t = 1; t <= 5; t++) {
      if (pool[t].length === 0 && nonEmpty) pool[t] = [nonEmpty[0]];
    }

    topics[name] = {
      name,
      pool,
      shown: { 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set(), 5: new Set() },
      tier: 1,
      mastered: false,
      attempts: 0,
      wrongInARow: 0,
    };
    order.push(name);
  }

  return { topics, order, cursor: 0, roundTier: 1, complete: order.length === 0 };
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

// Picks a question from the topic's current-tier pool, preferring one not yet shown at
// this tier so a wrong answer doesn't just repeat the same question. Only falls back to
// re-showing one once every question at this tier has already been seen.
function pickQuestion(topic) {
  const bucket = topic.pool[topic.tier];
  const shownSet = topic.shown[topic.tier];

  let idx = bucket.findIndex((_, i) => !shownSet.has(i));
  if (idx === -1) idx = Math.floor(Math.random() * bucket.length);

  shownSet.add(idx);
  return bucket[idx];
}

// Advances past any topics that finished mastering in a prior round and rolls the round
// tier forward once every remaining topic has cleared it. Returns null when every topic
// is mastered (quiz complete).
function advanceCursor(state) {
  while (true) {
    if (state.order.length === 0) {
      state.complete = true;
      return null;
    }
    if (state.cursor >= state.order.length) {
      state.order = state.order.filter((name) => !state.topics[name].mastered);
      state.cursor = 0;
      state.roundTier = Math.min(5, state.roundTier + 1);
      if (state.order.length === 0) {
        state.complete = true;
        return null;
      }
      continue;
    }
    const topicName = state.order[state.cursor];
    if (state.topics[topicName].mastered) {
      state.order.splice(state.cursor, 1);
      continue;
    }
    return topicName;
  }
}

// Returns the current question to show: { topicName, tier, presented: { stem, options, correctIndex, explanation, difficulty } }
// or null if the quiz is complete.
export function getCurrentQuestion(state) {
  const topicName = advanceCursor(state);
  if (!topicName) return null;
  const topic = state.topics[topicName];
  const question = pickQuestion(topic);
  return { topicName, tier: topic.tier, presented: shuffleOptions(question) };
}

// Call with the option index the user picked (relative to the shuffled `presented.options`
// from the question you just showed). Returns { correct, mastered, topicName, tier }.
export function submitAnswer(state, topicName, presented, selectedIndex) {
  const topic = state.topics[topicName];
  const correct = selectedIndex === presented.correctIndex;
  topic.attempts += 1;

  if (correct) {
    topic.wrongInARow = 0;
    if (topic.tier === 5) {
      topic.mastered = true;
    } else {
      topic.tier += 1;
    }
    state.cursor += 1;
  } else {
    topic.wrongInARow += 1;
    // cursor intentionally not advanced — same topic/tier comes back as the next question
  }

  return { correct, mastered: topic.mastered, topicName, tier: topic.tier };
}

export function getTopicSummaries(state) {
  return Object.values(state.topics).map((t) => ({
    name: t.name,
    tier: t.tier,
    mastered: t.mastered,
    struggling: t.wrongInARow >= 2,
  }));
}
