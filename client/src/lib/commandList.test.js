import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommands } from './commandList.js';

const calls = [];
const actions = {
  navigate: (v) => calls.push(['navigate', v]),
  study: (d) => calls.push(['study', d.id]),
  quiz: (d) => calls.push(['quiz', d.id]),
  studyAnatomy: (d) => calls.push(['anatomy', d.id]),
  setTheme: (t) => calls.push(['theme', t]),
  signOut: () => calls.push(['signOut']),
};

describe('buildCommands', () => {
  test('always offers every section, theme choice and (signed in) sign out', () => {
    const ids = buildCommands({ actions }).map((c) => c.id);
    for (const id of ['go-home', 'go-decks', 'go-flashcards', 'go-questions', 'go-anatomy', 'go-settings', 'theme-dark', 'sign-out']) {
      assert.ok(ids.includes(id), id);
    }
  });

  test('guest mode has no account to sign out of', () => {
    assert.ok(!buildCommands({ actions, guestMode: true }).some((c) => c.id === 'sign-out'));
  });

  test('offers Study and Quiz only for decks whose cards have loaded', () => {
    const decks = [
      { id: 'a', name: 'Renal', cards: [{ id: 1 }] },
      { id: 'b', name: 'Still loading', cards: null },
      { id: 'c', name: 'Empty', cards: [] },
    ];
    const ids = buildCommands({ decks, actions }).map((c) => c.id);
    assert.ok(ids.includes('study-a') && ids.includes('quiz-a'));
    assert.ok(!ids.some((id) => id.endsWith('-b') || id.endsWith('-c')));
  });

  test('offers anatomy decks only once their pages have loaded', () => {
    const anatomyDecks = [{ id: 'x', name: 'Skull', pages: [{ page: 1 }] }, { id: 'y', name: 'Loading', pages: null }];
    const ids = buildCommands({ anatomyDecks, actions }).map((c) => c.id);
    assert.ok(ids.includes('anatomy-x'));
    assert.ok(!ids.includes('anatomy-y'));
  });

  test('running a command calls the matching action with the right deck', () => {
    calls.length = 0;
    const decks = [{ id: 'a', name: 'Renal', cards: [{ id: 1 }] }];
    const byId = Object.fromEntries(buildCommands({ decks, actions }).map((c) => [c.id, c]));
    byId['study-a'].run();
    byId['quiz-a'].run();
    byId['go-settings'].run();
    byId['theme-dark'].run();
    assert.deepEqual(calls, [['study', 'a'], ['quiz', 'a'], ['navigate', 'settings'], ['theme', 'dark']]);
  });
});
