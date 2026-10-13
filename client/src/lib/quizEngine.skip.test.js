// Omitting questions, skipping topics, restoring both, the cursor fix, memory aids and the
// session summary. (quizEngine.test.js keeps the original engine behaviour.)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  initQuizState,
  addTopicToState,
  getCurrentQuestion,
  presentQuestion,
  submitAnswer,
  omitQuestion,
  restoreQuestion,
  skipTopic,
  restoreTopic,
  setShuffleMode,
  getTopicSummaries,
  getStatsAcross,
  getSessionSummary,
} from './quizEngine.js';

function question(overrides = {}) {
  return { stem: 'Stem', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'Because', difficulty: 1, ...overrides };
}
const three = () => [question({ difficulty: 1 }), question({ difficulty: 3 }), question({ difficulty: 5 })];
const topicsOf = (...names) => names.map((name) => ({ name, questions: three() }));

function answer(state, right) {
  const q = getCurrentQuestion(state);
  const picked = right ? q.presented.correctIndex : (q.presented.correctIndex + 1) % q.presented.options.length;
  const result = submitAnswer(state, q.topicName, q.index, q.presented, picked);
  return { q, result };
}

describe('omitQuestion', () => {
  test('an omitted question is never presented again', () => {
    const state = initQuizState(topicsOf('T'));
    const first = getCurrentQuestion(state);
    omitQuestion(state, first.topicName, first.index);
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      const q = getCurrentQuestion(state);
      if (!q) break;
      seen.add(q.index);
      submitAnswer(state, q.topicName, q.index, q.presented, q.presented.correctIndex + 1); // keep missing
    }
    assert.ok(!seen.has(first.index));
    assert.equal(seen.size, 2);
  });

  test('the topic is mastered once its remaining questions are right, without the omitted one', () => {
    const state = initQuizState(topicsOf('T'));
    const first = getCurrentQuestion(state);
    omitQuestion(state, 'T', first.index);
    answer(state, true);
    const { result } = answer(state, true);
    assert.equal(result.mastered, true);
    assert.equal(getCurrentQuestion(state), null);
  });

  test('moves on to the next topic, as a right answer would', () => {
    const state = initQuizState(topicsOf('A', 'B'));
    const q = getCurrentQuestion(state);
    assert.equal(q.topicName, 'A');
    omitQuestion(state, 'A', q.index);
    assert.equal(getCurrentQuestion(state).topicName, 'B');
  });

  test('omitting every question of a topic finishes it as skipped, not mastered', () => {
    const state = initQuizState(topicsOf('A', 'B'));
    for (let i = 0; i < 3; i++) omitQuestion(state, 'A', i);
    assert.equal(state.topics.A.skipped, true);
    assert.equal(state.topics.A.mastered, false);
    assert.equal(getCurrentQuestion(state).topicName, 'B');
  });

  test('is idempotent, and ignores unknown topics and questions', () => {
    const state = initQuizState(topicsOf('T'));
    omitQuestion(state, 'T', 0);
    assert.equal(omitQuestion(state, 'T', 0).topicDone, false);
    assert.equal(omitQuestion(state, 'Nope', 0), null);
    assert.equal(omitQuestion(state, 'T', 99), null);
    assert.equal(state.topics.T.omitted.filter(Boolean).length, 1);
  });

  test('works on a quiz saved before omitting existed (no omitted array)', () => {
    const state = initQuizState(topicsOf('T'));
    delete state.topics.T.omitted;
    delete state.topics.T.skipped;
    assert.doesNotThrow(() => getCurrentQuestion(state));
    omitQuestion(state, 'T', 1);
    assert.equal(state.topics.T.omitted[1], true);
  });

  test('presentQuestion refuses an omitted question', () => {
    const state = initQuizState(topicsOf('T'));
    omitQuestion(state, 'T', 1);
    assert.equal(presentQuestion(state, 'T', 1), null);
    assert.ok(presentQuestion(state, 'T', 0));
  });
});

describe('restoreQuestion', () => {
  test('brings an omitted question back', () => {
    const state = initQuizState(topicsOf('T'));
    omitQuestion(state, 'T', 0);
    assert.equal(restoreQuestion(state, 'T', 0), true);
    assert.equal(state.topics.T.omitted[0], false);
  });

  test('brings back a topic that the omission had finished', () => {
    const state = initQuizState(topicsOf('A', 'B'));
    for (let i = 0; i < 3; i++) omitQuestion(state, 'A', i);
    assert.ok(!state.order.includes('A'));
    restoreQuestion(state, 'A', 1);
    assert.equal(state.topics.A.skipped, false);
    assert.ok(state.order.includes('A'));
    assert.equal(state.complete, false);
  });

  test('a topic mastered with the help of an omission is back in play once it is restored', () => {
    const state = initQuizState(topicsOf('T'));
    omitQuestion(state, 'T', 2);
    answer(state, true);
    answer(state, true);
    assert.equal(state.topics.T.mastered, true);
    restoreQuestion(state, 'T', 2);
    assert.equal(state.topics.T.mastered, false);
    assert.ok(getCurrentQuestion(state));
  });

  test('does nothing for a question that was not omitted', () => {
    const state = initQuizState(topicsOf('T'));
    assert.equal(restoreQuestion(state, 'T', 0), false);
  });
});

describe('skipTopic / restoreTopic', () => {
  test('a skipped topic leaves the rotation immediately', () => {
    const state = initQuizState(topicsOf('A', 'B', 'C'));
    skipTopic(state, 'A');
    assert.deepEqual(state.order, ['B', 'C']);
    assert.equal(getCurrentQuestion(state).topicName, 'B');
  });

  test('skipping the topic on screen moves to the topic that was next, not the one after it', () => {
    const state = initQuizState(topicsOf('A', 'B', 'C'));
    getCurrentQuestion(state); // A on screen
    skipTopic(state, 'A');
    assert.equal(getCurrentQuestion(state).topicName, 'B');
  });

  test('skipping a topic earlier in the order does not disturb which topic is up', () => {
    const state = initQuizState(topicsOf('A', 'B', 'C'));
    answer(state, true); // A right -> B is up
    assert.equal(getCurrentQuestion(state).topicName, 'B');
    skipTopic(state, 'A');
    assert.equal(getCurrentQuestion(state).topicName, 'B');
  });

  test('skipping every topic completes the quiz', () => {
    const state = initQuizState(topicsOf('A', 'B'));
    skipTopic(state, 'A');
    skipTopic(state, 'B');
    assert.equal(getCurrentQuestion(state), null);
    assert.equal(state.complete, true);
  });

  test('restoring a topic puts it back in the rotation with its omitted questions', () => {
    const state = initQuizState(topicsOf('A', 'B'));
    omitQuestion(state, 'A', 0);
    skipTopic(state, 'A');
    assert.equal(restoreTopic(state, 'A'), true);
    assert.equal(state.topics.A.skipped, false);
    assert.equal(state.topics.A.omitted.some(Boolean), false);
    assert.ok(state.order.includes('A'));
  });

  test('restoring revives a quiz that had been completed by skipping', () => {
    const state = initQuizState(topicsOf('A'));
    skipTopic(state, 'A');
    assert.equal(getCurrentQuestion(state), null);
    restoreTopic(state, 'A');
    assert.equal(state.complete, false);
    assert.ok(getCurrentQuestion(state));
  });

  test('shuffle mode keeps skipped topics out', () => {
    const state = initQuizState(topicsOf('A', 'B', 'C'), { shuffle: true });
    skipTopic(state, 'B');
    setShuffleMode(state, false);
    assert.deepEqual(state.order, ['A', 'C']);
    setShuffleMode(state, true);
    assert.ok(!state.order.includes('B'));
  });

  test('a topic that streams in later is unaffected by earlier skips', () => {
    const state = initQuizState(topicsOf('A'));
    skipTopic(state, 'A');
    addTopicToState(state, 'B', three());
    assert.equal(state.complete, false);
    assert.equal(getCurrentQuestion(state).topicName, 'B');
  });
});

describe('the next topic is no longer jumped over when a topic is mastered', () => {
  test('mastering A hands over to B, not C', () => {
    const state = initQuizState([
      { name: 'A', questions: [question()] },
      { name: 'B', questions: three() },
      { name: 'C', questions: three() },
    ]);
    const { result } = answer(state, true); // A's only question, right: A is mastered
    assert.equal(result.mastered, true);
    assert.equal(getCurrentQuestion(state).topicName, 'B');
  });

  test('every topic still gets visited in order across a full session', () => {
    const state = initQuizState([
      { name: 'A', questions: [question()] },
      { name: 'B', questions: [question()] },
      { name: 'C', questions: [question()] },
      { name: 'D', questions: [question()] },
    ]);
    const visited = [];
    for (let i = 0; i < 4; i++) visited.push(answer(state, true).q.topicName);
    assert.deepEqual(visited, ['A', 'B', 'C', 'D']);
    assert.equal(getCurrentQuestion(state), null);
  });
});

describe('memory aids', () => {
  test('are carried onto the presented question, and default to empty', () => {
    const state = initQuizState([
      { name: 'T', questions: [question({ memoryAid: 'Picture a bathtub.' }), question({ difficulty: 2 })] },
    ]);
    const aids = new Set();
    for (let i = 0; i < 2; i++) {
      const q = presentQuestion(state, 'T', i);
      aids.add(q.presented.memoryAid);
    }
    assert.deepEqual([...aids].sort(), ['', 'Picture a bathtub.']);
  });

  test('appear in the topic summaries', () => {
    const state = initQuizState([{ name: 'T', questions: [question({ memoryAid: 'Story' })] }]);
    assert.equal(getTopicSummaries(state)[0].questions[0].memoryAid, 'Story');
  });
});

describe('stats ignore skipped material', () => {
  test('skipped topics leave the topic totals', () => {
    const state = initQuizState(topicsOf('A', 'B'));
    assert.equal(getStatsAcross([state]).topicsTotal, 2);
    skipTopic(state, 'A');
    assert.equal(getStatsAcross([state]).topicsTotal, 1);
  });

  test('summaries flag skipped topics and omitted questions', () => {
    const state = initQuizState(topicsOf('A', 'B'));
    skipTopic(state, 'A');
    omitQuestion(state, 'B', 0);
    const [a, b] = getTopicSummaries(state);
    assert.equal(a.skipped, true);
    assert.equal(b.questions[0].omitted, true);
  });

  test('a store holding an easy and a hard set is summed across both', () => {
    const hard = initQuizState(topicsOf('A'));
    const easy = initQuizState(topicsOf('A'));
    answer(hard, true);
    answer(easy, false);
    const stats = getStatsAcross([{ version: 2, active: 'hard', sets: { hard, easy } }, null]);
    assert.equal(stats.correct, 1);
    assert.equal(stats.wrong, 1);
    assert.equal(stats.topicsTotal, 2);
  });
});

describe('getSessionSummary', () => {
  test('lists a clean topic as a strength and a missed one as a weakness, with its memory aid', () => {
    const state = initQuizState([
      { name: 'Strong', questions: [question({ stem: 'Strong stem' })] },
      { name: 'Weak', questions: [question({ stem: 'Weak stem', memoryAid: 'Picture a weak knee.' }), question({ stem: 'Weak two', difficulty: 2 })] },
    ]);
    answer(state, true); // Strong right
    answer(state, false); // Weak wrong
    answer(state, false); // Weak wrong again
    const summary = getSessionSummary(state);
    assert.deepEqual(summary.strengths.map((s) => s.name), ['Strong']);
    assert.deepEqual(summary.weaknesses.map((w) => w.name), ['Weak']);
    assert.ok(summary.weaknesses[0].missed.some((m) => m.memoryAid === 'Picture a weak knee.'));
    assert.match(summary.plan.join(' '), /Reread your flashcards for Weak/);
    assert.match(summary.plan.join(' '), /memory tricks/);
  });

  test('with nothing attempted yet, says so instead of inventing a verdict', () => {
    const summary = getSessionSummary(initQuizState(topicsOf('T')));
    assert.equal(summary.attempted, 0);
    assert.deepEqual(summary.strengths, []);
    assert.deepEqual(summary.weaknesses, []);
    assert.match(summary.plan[0], /Answer a few questions/);
  });

  test('a perfect run has no weaknesses and a retention plan', () => {
    const state = initQuizState([{ name: 'T', questions: [question()] }]);
    answer(state, true);
    const summary = getSessionSummary(state);
    assert.deepEqual(summary.weaknesses, []);
    assert.match(summary.plan.join(' '), /Come back in a few days/);
  });

  test('counts what was skipped and omitted, and leaves skipped topics out of the verdicts', () => {
    const state = initQuizState(topicsOf('A', 'B'));
    omitQuestion(state, 'B', 0);
    skipTopic(state, 'A');
    const summary = getSessionSummary(state);
    assert.equal(summary.skippedTopics, 1);
    assert.equal(summary.omittedQuestions, 1);
  });

  test('does not tell you to come back in a few days while topics are still in play', () => {
    const state = initQuizState(topicsOf('A', 'B'));
    answer(state, true);
    const plan = getSessionSummary(state).plan.join(' ');
    assert.doesNotMatch(plan, /Come back in a few days/);
    assert.match(plan, /still in play/);
  });

  test('mentions topics still in play', () => {
    const state = initQuizState(topicsOf('A', 'B'));
    answer(state, true);
    assert.match(getSessionSummary(state).plan.join(' '), /still in play/);
  });
});
