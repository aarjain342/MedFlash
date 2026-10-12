import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deckHue, DECK_HUES } from './deckColor.js';

describe('deckHue', () => {
  test('is stable for the same key', () => {
    assert.equal(deckHue('abc-123'), deckHue('abc-123'));
  });

  test('always lands inside the palette', () => {
    for (const key of ['a', 'Renal physiology', '', null, undefined, 42, 'x'.repeat(500)]) {
      const hue = deckHue(key);
      assert.ok(Number.isInteger(hue) && hue >= 0 && hue < DECK_HUES, `${key} -> ${hue}`);
    }
  });

  test('spreads different keys across the palette', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => deckHue(`deck-${i}`)));
    assert.ok(seen.size >= 4, `only ${seen.size} distinct hues`);
  });
});
