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

const CROP_PADDING_FRACTION = 0.12; // margin around the tightest box containing the crop target
const MIN_CROP_SIZE = 260; // out of 1000 — a floor so a small/tight target doesn't zoom in absurdly tight
const OUTLIER_TRIM_FRACTION = 0.08; // fallback path only — see getPageCrop

function padAndClampCrop(ymin, xmin, ymax, xmax) {
  const padY = Math.max((ymax - ymin) * CROP_PADDING_FRACTION, 20);
  const padX = Math.max((xmax - xmin) * CROP_PADDING_FRACTION, 20);
  let cy0 = Math.max(0, ymin - padY);
  let cx0 = Math.max(0, xmin - padX);
  let cy1 = Math.min(1000, ymax + padY);
  let cx1 = Math.min(1000, xmax + padX);

  if (cy1 - cy0 < MIN_CROP_SIZE) {
    const mid = (cy0 + cy1) / 2;
    cy0 = Math.max(0, Math.min(1000 - MIN_CROP_SIZE, mid - MIN_CROP_SIZE / 2));
    cy1 = cy0 + MIN_CROP_SIZE;
  }
  if (cx1 - cx0 < MIN_CROP_SIZE) {
    const mid = (cx0 + cx1) / 2;
    cx0 = Math.max(0, Math.min(1000 - MIN_CROP_SIZE, mid - MIN_CROP_SIZE / 2));
    cx1 = cx0 + MIN_CROP_SIZE;
  }

  return [cy0, cx0, cy1, cx1];
}

// Trimmed min/max: ignores the most extreme ~8% of values on each side (only once there
// are enough values to do that safely) before taking the extent. Used only as a fallback
// (see below) to resist a single wildly mispositioned label without needing to know which
// one is bad.
function trimmedExtent(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n <= 4) return [sorted[0], sorted[n - 1]];
  const k = Math.floor(n * OUTLIER_TRIM_FRACTION);
  return [sorted[k], sorted[n - 1 - k]];
}

// A source PDF page is rendered whole (title/branding chrome included), but a page's
// actual diagram is often only a small region of it — a title-slide layout with one small
// inset photo, say. Showing the whole page makes that inset the size of a postage stamp.
// This crops the display to the diagram itself instead, so it — not the surrounding page —
// is what fills the frame. Held fixed while stepping through a page's labels, so the
// framing doesn't jump around and every other label stays visible for context, matching
// the existing one-hidden-label-at-a-time design.
//
// Prefers `page.diagrams` — each photo/diagram's own bounding box, asked for directly from
// the model (server/src/anatomy.js) rather than inferred from labels. This is the reliable
// path: a single mislabeled or hallucinated label box can't drag the frame open, because
// labels aren't involved in computing it at all.
//
// Falls back to a trimmed union of label boxes for decks saved before diagram regions were
// tracked. This is inherently less reliable — confirmed in practice: a page's crop was
// dragged wide open by what was almost certainly one wayward label box — so the trim
// exists specifically to blunt that failure mode for already-saved decks that can't be
// re-processed without a re-upload, not because it's as trustworthy as the diagrams path.
export function getPageCrop(page) {
  const diagrams = page?.diagrams;
  if (diagrams && diagrams.length > 0) {
    let ymin = 1000, xmin = 1000, ymax = 0, xmax = 0;
    for (const [by0, bx0, by1, bx1] of diagrams) {
      ymin = Math.min(ymin, by0);
      xmin = Math.min(xmin, bx0);
      ymax = Math.max(ymax, by1);
      xmax = Math.max(xmax, bx1);
    }
    return padAndClampCrop(ymin, xmin, ymax, xmax);
  }

  const labels = page?.labels;
  if (!labels || labels.length === 0) return [0, 0, 1000, 1000];

  const [ymin] = trimmedExtent(labels.map((l) => l.box[0]));
  const [xmin] = trimmedExtent(labels.map((l) => l.box[1]));
  const [, ymax] = trimmedExtent(labels.map((l) => l.box[2]));
  const [, xmax] = trimmedExtent(labels.map((l) => l.box[3]));
  return padAndClampCrop(ymin, xmin, ymax, xmax);
}
