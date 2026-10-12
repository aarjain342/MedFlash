import { parseJsonArray } from './llm.js';

const MAX_CARDS_PER_TOPIC_PROMPT = 12;

// A quiz "topic" should be a chunk of material big enough to ask several different, worthwhile
// questions about. Cards are tagged per card, so a deck routinely came out as one topic per
// card (28 of 31 topics held a single card in a real test), and the quiz then had to invent
// three "different angles" on one flashcard, which is where the padded, repetitive and
// trivial questions came from. Topics are therefore built from whole slides, with thin
// neighbouring slides merged until there is enough to ask about.
// Only single-card slides are merged: a slide with two or more cards has enough to stand alone,
// and gluing it to whatever happens to follow would pair unrelated subjects.
const MIN_CARDS_PER_TOPIC = 2;
const MAX_MERGED_CARDS = 10;

// Client-supplied values, so every field is coerced rather than trusted to be a string —
// a non-string topic (object/array) used to throw here and take the whole process down.
function asText(value, max = 2000) {
  if (typeof value === 'string') return value.slice(0, max);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

// Tables carry facts the card's answer text often summarises away, so the quiz needs them.
function cleanTable(table) {
  if (!table || typeof table !== 'object') return null;
  if (!Array.isArray(table.headers) || !Array.isArray(table.rows)) return null;
  const headers = table.headers.slice(0, 12).map((h) => asText(h, 80).trim());
  const rows = table.rows
    .slice(0, 30)
    .map((row) => (Array.isArray(row) ? row.slice(0, 12).map((cell) => asText(cell, 120).trim()) : []))
    .filter((row) => row.length > 0);
  if (headers.length === 0 || rows.length === 0) return null;
  return { headers, rows };
}

function normalizeCard(card) {
  if (!card || typeof card !== 'object') return null;
  const question = asText(card.question);
  const answer = asText(card.answer);
  if (!question && !answer) return null;
  return {
    topic: asText(card.topic, 120).trim() || 'General',
    question,
    answer,
    table: cleanTable(card.table),
    page: Number.isInteger(card.page) && card.page > 0 ? card.page : null,
  };
}

// Groups a deck's flashcards by their topic tag. The fallback for decks whose cards carry no
// slide numbers; see groupCardsForQuiz for the normal path.
export function groupCardsByTopic(cards) {
  const byKey = new Map();
  if (!Array.isArray(cards)) return [];

  for (const raw of cards) {
    const card = normalizeCard(raw);
    if (!card) continue;
    const key = card.topic.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { name: card.topic, cards: [] });
    byKey.get(key).cards.push(card);
  }

  return [...byKey.values()];
}

// The tag shared by the most cards on a slide, else the first. (New decks tag every card from
// a slide identically; older decks tagged each card separately.)
function slideName(cards) {
  const counts = new Map();
  for (const c of cards) counts.set(c.topic, (counts.get(c.topic) || 0) + 1);
  let best = cards[0].topic;
  for (const [tag, n] of counts) if (n > counts.get(best)) best = tag;
  return best;
}

function slideLabel(first, last) {
  return first === last ? `slide ${first}` : `slides ${first}–${last}`;
}

// One quiz topic per slide (or run of thin slides), named with the slide numbers so every name
// is unique, which the quiz state relies on, and so a student can find the source.
export function groupCardsForQuiz(cards) {
  if (!Array.isArray(cards)) return [];
  const normalized = cards.map(normalizeCard).filter(Boolean);
  if (normalized.length === 0) return [];

  const paged = normalized.filter((c) => c.page != null).length;
  if (paged < normalized.length * 0.8) return groupCardsByTopic(cards);

  // The odd card without a slide number rides along with the card before it.
  let lastPage = normalized.find((c) => c.page != null).page;
  for (const c of normalized) {
    if (c.page == null) c.page = lastPage;
    else lastPage = c.page;
  }

  const bySlide = new Map();
  for (const c of normalized) {
    if (!bySlide.has(c.page)) bySlide.set(c.page, []);
    bySlide.get(c.page).push(c);
  }
  const slides = [...bySlide.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, group]) => ({ first: page, last: page, cards: group, base: slideName(group), lastBase: slideName(group) }));

  // Merge runs of thin slides into the slide that starts them.
  const merged = [];
  for (const slide of slides) {
    const open = merged[merged.length - 1];
    if (open && open.cards.length < MIN_CARDS_PER_TOPIC && open.cards.length + slide.cards.length <= MAX_MERGED_CARDS) {
      open.cards = open.cards.concat(slide.cards);
      open.last = slide.last;
      open.lastBase = slide.base;
    } else {
      merged.push({ ...slide });
    }
  }
  // A thin slide left over at the end folds back into the previous topic.
  if (merged.length >= 2) {
    const tail = merged[merged.length - 1];
    const before = merged[merged.length - 2];
    if (tail.cards.length < MIN_CARDS_PER_TOPIC && before.cards.length + tail.cards.length <= MAX_MERGED_CARDS) {
      before.cards = before.cards.concat(tail.cards);
      before.last = tail.last;
      before.lastBase = tail.base;
      merged.pop();
    }
  }

  // A very dense slide is split so no card is left out of the prompt.
  const topics = [];
  for (const group of merged) {
    const label = slideLabel(group.first, group.last);
    // A merged topic is named for what it actually holds, not just its first slide.
    const base = group.lastBase.toLowerCase() === group.base.toLowerCase() ? group.base : `${group.base} & ${group.lastBase}`;
    if (group.cards.length <= MAX_CARDS_PER_TOPIC_PROMPT) {
      topics.push({ name: `${base} (${label})`, cards: group.cards });
      continue;
    }
    const parts = Math.ceil(group.cards.length / MAX_CARDS_PER_TOPIC_PROMPT);
    const size = Math.ceil(group.cards.length / parts);
    for (let p = 0; p < parts; p++) {
      topics.push({ name: `${base} (${label}, part ${p + 1})`, cards: group.cards.slice(p * size, (p + 1) * size) });
    }
  }
  return topics;
}

// How many questions a topic's material can honestly support. Asking for a fixed three on a
// single flashcard forced the model to pad.
export function questionCountFor(cardCount) {
  if (cardCount <= 1) return 1;
  if (cardCount === 2) return 2;
  if (cardCount <= 4) return 3;
  if (cardCount <= 7) return 4;
  return 5;
}

const LADDERS = {
  hard: { 1: [3], 2: [2, 4], 3: [2, 3, 5], 4: [2, 3, 4, 5], 5: [2, 3, 3, 4, 5] },
  easy: { 1: [2], 2: [1, 3], 3: [1, 2, 3], 4: [1, 2, 2, 3], 5: [1, 1, 2, 3, 3] },
};

export function difficultyLadder(mode, count) {
  const ladders = LADDERS[mode === 'easy' ? 'easy' : 'hard'];
  return ladders[Math.min(5, Math.max(1, count))];
}

const OPTION_LABEL_PREFIX = /^[A-Ea-e][.):]\s*/;
const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function contentWords(text) {
  return new Set(normalize(text).split(' ').filter((w) => w.length > 3));
}

function similarity(a, b) {
  const A = contentWords(a);
  const B = contentWords(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / (A.size + B.size - shared);
}

function hasValidShape(q) {
  return (
    q &&
    typeof q.stem === 'string' && q.stem.trim().length > 0 &&
    Array.isArray(q.options) && q.options.length >= 2 &&
    q.options.every((o) => typeof o === 'string' && o.trim().length > 0) &&
    Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.options.length &&
    typeof q.explanation === 'string' && q.explanation.trim().length > 0
  );
}

// Flagrant craft problems that make a question unfair or pointless however it is presented.
// A question with any of these is dropped rather than shown. (Judgement calls, like how
// plausible the wrong answers are, are left to the prompt.) Expects options already cleaned.
export function questionIssues(q) {
  const issues = [];
  const options = q.options;
  if (options.length < 4) issues.push('too-few-options');
  if (new Set(options.map(normalize)).size !== options.length) issues.push('duplicate-options');
  if (options.some((o) => /^(all|none) of the above\.?$/i.test(o.trim()) || /^both [a-e] and [a-e]\.?$/i.test(o.trim()))) {
    issues.push('all-or-none-of-the-above');
  }
  if (q.stem.trim().length < 20) issues.push('stem-too-short');
  if (q.explanation.trim().length < 15) issues.push('explanation-too-short');

  const correct = options[q.correctIndex];
  const others = options.filter((_, i) => i !== q.correctIndex);
  const meanOther = others.reduce((sum, o) => sum + o.length, 0) / Math.max(1, others.length);
  if (correct.length > 60 && correct.length >= 2.5 * meanOther) issues.push('answer-is-conspicuously-long');
  // The answer spelled out in the question, e.g. a stem that says "methotrexate" for an answer of "Methotrexate".
  if (normalize(correct).length >= 6 && normalize(q.stem).includes(normalize(correct))) issues.push('answer-in-stem');
  return issues;
}

// Drops any question the model returned in a malformed shape (missing/wrong-type fields,
// an out-of-range correctIndex, etc.) or with a flagrant craft problem, instead of letting it
// crash rendering downstream — malformed output happens more often once the fallback chain
// reaches less strictly-instructed models. Also strips stray "A. "/"B) " style labels some
// models add to option text despite being told not to — those become actively misleading once
// options get shuffled client-side.
export function sanitizeQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  const kept = [];

  for (const q of questions.filter(hasValidShape)) {
    const cleaned = {
      stem: q.stem.trim().slice(0, 1500),
      options: q.options.map((o) => o.replace(OPTION_LABEL_PREFIX, '').trim().slice(0, 300)),
      correctIndex: q.correctIndex,
      explanation: q.explanation.trim().slice(0, 2000),
      memoryAid: asText(q.memoryAid, 500).trim(),
      difficulty: Number.isFinite(q.difficulty) ? Math.min(5, Math.max(1, Math.round(q.difficulty))) : 3,
    };
    if (questionIssues(cleaned).length > 0) continue;
    // Two questions on one topic that are the same question in different words.
    if (kept.some((other) => similarity(other.stem, cleaned.stem) > 0.7)) continue;
    kept.push(cleaned);
  }
  return kept;
}

// Removes the topics a student asked the quiz to skip. Names come from the client, so they are
// coerced and capped; anything that isn't a string is ignored.
export function excludeTopics(topics, names) {
  if (!Array.isArray(names) || names.length === 0) return topics;
  const skipped = new Set(names.slice(0, 1000).filter((n) => typeof n === 'string').map((n) => n.trim().toLowerCase()));
  return topics.filter((t) => !skipped.has(t.name.trim().toLowerCase()));
}

// One topic's worth of questions. `generate` returns the model's raw reply (it already walks
// the provider chain, so an error from it means every provider failed and sampling again would
// only repeat that — those propagate at once). What is retried is a reply that can't be used:
// malformed JSON (2 of 31 topics in a real test, with no retry) or nothing that survives
// sanitising. A second sample almost always recovers the topic.
export async function generateTopicQuestions(generate, maxAttempts = 2) {
  let best = [];
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = await generate();
    try {
      const questions = sanitizeQuestions(parseJsonArray(raw));
      if (questions.length > best.length) best = questions;
      if (best.length > 0) break;
    } catch (err) {
      lastError = err;
    }
  }

  if (best.length === 0) throw lastError || new Error('Model returned no valid questions for this topic');
  return best;
}

const STYLE_EXAMPLES = `Practice Question #1
Methotrexate is often used as a chemotherapeutic agent to treat patients with leukemia. It inhibits the synthesis of deoxythymidine by preventing regeneration of THF by inhibiting the enzyme DHFR. Which of the following checkpoints becomes dysfunctional and prevents cell cycle progression with methotrexate?
A. Cyclin D/CDK4
B. Cyclin E/CDK2
C. Cyclin A/CDK2
D. Cyclin B/CDK1
E. Cyclin C/CDK8

Practice Question #2
A 6-year-old girl presented with painless lumps, swelling, bone pain, and limited limb movement. The girl was diagnosed with soft tissue and bone sarcomas. After a genetic test, a mutation in a tumor suppressor gene was identified, leading to the diagnosis of a rare genetic disorder. This tumor suppressor gene is the most commonly mutated gene across all types of cancer. Which of the following biological functions of this gene's protein product is lost in this patient?
A. Acceleration of senescence
B. Initiation of autophagy
C. Inhibition of necrosis
D. Activation of pro-apoptotic proteins
E. Inactivation of the G2/M checkpoint

Practice Question #3
A researcher is developing a new drug that boosts autophagy in cancer treatment. Which of the following proteins does the new drug need to inhibit?
A. AMPK
B. mTORC1
C. AKT
D. PI3K
E. ULK1

Practice Question #4
A bodybuilder successfully increased the size of the biceps and quadriceps after months of strenuous training. What is the cause of the increase in size of these muscles?
A. The number of skeletal muscle fibers increased by mitosis.
B. The number of adipose cells increased by mitosis.
C. Increased autophagy cleaned up the muscle cells and regenerated the muscle fibers.
D. Apoptosis removed senescent muscle fibers and stimulated regeneration of muscle fibers.
E. Each muscle fiber increased in volume by adding structural proteins without cell division.

Practice Question #5
A 2-year-old boy presented with painless lumps and swelling of the testicle. A scrotal ultrasound and biopsy showed multi-tissue structures including hair and tiny teeth, and a blood test checked tumor markers, leading to the diagnosis. The tumor was benign and removed by surgery. What is the origin of the tumor?
A. Epidermal stem cells
B. Pluripotent germ cells
C. Hematopoietic stem cells
D. Mesenchymal stem cells
E. Tendon stem cells`;

const SCOPE = `SCOPE — read carefully:
- Every question must test a fact, mechanism or relationship that is stated in the student's material above. Do not test anything the material does not cover, and do not introduce outside content.
- Vignette details (patient age, sex, presentation, vitals, lab values) may be invented to frame a question, but the thing being tested, and the reasoning that gets to the answer, must come from the material, never from outside knowledge.
- Aim for deep understanding: test WHY and HOW (mechanisms, cause and effect, what changes when something is altered, what distinguishes two similar things), and bring different parts of the material together where they connect. Between them, the questions should cover the material's most examinable ideas. Never spend two questions on the same fact in different clothes.
- Leave out trivia no exam would ask (who discovered something, dates, anecdotes, decorative detail). Fewer sharp questions beat padding.`;

const CRAFT = `QUESTION CRAFT — apply to every question:
1. The stem ends in a clear question the student could answer BEFORE reading the options. Include only the details that are needed.
2. Exactly 5 options (A-E) and exactly one best answer, which the material clearly supports.
3. The 4 wrong options must tempt someone who half-knows the material: the same kind of thing as the right answer (all mechanisms, or all structures, or all drugs, or all values), similar in length and grammatical form, and drawn from real confusions: a related structure, the opposite effect, a look-alike term, the step before or after. Never silly, absurd or self-contradictory options. The right answer must not be the longest or most detailed option.
4. Never use "all of the above", "none of the above" or "both A and B", and avoid "always" and "never". Do not repeat the answer's own words in the stem.
5. No trick questions, and nothing that depends on a number or detail the stem does not give.
6. "explanation": begin with why the right answer is right, in terms of the material (1-2 sentences), then give one short clause on why each wrong option is wrong.
7. "memoryAid": a short, vivid way to remember what this question tests, shown to the student when they get it wrong. Prefer a genuine, widely used mnemonic, but ONLY if you are certain it exists and is correct (say what it stands for). Otherwise write a brief funny or visual story or analogy (1-2 sentences) that locks in the key fact. Frame anything you invent as a picture or story ("Picture...", "Think of..."), never present it as a famous or standard mnemonic, and never claim that a term "stands for" words it does not really stand for. Never put anything inaccurate in it.`;

const DIFFICULTY_SECTIONS = {
  hard: (count, ladder) => `STYLE AND DIFFICULTY — read carefully:
Below are five example questions showing the exact tone, structure, and reasoning depth to write in. These are style references ONLY — do not reuse their content, subject matter, or answer choices. Write entirely new questions grounded in the topic material above, matching this style:

"""
${STYLE_EXAMPLES}
"""

Notice what these examples have in common: every one of them is 2nd-order (apply a concept to a new situation) or 3rd-order (integrate multiple concepts, reason through a mechanism, or predict a consequence) — none of them is a bare definition or "what is X" recall question. Match that. Every question you write must require the student to apply, connect, or reason through the material, never just recite it back. Use a clinical vignette (a brief patient scenario with relevant history/exam/labs) wherever the topic allows one; where a pure vignette doesn't fit (e.g. a mechanism or lab-bench scenario like example #3), use an applied scenario instead — but never a bare recall question. Do not use negatively worded stems (NOT / EXCEPT).

Write exactly ${count} question${count === 1 ? '' : 's'} on this topic, in increasing difficulty with these 1-5 ratings in order: ${ladder.join(', ')}. All are 2nd/3rd-order as described above, never bare recall: the easiest needs a single reasoning step from the material to the answer, the hardest integrates multiple concepts or works through a multi-step clinical vignette (the kind that trips up strong students). Each must test a genuinely different angle of the material (a different fact, a different scenario, a different set of distractors).`,
  easy: (count, ladder) => `STYLE AND DIFFICULTY — read carefully:
This is EASY mode: the student is still learning the basics — vocabulary, definitions, core facts, and the overall shape of the material — not clinical application yet. Write straightforward 1st-order questions: "what is X," "which of the following describes X," "which term matches this definition," matching terms to functions, identifying the correct step in a sequence, etc. Do NOT write clinical vignettes, patient scenarios, or multi-concept integration — that's a different mode. Every question should be answerable directly from a single fact or definition in the material, without needing to apply it to a new situation.

Write exactly ${count} question${count === 1 ? '' : 's'} on this topic, in increasing difficulty with these 1-5 ratings in order: ${ladder.join(', ')}. All stay basic/recall-level as described above, but the first should be the most direct (near-verbatim definition/fact recall) while the last can require connecting two related basic facts (e.g. "which of these is NOT true about X" or ordering steps in a process). Each must test a genuinely different fact or term.`,
};

function formatCard(card, index) {
  let text = `${index + 1}. Q: ${card.question}\n   A: ${card.answer}`;
  if (card.table) {
    const rows = [card.table.headers, ...card.table.rows].map((row) => `      ${row.join(' | ')}`);
    text += `\n   Table:\n${rows.join('\n')}`;
  }
  return text;
}

export function buildQuizPrompt(topicName, cards, difficulty = 'hard') {
  const mode = difficulty === 'easy' ? 'easy' : 'hard';
  const used = cards.slice(0, MAX_CARDS_PER_TOPIC_PROMPT);
  const count = questionCountFor(used.length);
  const ladder = difficultyLadder(mode, count);
  const source = used.map(formatCard).join('\n');

  return `You are a first-year medical school tutor writing board-style practice questions for ONE topic, "${topicName}", strictly scoped to the student's own study material.

The student's material for this topic (their flashcards, with any tables):
"""
${source}
"""

${SCOPE}

${DIFFICULTY_SECTIONS[mode](count, ladder)}

${CRAFT}

Return ONLY a JSON array (no markdown fences, no commentary) of exactly ${count} object${count === 1 ? '' : 's'}, in order of the difficulty ratings above, each shaped like:
{"difficulty": 1, "stem": "...", "options": ["...", "...", "...", "...", "..."], "correctIndex": 0, "explanation": "...", "memoryAid": "..."}`;
}
