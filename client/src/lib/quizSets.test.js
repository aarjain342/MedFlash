import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initQuizState, skipTopic, omitQuestion, getCurrentQuestion, submitAnswer } from './quizEngine.js';
import {
  toStore,
  emptyStore,
  hasSet,
  activeSet,
  putSet,
  switchTo,
  removeSet,
  skippedTopicNames,
  setProgress,
  normalizeDifficulty,
  otherDifficulty,
} from './quizSets.js';

const q = (difficulty = 1) => ({ stem: 'Stem', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'x', difficulty });
const stateOf = (...names) => initQuizState(names.map((name) => ({ name, questions: [q(1), q(3)] })));

describe('toStore', () => {
  test('wraps a quiz saved before sets existed, under the guessed difficulty', () => {
    const legacy = stateOf('A');
    const store = toStore(legacy, 'easy');
    assert.equal(store.version, 2);
    assert.equal(store.active, 'easy');
    assert.equal(store.sets.easy, legacy);
    assert.equal(hasSet(store, 'hard'), false);
  });

  test('defaults the guess to hard, and normalises nonsense to hard', () => {
    assert.equal(toStore(stateOf('A')).active, 'hard');
    assert.equal(toStore(stateOf('A'), 'medium').active, 'hard');
  });

  test('passes an existing store through', () => {
    const store = putSet(emptyStore('hard'), 'hard', stateOf('A'));
    putSet(store, 'easy', stateOf('B'));
    const again = toStore(JSON.parse(JSON.stringify(store)));
    assert.equal(again.active, 'easy');
    assert.deepEqual(Object.keys(again.sets).sort(), ['easy', 'hard']);
  });

  test('repairs an active pointer to a set that is missing', () => {
    const store = { version: 2, active: 'easy', sets: { hard: stateOf('A') } };
    assert.equal(toStore(store).active, 'hard');
  });

  test('returns null for nothing, junk, or a store with no usable set', () => {
    assert.equal(toStore(null), null);
    assert.equal(toStore(undefined), null);
    assert.equal(toStore('nope'), null);
    assert.equal(toStore({ topics: {} }), null);
    assert.equal(toStore({ version: 2, active: 'hard', sets: { hard: { junk: true } } }), null);
  });

  test('survives a JSON round trip, which is how it is stored', () => {
    const store = putSet(emptyStore(), 'hard', stateOf('A'));
    assert.deepEqual(toStore(JSON.parse(JSON.stringify(store))), store);
  });
});

describe('switching and replacing sets', () => {
  test('putSet adds a set and makes it active, leaving the other untouched', () => {
    const hard = stateOf('A');
    const store = putSet(emptyStore('hard'), 'hard', hard);
    putSet(store, 'easy', stateOf('A'));
    assert.equal(store.active, 'easy');
    assert.equal(store.sets.hard, hard);
  });

  test('switchTo only switches to a set that exists', () => {
    const store = putSet(emptyStore('hard'), 'hard', stateOf('A'));
    assert.equal(switchTo(store, 'easy'), false);
    assert.equal(store.active, 'hard');
    putSet(store, 'easy', stateOf('A'));
    assert.equal(switchTo(store, 'hard'), true);
    assert.equal(store.active, 'hard');
  });

  test('progress on one set is untouched by working on the other', () => {
    const store = putSet(putSet(emptyStore(), 'hard', stateOf('A')), 'easy', stateOf('A'));
    switchTo(store, 'hard');
    const question = getCurrentQuestion(activeSet(store));
    submitAnswer(activeSet(store), question.topicName, question.index, question.presented, question.presented.correctIndex);
    assert.equal(setProgress(store.sets.hard).done, 1);
    assert.equal(setProgress(store.sets.easy).done, 0);
  });

  test('removeSet hands the active role to the remaining set', () => {
    const store = putSet(putSet(emptyStore(), 'hard', stateOf('A')), 'easy', stateOf('A'));
    removeSet(store, 'easy');
    assert.equal(store.active, 'hard');
    assert.equal(hasSet(store, 'easy'), false);
  });

  test('difficulty helpers', () => {
    assert.equal(normalizeDifficulty('easy'), 'easy');
    assert.equal(normalizeDifficulty('whatever'), 'hard');
    assert.equal(otherDifficulty('hard'), 'easy');
    assert.equal(otherDifficulty('easy'), 'hard');
  });
});

describe('skippedTopicNames', () => {
  test('collects topics skipped in any set, once each', () => {
    const hard = stateOf('A', 'B');
    const easy = stateOf('A', 'C');
    skipTopic(hard, 'A');
    skipTopic(easy, 'A');
    skipTopic(easy, 'C');
    const store = putSet(putSet(emptyStore(), 'hard', hard), 'easy', easy);
    assert.deepEqual(skippedTopicNames(store).sort(), ['A', 'C']);
  });

  test('is empty for an empty or missing store', () => {
    assert.deepEqual(skippedTopicNames(emptyStore()), []);
    assert.deepEqual(skippedTopicNames(null), []);
  });
});

describe('setProgress', () => {
  test('counts correct answers out of the questions still in the set', () => {
    const state = stateOf('A', 'B');
    assert.deepEqual(setProgress(state), { done: 0, total: 4 });
    omitQuestion(state, 'A', 0);
    skipTopic(state, 'B');
    assert.deepEqual(setProgress(state), { done: 0, total: 1 });
  });

  test('is zero for nothing', () => {
    assert.deepEqual(setProgress(null), { done: 0, total: 0 });
  });
});
