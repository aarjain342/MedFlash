import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { filterCommands, moveIndex } from './commands.js';

const commands = [
  { id: 'home', group: 'Go to', label: 'Home' },
  { id: 'decks', group: 'Go to', label: 'Decks' },
  { id: 's1', group: 'Study', label: 'Renal physiology', keywords: 'flashcards' },
  { id: 's2', group: 'Study', label: 'Osteology of the vertebral column' },
  { id: 'q1', group: 'Quiz', label: 'Renal physiology' },
  { id: 'theme', group: 'App', label: 'Switch theme', keywords: 'dark light appearance' },
];

describe('filterCommands', () => {
  test('an empty query lists everything in its original order', () => {
    assert.deepEqual(filterCommands(commands, '').map((c) => c.id), commands.map((c) => c.id));
    assert.deepEqual(filterCommands(commands, '   ').length, commands.length);
  });

  test('every word has to match somewhere, in label, group or keywords', () => {
    assert.deepEqual(filterCommands(commands, 'study renal').map((c) => c.id), ['s1']);
    assert.deepEqual(filterCommands(commands, 'quiz renal').map((c) => c.id), ['q1']);
    assert.deepEqual(filterCommands(commands, 'dark').map((c) => c.id), ['theme']);
  });

  test('matching is case-insensitive', () => {
    assert.deepEqual(filterCommands(commands, 'HOME').map((c) => c.id), ['home']);
  });

  test('a label that starts with the query beats one that merely contains it', () => {
    const list = [
      { id: 'a', group: 'X', label: 'Skull osteology' },
      { id: 'b', group: 'X', label: 'Osteology basics' },
    ];
    assert.deepEqual(filterCommands(list, 'osteo').map((c) => c.id), ['b', 'a']);
  });

  test('returns nothing when no command matches', () => {
    assert.deepEqual(filterCommands(commands, 'zzz'), []);
  });
});

describe('moveIndex', () => {
  test('moves and wraps in both directions', () => {
    assert.equal(moveIndex(0, 1, 3), 1);
    assert.equal(moveIndex(2, 1, 3), 0);
    assert.equal(moveIndex(0, -1, 3), 2);
  });

  test('is safe on an empty list', () => {
    assert.equal(moveIndex(0, 1, 0), 0);
  });
});
