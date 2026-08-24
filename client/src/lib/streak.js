// Lightweight day-streak tracker, Duolingo/Anki-style. Deliberately just localStorage —
// per-browser is fine for a motivational counter, doesn't need to sync across devices the
// way decks/quiz progress do.
const KEY = 'medflash-streak';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

// Call once per study/quiz action. No-ops after the first call of the day.
export function recordActivity() {
  const today = todayStr();
  const data = JSON.parse(localStorage.getItem(KEY) || 'null') || { lastDate: null, streak: 0 };
  if (data.lastDate === today) return;
  const gap = data.lastDate ? daysBetween(data.lastDate, today) : null;
  const streak = gap === 1 ? data.streak + 1 : 1;
  localStorage.setItem(KEY, JSON.stringify({ lastDate: today, streak }));
}

// Streak counts as "alive" through the day after last activity (so it doesn't reset the
// moment midnight passes) — only breaks once a full day is skipped entirely.
export function getStreak() {
  const data = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (!data) return 0;
  return daysBetween(data.lastDate, todayStr()) > 1 ? 0 : data.streak;
}
