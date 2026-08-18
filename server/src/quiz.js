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

export function buildQuizPrompt(topicName, cards) {
  const source = cards
    .slice(0, MAX_CARDS_PER_TOPIC_PROMPT)
    .map((c, i) => `${i + 1}. Q: ${c.question}\n   A: ${c.answer}`)
    .join('\n');

  return `You are a first-year medical school tutor writing board-style practice questions strictly scoped to a student's own study material for the topic "${topicName}". Do not introduce content, facts, or concepts outside this scope — every question must be answerable using only the material below.

Their flashcards for this topic:
"""
${source}
"""

STYLE AND DIFFICULTY — read carefully:
Below are five example questions showing the exact tone, structure, and reasoning depth to write in. These are style references ONLY — do not reuse their content, subject matter, or answer choices. Write entirely new questions grounded in the topic material above, matching this style:

"""
${STYLE_EXAMPLES}
"""

Notice what these examples have in common: every one of them is 2nd-order (apply a concept to a new situation) or 3rd-order (integrate multiple concepts, reason through a mechanism, or predict a consequence) — none of them is a bare definition or "what is X" recall question. Match that. Every question you write must require the student to apply, connect, or reason through the material, never just recite it back. Use a clinical vignette (a brief patient scenario with relevant history/exam/labs) wherever the topic allows one; where a pure vignette doesn't fit (e.g. a mechanism or lab-bench scenario like example #3), use an applied scenario instead — but never a bare recall question.

Write exactly 3 questions on this topic, in increasing difficulty on a 1-5 scale (e.g. roughly 2, 3, 5) — all three are 2nd/3rd-order as described above, never bare recall, but the first should require a single reasoning step from the material to the answer while the last should integrate multiple concepts or work through a multi-step clinical vignette (the kind that trips up strong students). Each of the 3 must test a genuinely different angle of the material (different fact, different scenario, different distractor set) — never near-duplicates of each other.

Each question needs exactly 5 answer options (A-E), only one correct, with 4 plausible distractors reflecting real classic exam confusions — not obviously wrong choices.

Return ONLY a JSON array (no markdown fences, no commentary) of exactly 3 objects shaped like:
{"difficulty": 1, "stem": "...", "options": ["...", "...", "...", "...", "..."], "correctIndex": 0, "explanation": "why the correct answer is right and, briefly, why each distractor is wrong"}`;
}
