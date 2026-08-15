// Adaptive USMLE-style quiz engine.
//
// The session runs in rounds by difficulty tier (1 -> 5): every active topic must clear
// its current tier before the round advances, so the whole session gets harder as it
// goes on. A wrong answer keeps re-presenting that same topic/tier (options reshuffled)
// as the very next question — the topic doesn't advance until answered correctly. A
// topic is "mastered" once its tier-5 question is answered correctly, and drops out of
// the rotation.

export function initQuizState(topicsWithQuestions) {
  const topics = {};
  const order = [];

  for (const { name, questions } of topicsWithQuestions) {
    if (!questions || questions.length === 0) continue;
    const sorted = [...questions].sort((a, b) => a.difficulty - b.difficulty);
    topics[name] = {
      name,
      questions: sorted,
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
  const question = topic.questions[topic.tier - 1];
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
