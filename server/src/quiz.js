const MAX_CARDS_PER_TOPIC_PROMPT = 10;

// Groups a deck's flashcards by their topic tag so one quiz-question generation call
// can cover a whole topic's material at once, instead of one call per card.
export function groupCardsByTopic(cards) {
  const byKey = new Map();

  for (const card of cards) {
    const name = (card.topic || '').trim() || 'General';
    const key = name.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { name, cards: [] });
    byKey.get(key).cards.push(card);
  }

  return [...byKey.values()];
}

export function buildQuizPrompt(topicName, cards) {
  const source = cards
    .slice(0, MAX_CARDS_PER_TOPIC_PROMPT)
    .map((c, i) => `${i + 1}. Q: ${c.question}\n   A: ${c.answer}`)
    .join('\n');

  return `You are writing USMLE Step 1-style board exam questions for a first-year medical student, based on their own study material for the topic "${topicName}".

Their flashcards for this topic:
"""
${source}
"""

Write exactly 5 multiple-choice questions on this topic, one at each difficulty level 1 through 5 (1 = a straightforward recall/definition question, 5 = a hard, multi-step clinical vignette requiring integration of several concepts — the kind that trips up strong students). Each question must be answerable using only the material above; don't test facts that aren't covered by these flashcards.

Write them in classic USMLE style: level 1-2 can be direct, but level 3-5 should be a brief clinical vignette (a patient scenario with relevant history/exam/labs) that requires reasoning to the answer, not just fact recall.

Each question needs exactly 4 answer options, only one correct, with 3 plausible distractors (real classic exam confusions, not obviously wrong).

Return ONLY a JSON array (no markdown fences, no commentary) of exactly 5 objects shaped like:
{"difficulty": 1, "stem": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "explanation": "why the correct answer is right and, briefly, why each distractor is wrong"}`;
}
