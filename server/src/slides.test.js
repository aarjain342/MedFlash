import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlidePrompt } from './slides.js';

describe('buildSlidePrompt', () => {
  const prompt = buildSlidePrompt('Cortical granules harden the zona pellucida.', 3, 40, false);

  test('tells the model to return [] for slides with nothing examinable', () => {
    assert.match(prompt, /return an empty array \[\]/);
    assert.match(prompt, /do NOT make a card/);
  });

  test('names the filler it must skip: titles, quotes, agendas, objectives, references, thank-you', () => {
    for (const pattern of [
      /title \/ cover slides/,
      /quotes, jokes, cartoons, memes/,
      /agenda, outline/,
      /learning-objective lists/,
      /"Thank you", "Questions\?"/,
      /references, citations, bibliographies/,
      /housekeeping/,
      /section dividers/,
      /anecdotes/,
    ]) {
      assert.match(prompt, pattern);
    }
  });

  test('still makes cards for brief but real content, and for ambiguous slides', () => {
    // Regression guard: the filter must never swallow a short slide that does teach something.
    assert.match(prompt, /always gets cards, however briefly it is written/);
    assert.match(prompt, /When you are unsure whether a slide has examinable content, make the card/);
  });

  test('a slide mixing filler with content keeps only the content', () => {
    assert.match(prompt, /make cards from the real content only/);
  });

  test('keeps the consolidation guidance and the JSON contract', () => {
    assert.match(prompt, /a dense slide gets 2-3 cards and a light slide gets exactly 1/);
    assert.match(prompt, /Return ONLY a JSON array/);
    assert.match(prompt, /"topic": "short topic tag"/);
  });

  test('asks for one shared topic tag per slide, so a slide stays one quiz topic', () => {
    assert.match(prompt, /Use the SAME tag on every card you make from this slide/);
  });

  test('includes the slide text and its position in the file', () => {
    assert.match(prompt, /Cortical granules harden the zona pellucida\./);
    assert.match(prompt, /section 4 of 40/);
  });

  test('mentions the attached image only when there is one', () => {
    assert.doesNotMatch(prompt, /An image of the slide is also attached/);
    assert.match(buildSlidePrompt('x', 0, 1, true), /An image of the slide is also attached/);
  });

  test('has a placeholder for slides with no extractable text', () => {
    assert.match(buildSlidePrompt('', 0, 1, true), /\(no extractable text on this slide\)/);
  });
});
