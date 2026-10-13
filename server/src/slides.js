// The flashcard prompt for ONE slide/section of a lecture file. Lives in its own module (not
// index.js) so it can be unit-tested — importing index.js starts the server.

// Slides that carry nothing a student could be examined on. They used to become cards anyway
// ("Quote of the day" → a flashcard asking who said it), and those cards then fed the quiz,
// which wrote questions about them.
const SKIP_RULES = `Many slides teach nothing a student could be examined on. For those, return an empty array [] — do NOT make a card, even a small one. Skip:
- title / cover slides (course or lecture name, presenter names, affiliations, dates, logos)
- agenda, outline, "today's lecture" and learning-objective lists (the list itself, not the content it points to)
- quotes, jokes, cartoons, memes, inspirational or motivational slides, and "thought of the day" slides
- icebreakers, warm-ups, polls and "think about this" prompts that have no taught answer on the slide
- "Thank you", "Questions?", contact details, acknowledgements, disclaimers and conflict-of-interest slides
- references, citations, bibliographies and "further reading"
- housekeeping: announcements, exam dates, office hours, attendance, logistics
- section dividers and purely decorative images with no labels or content
- anecdotes, history-of-medicine trivia and other filler a student would not be expected to know for an exam

A slide that DOES teach something examinable (facts, mechanisms, definitions, classifications, drugs, anatomy, clinical features, tables, labeled diagrams) always gets cards, however briefly it is written. If a slide mixes filler with real content, make cards from the real content only. When you are unsure whether a slide has examinable content, make the card.`;

export function buildSlidePrompt(text, pageIndex, totalPages, hasImage) {
  const slideText = text || '(no extractable text on this slide)';
  const imageNote = hasImage
    ? '\nAn image of the slide is also attached — use it to read any diagrams, charts, labeled figures, or text that the extracted text above missed. If the slide is primarily a diagram/figure, base the flashcard(s) on what the image shows.'
    : '';
  return `You are making Anki-style flashcards for a first-year medical student, from ONE section of their study material (section ${pageIndex + 1} of ${totalPages}).

Section text:
"""
${slideText}
"""
${imageNote}

${SKIP_RULES}

Goal (for slides that do teach something): cover every topic and term mentioned on the slide, but consolidate related material into well-organized cards rather than splintering every minor point into its own card. Group things that belong together (e.g. a list of items with their properties becomes one card with a table; a multi-step process becomes one card walking through the steps) so a dense slide gets 2-3 cards and a light slide gets exactly 1.

For the "answer" of each card: it must explain the SAME material that's on the slide (don't invent new outside facts) — but written far more clearly than the slide's own wording, in plain approachable language a first-year med student can actually follow, as if a friend were explaining it well. Where it helps, use a short numbered/bulleted breakdown (plain text, one point per line, no markdown symbols like * or #).

For each card, also include:
- "table": if the slide content is naturally tabular (items mapped to properties/categories/destinations), fill this in as {"headers": [...], "rows": [[...], ...]}; otherwise set it to null. Don't force a table where a table isn't the natural shape of the content.
- "topic": a short tag (2-4 words) naming this slide's overall subject. Use the SAME tag on every card you make from this slide, so the cards stay grouped together.
- "mnemonic": a short, punchy memory trick, analogy, or acronym that makes this stick (e.g. "Think: protein + address label = correct destination", or an acronym expansion) — ONLY include one if something natural fits well; otherwise use an empty string. Don't force a corny one.

Write question/answer/mnemonic as plain text only, no markdown formatting.

Return ONLY a JSON array (no markdown fences, no commentary) of objects shaped like:
{"question": "...", "answer": "...", "table": {"headers": [...], "rows": [[...]]} | null, "mnemonic": "...", "topic": "short topic tag"}

If the slide has no examinable content, return exactly: []`;
}
