import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCards, parseJsonArray } from './llm.js';

describe('sanitizeCards', () => {
  test('drops non-object entries and cards missing question/answer', () => {
    const cards = sanitizeCards([
      null,
      42,
      'a string',
      { question: 'Q1', answer: 'A1' },
      { question: '', answer: 'A2' },
      { question: 'Q3', answer: '' },
    ]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].question, 'Q1');
    assert.equal(cards[0].answer, 'A1');
  });

  test('truncates every field to its cap instead of storing it unbounded', () => {
    const [card] = sanitizeCards([
      {
        question: 'Q'.repeat(1000),
        answer: 'A'.repeat(5000),
        mnemonic: 'M'.repeat(1000),
        topic: 'T'.repeat(500),
      },
    ]);
    assert.equal(card.question.length, 600);
    assert.equal(card.answer.length, 3000);
    assert.equal(card.mnemonic.length, 400);
    assert.equal(card.topic.length, 120);
  });

  test('coerces non-string question/answer/topic instead of throwing', () => {
    const [card] = sanitizeCards([{ question: 123, answer: true, topic: null }]);
    assert.equal(card.question, '123');
    assert.equal(card.answer, 'true');
    assert.equal(card.topic, '');
  });

  test('drops a malformed table but keeps the card if question/answer are valid', () => {
    const [card] = sanitizeCards([
      { question: 'Q', answer: 'A', table: { headers: 'not an array', rows: [] } },
    ]);
    assert.equal(card.table, null);
  });

  test('caps table headers/rows to their limits and stringifies cells', () => {
    const [card] = sanitizeCards([
      {
        question: 'Q',
        answer: 'A',
        table: {
          headers: Array.from({ length: 20 }, (_, i) => `h${i}`),
          rows: Array.from({ length: 40 }, (_, i) => [i, `cell-${i}`]),
        },
      },
    ]);
    assert.equal(card.table.headers.length, 12);
    assert.equal(card.table.rows.length, 30);
    assert.equal(card.table.rows[0][0], '0'); // numeric cell coerced to string
  });

  test('non-array input returns an empty array instead of throwing', () => {
    assert.deepEqual(sanitizeCards(null), []);
    assert.deepEqual(sanitizeCards(undefined), []);
    assert.deepEqual(sanitizeCards('not an array'), []);
  });
});

describe('parseJsonArray', () => {
  test('parses a clean JSON array', () => {
    assert.deepEqual(parseJsonArray('[1,2,3]'), [1, 2, 3]);
  });

  test('extracts the array from surrounding prose/markdown fences', () => {
    const raw = 'Here is the result:\n```json\n[{"a":1}]\n```\nHope that helps!';
    assert.deepEqual(parseJsonArray(raw), [{ a: 1 }]);
  });

  test('throws a clear error when no array is present', () => {
    assert.throws(() => parseJsonArray('no json here'), /did not return parseable JSON/);
  });
});
