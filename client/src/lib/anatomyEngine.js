// Anatomy Quiz engine: a linear walk through every label on every page, in order. Much
// simpler than quizEngine.js's topic-rotation/mastery loop — this runs once through the
// whole uploaded document, one label at a time, not an adaptive re-drill.
//
// Grading is a self-report (see AnatomyStudyView: type an answer, reveal the real label,
// tap "Got it"/"Missed it" yourself), the same interaction StudyView's Leitner flip uses —
// not an auto-graded string comparison. Anatomical terms have too much legitimate wording
// variation (singular/plural, abbreviations) for a string/fuzzy match to be reliable, and
// the user seeing the real label right next to what they typed is a better judge of "right"
// than any string comparison would be.

// Flattens pages into an ordered list of steps. Recomputed from `pages` on every call
// rather than stored in state — pages/labels are static once a deck exists (only ever
// written once, at upload time), so keeping this derivation out of the persisted state
// keeps the saved progress blob tiny regardless of how many labels the deck has.
export function buildSteps(pages) {
  const steps = [];
  (pages || []).forEach((page, pageIndex) => {
    (page.labels || []).forEach((label, labelIndex) => {
      steps.push({ pageIndex, labelIndex, labelId: label.id });
    });
  });
  return steps;
}

export function initAnatomyState(pages) {
  const steps = buildSteps(pages);
  return { cursor: 0, results: {}, complete: steps.length === 0 };
}

// The current step to render, or null once every label has been gone through.
// { pageIndex, labelIndex, labelId, page, label, stepNumber, totalSteps }
export function getCurrentStep(pages, state) {
  const steps = buildSteps(pages);
  if (!state || state.cursor >= steps.length) return null;
  const step = steps[state.cursor];
  const page = pages[step.pageIndex];
  const label = page?.labels?.[step.labelIndex];
  if (!page || !label) return null;
  return { ...step, page, label, stepNumber: state.cursor + 1, totalSteps: steps.length };
}

// Records the user's own self-graded verdict for the label they just revealed. Mutates
// `state` in place, mirroring quizEngine.js's mutate-then-persist pattern.
export function recordResult(state, labelId, gotItRight) {
  state.results[labelId] = !!gotItRight;
}

export function advance(pages, state) {
  const steps = buildSteps(pages);
  state.cursor += 1;
  state.complete = state.cursor >= steps.length;
}

// Running right/wrong counts for the score display.
export function getStats(state) {
  const values = Object.values(state?.results || {});
  const correct = values.filter(Boolean).length;
  return { correct, wrong: values.length - correct, attempted: values.length };
}
