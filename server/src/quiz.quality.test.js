// Covers the quiz-quality work: slide-based topics, question counts that match the material,
// craft checks, retry, memory aids and skipped topics. (quiz.test.js keeps the older basics.)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupCardsByTopic,
  groupCardsForQuiz,
  questionCountFor,
  difficultyLadder,
  questionIssues,
  sanitizeQuestions,
  excludeTopics,
  generateTopicQuestions,
  buildQuizPrompt,
} from './quiz.js';

const cardsOn = (page, topic, n = 1) =>
  Array.from({ length: n }, (_, i) => ({ page, topic, question: `Q${page}.${i}`, answer: `A${page}.${i}` }));

describe('groupCardsForQuiz', () => {
  test('makes one topic per slide, named with the slide number', () => {
    const topics = groupCardsForQuiz([...cardsOn(4, 'Glomerulus', 3), ...cardsOn(5, 'Tubule', 3)]);
    assert.deepEqual(topics.map((t) => t.name), ['Glomerulus (slide 4)', 'Tubule (slide 5)']);
    assert.deepEqual(topics.map((t) => t.cards.length), [3, 3]);
  });

  test('cards on one slide stay together even when each carries a different tag (the old per-card tagging)', () => {
    const topics = groupCardsForQuiz([
      { page: 8, topic: 'Loop diuretics pharmacology', question: 'a', answer: 'a' },
      { page: 8, topic: 'Loop diuretics adverse effects', question: 'b', answer: 'b' },
      { page: 8, topic: 'Loop diuretics sulfa allergy', question: 'c', answer: 'c' },
    ]);
    assert.equal(topics.length, 1);
    assert.equal(topics[0].cards.length, 3);
  });

  test('two slides that share a tag still become separate topics with unique names', () => {
    const topics = groupCardsForQuiz([...cardsOn(4, 'Renal physiology', 3), ...cardsOn(9, 'Renal physiology', 3)]);
    assert.deepEqual(topics.map((t) => t.name), ['Renal physiology (slide 4)', 'Renal physiology (slide 9)']);
  });

  test('merges a run of single-card slides, and names the merged topic for what it holds', () => {
    const topics = groupCardsForQuiz([...cardsOn(10, 'Winter formula'), ...cardsOn(11, 'Anion gap'), ...cardsOn(12, 'Hyperkalemia', 3)]);
    assert.equal(topics.length, 2);
    assert.equal(topics[0].name, 'Winter formula & Anion gap (slides 10–11)');
    assert.equal(topics[0].cards.length, 2);
    assert.equal(topics[1].name, 'Hyperkalemia (slide 12)');
  });

  test('does not glue a two-card slide onto the unrelated slide after it', () => {
    const topics = groupCardsForQuiz([...cardsOn(11, 'Diabetes insipidus', 2), ...cardsOn(12, 'Acid-base', 3)]);
    assert.deepEqual(topics.map((t) => t.cards.length), [2, 3]);
  });

  test('a single-card slide left at the end folds back into the previous topic', () => {
    const topics = groupCardsForQuiz([...cardsOn(1, 'A', 3), ...cardsOn(2, 'B')]);
    assert.equal(topics.length, 1);
    assert.equal(topics[0].cards.length, 4);
    assert.match(topics[0].name, /slides 1–2/);
  });

  test('splits a very dense slide so no card is left out of the prompt', () => {
    const topics = groupCardsForQuiz(cardsOn(3, 'Pharmacology', 20));
    assert.equal(topics.length, 2);
    assert.equal(topics.reduce((sum, t) => sum + t.cards.length, 0), 20);
    assert.ok(topics.every((t) => t.cards.length <= 12));
    assert.match(topics[0].name, /part 1/);
  });

  test('keeps slide order', () => {
    const topics = groupCardsForQuiz([...cardsOn(9, 'Late', 3), ...cardsOn(2, 'Early', 3)]);
    assert.deepEqual(topics.map((t) => t.name), ['Early (slide 2)', 'Late (slide 9)']);
  });

  test('falls back to topic-tag grouping for decks whose cards have no slide numbers', () => {
    const topics = groupCardsForQuiz([
      { topic: 'Cardiology', question: 'Q1', answer: 'A1' },
      { topic: 'cardiology', question: 'Q2', answer: 'A2' },
      { topic: 'Neurology', question: 'Q3', answer: 'A3' },
    ]);
    assert.deepEqual(topics.map((t) => t.name), ['Cardiology', 'Neurology']);
  });

  test('a stray card without a slide number rides with the card before it', () => {
    const topics = groupCardsForQuiz([...cardsOn(5, 'X', 2), { topic: 'X', question: 'loose', answer: 'loose' }, ...cardsOn(6, 'Y', 3)]);
    assert.equal(topics[0].cards.length, 3);
  });

  test('keeps tables, and survives malformed input', () => {
    const [t] = groupCardsForQuiz([{ page: 1, topic: 'T', question: 'q', answer: 'a', table: { headers: ['H'], rows: [['v']] } }]);
    assert.deepEqual(t.cards[0].table, { headers: ['H'], rows: [['v']] });
    assert.doesNotThrow(() => groupCardsForQuiz([null, 'x', { page: 'nope', topic: { a: 1 }, question: 'q', answer: 'a', table: 'bad' }]));
    assert.deepEqual(groupCardsForQuiz(null), []);
    assert.deepEqual(groupCardsByTopic(undefined), []);
  });
});

describe('questionCountFor / difficultyLadder', () => {
  test('asks for as many questions as the material supports, never padding a single card to three', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 7, 8, 12].map(questionCountFor), [1, 2, 3, 3, 4, 4, 5, 5]);
  });

  test('has an ascending difficulty ladder of the right length for every count and mode', () => {
    for (const mode of ['hard', 'easy']) {
      for (let n = 1; n <= 5; n++) {
        const ladder = difficultyLadder(mode, n);
        assert.equal(ladder.length, n);
        assert.deepEqual(ladder, [...ladder].sort((a, b) => a - b));
        assert.ok(ladder.every((d) => d >= 1 && d <= 5));
      }
    }
    assert.ok(difficultyLadder('hard', 3)[0] > difficultyLadder('easy', 3)[0]);
  });
});

describe('questionIssues and the sanitizeQuestions craft checks', () => {
  const good = (o = {}) => ({
    stem: 'A 54-year-old man has glucose in his urine at a plasma glucose of 220 mg/dL. Which transporter is saturated?',
    options: ['SGLT2', 'GLUT4', 'GLUT2', 'Na+/K+ ATPase', 'SGLT1'],
    correctIndex: 0,
    explanation: 'SGLT2 reabsorbs most filtered glucose and saturates above the renal threshold.',
    memoryAid: 'Think of a bathtub overflowing past its rim.',
    difficulty: 3,
    ...o,
  });

  test('a well-formed question has no issues and keeps its memory aid', () => {
    assert.deepEqual(questionIssues(good()), []);
    assert.equal(sanitizeQuestions([good()])[0].memoryAid, 'Think of a bathtub overflowing past its rim.');
  });

  test('flags and drops duplicate options', () => {
    const q = good({ options: ['SGLT2', 'sglt2', 'GLUT2', 'GLUT4', 'SGLT1'] });
    assert.ok(questionIssues(q).includes('duplicate-options'));
    assert.equal(sanitizeQuestions([q]).length, 0);
  });

  test('flags "all/none of the above" and "both A and B" options but not a real "A and D"', () => {
    assert.ok(questionIssues(good({ options: ['SGLT2', 'GLUT4', 'GLUT2', 'SGLT1', 'None of the above'] })).includes('all-or-none-of-the-above'));
    assert.ok(questionIssues(good({ options: ['SGLT2', 'GLUT4', 'GLUT2', 'SGLT1', 'Both A and B'] })).includes('all-or-none-of-the-above'));
    assert.deepEqual(questionIssues(good({ options: ['Vitamins A and D', 'Vitamin K', 'Vitamin C', 'Vitamin B12', 'A and D'] })), []);
  });

  test('flags an answer that is spelled out in the stem', () => {
    const q = good({
      stem: 'Methotrexate was given to a leukemia patient. Which drug was given?',
      options: ['Methotrexate', 'Cisplatin', 'Vincristine', 'Imatinib', 'Rituximab'],
    });
    assert.ok(questionIssues(q).includes('answer-in-stem'));
  });

  test('flags an answer that is conspicuously longer than the distractors', () => {
    const q = good({
      options: ['Heart', 'Lung', 'Liver', 'Kidney', 'An extremely long and detailed answer that reads like the obvious one to pick'],
      correctIndex: 4,
    });
    assert.ok(questionIssues(q).includes('answer-is-conspicuously-long'));
  });

  test('flags a stem or explanation too thin to be a real question', () => {
    assert.ok(questionIssues(good({ stem: 'Why?' })).includes('stem-too-short'));
    assert.ok(questionIssues(good({ explanation: 'Yes.' })).includes('explanation-too-short'));
  });

  test('flags questions with fewer than four options', () => {
    assert.ok(questionIssues(good({ options: ['A1', 'B1', 'C1'] })).includes('too-few-options'));
  });

  test('drops the second of two questions that are the same question reworded', () => {
    const a = good();
    const b = good({ stem: 'A 54-year-old man has glucose in his urine at a plasma glucose of 220 mg/dL. Which transporter is saturated here?' });
    assert.equal(sanitizeQuestions([a, b]).length, 1);
  });

  test('clamps difficulty to 1-5 and tolerates a missing memory aid', () => {
    assert.equal(sanitizeQuestions([good({ difficulty: 9 })])[0].difficulty, 5);
    assert.equal(sanitizeQuestions([good({ difficulty: 0 })])[0].difficulty, 1);
    assert.equal(sanitizeQuestions([good({ memoryAid: undefined })])[0].memoryAid, '');
  });

  test('caps the length of every text field', () => {
    const [q] = sanitizeQuestions([good({ memoryAid: 'x'.repeat(2000), explanation: 'y'.repeat(9000) })]);
    assert.equal(q.memoryAid.length, 500);
    assert.equal(q.explanation.length, 2000);
  });
});

describe('excludeTopics', () => {
  const topics = [{ name: 'Glucose (slide 6)', cards: [] }, { name: 'Loop (slide 7)', cards: [] }];

  test('removes the named topics, ignoring case and spacing', () => {
    assert.deepEqual(excludeTopics(topics, [' glucose (SLIDE 6) ']).map((t) => t.name), ['Loop (slide 7)']);
  });

  test('ignores anything that is not a list of strings', () => {
    assert.equal(excludeTopics(topics, undefined).length, 2);
    assert.equal(excludeTopics(topics, 'Loop (slide 7)').length, 2);
    assert.equal(excludeTopics(topics, [null, 42, {}]).length, 2);
  });
});

describe('generateTopicQuestions', () => {
  // Genuinely different questions: the near-duplicate filter would (correctly) collapse stems that
  // differ by one word.
  const STEMS = [
    'A 54-year-old man with poorly controlled diabetes has glucose in his urine. Which transporter is saturated?',
    'A researcher blocks sodium reabsorption in the thick ascending limb of a rat nephron. What happens to urinary calcium excretion?',
    'A 30-year-old woman develops hearing loss after high-dose furosemide for pulmonary edema. Which structure is affected?',
  ];
  const reply = (n) =>
    JSON.stringify(
      Array.from({ length: n }, (_, i) => ({
        stem: STEMS[i],
        options: [`Mechanism one ${i}`, `Mechanism two ${i}`, `Mechanism three ${i}`, `Mechanism four ${i}`, `Mechanism five ${i}`],
        correctIndex: 0,
        explanation: 'The first mechanism is right because of the material.',
        memoryAid: 'A story.',
        difficulty: 3,
      }))
    );
  const fake = (...replies) => {
    const g = async () => {
      g.calls += 1;
      const next = replies[Math.min(g.calls - 1, replies.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    };
    g.calls = 0;
    return g;
  };

  test('returns a clean first reply without sampling again', async () => {
    const g = fake(reply(3));
    assert.equal((await generateTopicQuestions(g)).length, 3);
    assert.equal(g.calls, 1);
  });

  test('samples again after malformed JSON, which used to lose the whole topic', async () => {
    const g = fake('Sure! [{"stem": "oops" "options"', reply(2));
    assert.equal((await generateTopicQuestions(g)).length, 2);
    assert.equal(g.calls, 2);
  });

  test('samples again when nothing survives sanitising', async () => {
    const g = fake('[{"stem":"x"}]', reply(1));
    assert.equal((await generateTopicQuestions(g)).length, 1);
    assert.equal(g.calls, 2);
  });

  test('gives up with the parse error after two bad replies', async () => {
    const g = fake('nope', 'still nope');
    await assert.rejects(generateTopicQuestions(g), /parseable JSON/);
    assert.equal(g.calls, 2);
  });

  test('a provider failure propagates at once instead of being retried', async () => {
    const g = fake(new Error('All providers exhausted'), reply(3));
    await assert.rejects(generateTopicQuestions(g), /All providers exhausted/);
    assert.equal(g.calls, 1);
  });
});

describe('buildQuizPrompt (quality rules)', () => {
  const one = [{ question: 'What does X do?', answer: 'It does Y.' }];

  test('asks for exactly as many questions as the material supports', () => {
    assert.match(buildQuizPrompt('T', one, 'hard'), /exactly 1 object/);
    const nine = Array.from({ length: 9 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
    assert.match(buildQuizPrompt('T', nine, 'hard'), /exactly 5 objects/);
  });

  test('spells out the difficulty ratings to use, per mode', () => {
    const three = Array.from({ length: 3 }, () => one[0]);
    assert.match(buildQuizPrompt('T', three, 'hard'), /ratings in order: 2, 3, 5/);
    assert.match(buildQuizPrompt('T', three, 'easy'), /ratings in order: 1, 2, 3/);
  });

  test('scopes questions to the material but allows invented vignette framing', () => {
    const p = buildQuizPrompt('T', one, 'hard');
    assert.match(p, /do not introduce outside content/);
    assert.match(p, /may be invented to frame a question/);
  });

  test('requires plausible, same-category distractors and bans giveaways', () => {
    const p = buildQuizPrompt('T', one, 'hard');
    assert.match(p, /Never silly, absurd or self-contradictory options/);
    assert.match(p, /must not be the longest or most detailed option/);
    assert.match(p, /Never use "all of the above"/);
  });

  test('asks for a memory aid per question, and forbids passing off an invented mnemonic as famous', () => {
    const p = buildQuizPrompt('T', one, 'hard');
    assert.match(p, /"memoryAid"/);
    assert.match(p, /ONLY if you are certain it exists/);
    assert.match(p, /never present it as a famous or standard mnemonic/);
    assert.match(p, /never claim that a term "stands for" words it does not really stand for/);
  });

  test('tells the model to write fewer questions rather than pad', () => {
    assert.match(buildQuizPrompt('T', one, 'hard'), /Fewer sharp questions beat padding/);
  });

  test('includes card tables, which the answer text often summarises away', () => {
    const withTable = [{ question: 'Segments?', answer: 'See table.', table: { headers: ['Segment', 'Drug'], rows: [['TAL', 'Furosemide']] } }];
    const p = buildQuizPrompt('T', withTable, 'hard');
    assert.match(p, /Segment \| Drug/);
    assert.match(p, /TAL \| Furosemide/);
  });

  test('both modes keep the craft rules; only hard mode uses the vignette style examples', () => {
    const easy = buildQuizPrompt('T', one, 'easy');
    assert.match(easy, /QUESTION CRAFT/);
    assert.match(easy, /Do NOT write clinical vignettes/);
    assert.doesNotMatch(easy, /Practice Question #1/);
    assert.match(buildQuizPrompt('T', one, 'hard'), /Practice Question #1/);
  });
});
