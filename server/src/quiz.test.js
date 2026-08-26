import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { groupCardsByTopic, sanitizeQuestions, buildQuizPrompt } from './quiz.js';

describe('groupCardsByTopic', () => {
  // Incident: a weaker fallback LLM occasionally returned `topic` as an object/array
  // instead of a string. The old `(card.topic || '').trim()` threw on that, and the throw
  // was outside any try/catch, crashing the whole server for every user on one bad
  // request. This must never regress.
  test('does not throw when topic is an object, array, number, or null', () => {
    const cards = [
      { topic: { nested: 'oops' }, question: 'Q1', answer: 'A1' },
      { topic: ['a', 'b'], question: 'Q2', answer: 'A2' },
      { topic: 42, question: 'Q3', answer: 'A3' },
      { topic: null, question: 'Q4', answer: 'A4' },
      { topic: undefined, question: 'Q5', answer: 'A5' },
    ];
    assert.doesNotThrow(() => groupCardsByTopic(cards));
  });

  test('malformed topics fall back to a "General" group instead of being dropped', () => {
    const groups = groupCardsByTopic([{ topic: { nested: 'oops' }, question: 'Q1', answer: 'A1' }]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, 'General');
    assert.equal(groups[0].cards.length, 1);
  });

  test('groups cards case-insensitively by topic name', () => {
    const groups = groupCardsByTopic([
      { topic: 'Cardiology', question: 'Q1', answer: 'A1' },
      { topic: 'cardiology', question: 'Q2', answer: 'A2' },
      { topic: 'Neurology', question: 'Q3', answer: 'A3' },
    ]);
    assert.equal(groups.length, 2);
    const cardio = groups.find((g) => g.name === 'Cardiology');
    assert.equal(cardio.cards.length, 2);
  });

  test('drops cards with neither question nor answer, and non-object entries', () => {
    const groups = groupCardsByTopic([null, 'oops', 42, { topic: 'X', question: '', answer: '' }]);
    assert.deepEqual(groups, []);
  });

  test('non-array input returns an empty array instead of throwing', () => {
    assert.doesNotThrow(() => groupCardsByTopic(null));
    assert.deepEqual(groupCardsByTopic(undefined), []);
    assert.deepEqual(groupCardsByTopic('not an array'), []);
  });
});

function validQuestion(overrides = {}) {
  return {
    stem: 'What is the mechanism?',
    options: ['A. Alpha', 'B. Beta', 'Gamma', 'Delta'],
    correctIndex: 0,
    explanation: 'Because reasons.',
    difficulty: 2,
    ...overrides,
  };
}

describe('sanitizeQuestions', () => {
  test('keeps well-formed questions and strips A./B) style option-label prefixes', () => {
    const [q] = sanitizeQuestions([validQuestion()]);
    assert.deepEqual(q.options, ['Alpha', 'Beta', 'Gamma', 'Delta']);
  });

  test('drops a question with an out-of-range correctIndex', () => {
    const result = sanitizeQuestions([validQuestion({ correctIndex: 99 })]);
    assert.equal(result.length, 0);
  });

  test('drops a question with fewer than 2 options', () => {
    const result = sanitizeQuestions([validQuestion({ options: ['Only one'] })]);
    assert.equal(result.length, 0);
  });

  test('drops a question with a non-string option (malformed model output)', () => {
    const result = sanitizeQuestions([validQuestion({ options: ['A. Alpha', { nested: true }, 'C', 'D'] })]);
    assert.equal(result.length, 0);
  });

  test('drops a question with an empty stem or missing explanation', () => {
    assert.equal(sanitizeQuestions([validQuestion({ stem: '   ' })]).length, 0);
    assert.equal(sanitizeQuestions([validQuestion({ explanation: '' })]).length, 0);
  });

  test('defaults a missing/non-finite difficulty to 3', () => {
    const [q] = sanitizeQuestions([validQuestion({ difficulty: undefined })]);
    assert.equal(q.difficulty, 3);
    const [q2] = sanitizeQuestions([validQuestion({ difficulty: NaN })]);
    assert.equal(q2.difficulty, 3);
  });

  test('non-array input returns an empty array instead of throwing', () => {
    assert.deepEqual(sanitizeQuestions(null), []);
    assert.deepEqual(sanitizeQuestions('nope'), []);
  });
});

describe('buildQuizPrompt', () => {
  test('easy mode explicitly excludes clinical-vignette style guidance', () => {
    const prompt = buildQuizPrompt('Renal', [{ question: 'Q', answer: 'A' }], 'easy');
    assert.match(prompt, /EASY mode/);
    assert.doesNotMatch(prompt, /2nd-order/);
  });

  test('anything other than "easy" falls back to hard/vignette mode', () => {
    const prompt = buildQuizPrompt('Renal', [{ question: 'Q', answer: 'A' }], 'medium');
    assert.match(prompt, /2nd-order/);
  });

  test('only includes up to the first 10 cards for the topic', () => {
    const cards = Array.from({ length: 15 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
    const prompt = buildQuizPrompt('Topic', cards, 'hard');
    assert.match(prompt, /Q9/);
    assert.doesNotMatch(prompt, /Q10\b/);
  });
});
