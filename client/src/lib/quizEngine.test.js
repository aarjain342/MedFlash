import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  initQuizState,
  addTopicToState,
  getCurrentQuestion,
  submitAnswer,
  getTopicSummaries,
  getOverallStats,
  getStatsAcross,
} from './quizEngine.js';

function question(overrides = {}) {
  return {
    stem: 'Stem',
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'Because',
    difficulty: 1,
    ...overrides,
  };
}

function threeQuestions() {
  return [question({ difficulty: 1 }), question({ difficulty: 3 }), question({ difficulty: 5 })];
}

describe('initQuizState', () => {
  test('drops malformed questions defensively and skips a topic left with none', () => {
    const state = initQuizState([
      { name: 'Good', questions: threeQuestions() },
      { name: 'AllBad', questions: [{ stem: '' }, null, { options: ['only one'] }] },
    ]);
    assert.ok(state.topics.Good);
    assert.equal(state.topics.AllBad, undefined);
    assert.deepEqual(state.order, ['Good']);
  });

  test('sorts each topic\'s questions ascending by difficulty', () => {
    const state = initQuizState([
      { name: 'T', questions: [question({ difficulty: 5 }), question({ difficulty: 1 }), question({ difficulty: 3 })] },
    ]);
    assert.deepEqual(state.topics.T.questions.map((q) => q.difficulty), [1, 3, 5]);
  });

  test('complete is true immediately when every topic is dropped', () => {
    const state = initQuizState([{ name: 'Empty', questions: [] }]);
    assert.equal(state.complete, true);
  });

  test('shuffle: false preserves arrival order', () => {
    const state = initQuizState(
      [{ name: 'A', questions: threeQuestions() }, { name: 'B', questions: threeQuestions() }],
      { shuffle: false }
    );
    assert.deepEqual(state.order, ['A', 'B']);
  });
});

describe('mastery / retry cycling', () => {
  test('a wrong answer keeps the topic in rotation and never repeats the missed question next', () => {
    const state = initQuizState([{ name: 'T', questions: threeQuestions() }]);
    const q1 = getCurrentQuestion(state);
    const result = submitAnswer(state, q1.topicName, q1.index, q1.presented, q1.presented.correctIndex + 1);
    assert.equal(result.correct, false);
    assert.equal(result.mastered, false);

    const q2 = getCurrentQuestion(state);
    assert.equal(q2.topicName, 'T'); // same topic comes right back
    assert.notEqual(q2.index, q1.index); // but never the same question that was just missed
  });

  test('topic is mastered once all 3 questions have been answered correctly', () => {
    const state = initQuizState([{ name: 'T', questions: threeQuestions() }]);
    let mastered = false;
    for (let i = 0; i < 3; i++) {
      const q = getCurrentQuestion(state);
      const res = submitAnswer(state, q.topicName, q.index, q.presented, q.presented.correctIndex);
      mastered = res.mastered;
    }
    assert.equal(mastered, true);
    assert.equal(state.topics.T.mastered, true);
  });

  test('quiz is complete once every topic is mastered', () => {
    const state = initQuizState([{ name: 'T', questions: threeQuestions() }]);
    for (let i = 0; i < 3; i++) {
      const q = getCurrentQuestion(state);
      submitAnswer(state, q.topicName, q.index, q.presented, q.presented.correctIndex);
    }
    assert.equal(getCurrentQuestion(state), null);
    assert.equal(state.complete, true);
  });

  test('a wrong answer never repeats even across multiple consecutive misses', () => {
    const state = initQuizState([{ name: 'T', questions: threeQuestions() }]);
    const seenIndices = new Set();
    for (let i = 0; i < 3; i++) {
      const q = getCurrentQuestion(state);
      assert.ok(!seenIndices.has(q.index) || i === 0, `question ${q.index} repeated immediately`);
      seenIndices.add(q.index);
      submitAnswer(state, q.topicName, q.index, q.presented, q.presented.correctIndex + 1); // always wrong
    }
  });
});

describe('addTopicToState (background generation)', () => {
  test('a topic that arrives after the session started joins rotation', () => {
    const state = initQuizState([{ name: 'First', questions: threeQuestions() }]);
    addTopicToState(state, 'Second', threeQuestions());
    assert.ok(state.topics.Second);
    assert.ok(state.order.includes('Second'));
  });

  test('revives a "complete" session when a new topic streams in after the rest finished', () => {
    const state = initQuizState([{ name: 'First', questions: threeQuestions() }]);
    for (let i = 0; i < 3; i++) {
      const q = getCurrentQuestion(state);
      submitAnswer(state, q.topicName, q.index, q.presented, q.presented.correctIndex);
    }
    // `complete` is only set inside advanceCursor(), which runs during getCurrentQuestion —
    // it isn't updated by submitAnswer itself, so this call is what discovers completion.
    assert.equal(getCurrentQuestion(state), null);
    assert.equal(state.complete, true);

    addTopicToState(state, 'Second', threeQuestions());
    assert.equal(state.complete, false);
    const next = getCurrentQuestion(state);
    assert.equal(next.topicName, 'Second');
  });

  test('adding a topic that already exists is a no-op', () => {
    const state = initQuizState([{ name: 'First', questions: threeQuestions() }]);
    const orderBefore = [...state.order];
    addTopicToState(state, 'First', threeQuestions());
    assert.deepEqual(state.order, orderBefore);
  });

  test('a topic with only malformed questions is silently ignored, not added empty', () => {
    const state = initQuizState([{ name: 'First', questions: threeQuestions() }]);
    addTopicToState(state, 'Bad', [{ stem: '' }]);
    assert.equal(state.topics.Bad, undefined);
  });
});

describe('stats', () => {
  test('getOverallStats aggregates correct/wrong and accuracy', () => {
    const state = initQuizState([{ name: 'T', questions: threeQuestions() }]);
    const q1 = getCurrentQuestion(state);
    submitAnswer(state, q1.topicName, q1.index, q1.presented, q1.presented.correctIndex); // correct
    const q2 = getCurrentQuestion(state);
    submitAnswer(state, q2.topicName, q2.index, q2.presented, q2.presented.correctIndex + 1); // wrong

    const stats = getOverallStats(state);
    assert.equal(stats.correct, 1);
    assert.equal(stats.wrong, 1);
    assert.equal(stats.accuracy, 50);
  });

  test('getStatsAcross sums multiple states and tolerates null/undefined entries', () => {
    const s1 = initQuizState([{ name: 'T', questions: threeQuestions() }]);
    const q = getCurrentQuestion(s1);
    submitAnswer(s1, q.topicName, q.index, q.presented, q.presented.correctIndex);

    const stats = getStatsAcross([s1, null, undefined]);
    assert.equal(stats.correct, 1);
    assert.equal(stats.topicsTotal, 1);
  });

  test('accuracy is null (not NaN/0) when nothing has been attempted yet', () => {
    const state = initQuizState([{ name: 'T', questions: threeQuestions() }]);
    assert.equal(getOverallStats(state).accuracy, null);
  });
});

describe('getTopicSummaries', () => {
  test('reports per-question correctness and attempt counts', () => {
    const state = initQuizState([{ name: 'T', questions: threeQuestions() }]);
    const q = getCurrentQuestion(state);
    submitAnswer(state, q.topicName, q.index, q.presented, q.presented.correctIndex);

    const [summary] = getTopicSummaries(state);
    assert.equal(summary.name, 'T');
    const answered = summary.questions.find((qq) => qq.index === q.index);
    assert.equal(answered.correct, true);
    assert.equal(answered.attempts, 1);
  });
});
