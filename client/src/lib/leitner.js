// Simple Leitner spaced-repetition system: 5 boxes, growing review intervals (days).
export const BOX_INTERVALS_DAYS = [0, 1, 3, 7, 14];
export const MAX_BOX = BOX_INTERVALS_DAYS.length;

export function initCardProgress() {
  return { box: 1, nextReview: Date.now() };
}

export function isDue(card) {
  return !card.nextReview || card.nextReview <= Date.now();
}

export function reviewCard(card, remembered) {
  const box = remembered ? Math.min((card.box || 1) + 1, MAX_BOX) : 1;
  const intervalDays = BOX_INTERVALS_DAYS[box - 1];
  const nextReview = Date.now() + intervalDays * 24 * 60 * 60 * 1000;
  return { ...card, box, nextReview };
}
