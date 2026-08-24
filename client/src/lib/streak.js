// Lightweight day-streak tracker, Duolingo/Anki-style. Deliberately just localStorage —
// per-browser is fine for a motivational counter, doesn't need to sync across devices the
// way decks/quiz progress do.
const KEY = 'medflash-streak';
const MAX_TRACKED_DAYS = 60; // caps activeDates growth; way more than any week view needs

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

function loadData() {
  const data = JSON.parse(localStorage.getItem(KEY) || 'null') || { lastDate: null, streak: 0 };
  // Backfill for data saved before activeDates existed — we only know about the most
  // recent active day at that point, earlier history was never recorded.
  if (!data.activeDates) data.activeDates = data.lastDate ? [data.lastDate] : [];
  return data;
}

// Call once per study/quiz action. No-ops after the first call of the day.
export function recordActivity() {
  const today = todayStr();
  const data = loadData();
  if (data.lastDate === today) return;
  const gap = data.lastDate ? daysBetween(data.lastDate, today) : null;
  const streak = gap === 1 ? data.streak + 1 : 1;
  const activeDates = [...data.activeDates, today].slice(-MAX_TRACKED_DAYS);
  localStorage.setItem(KEY, JSON.stringify({ lastDate: today, streak, activeDates }));
}

// Streak counts as "alive" through the day after last activity (so it doesn't reset the
// moment midnight passes) — only breaks once a full day is skipped entirely.
export function getStreak() {
  const data = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (!data) return 0;
  return daysBetween(data.lastDate, todayStr()) > 1 ? 0 : data.streak;
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Last 7 days (oldest first, today last) with which ones had recorded activity — powers
// the week-view calendar. Days before activeDates tracking existed just show as inactive,
// not an error — there's no way to know what actually happened before that.
export function getWeekView() {
  const data = loadData();
  const active = new Set(data.activeDates);
  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    days.push({ date: dateStr, label: DAY_LABELS[d.getDay()], active: active.has(dateStr), isToday: i === 0 });
  }
  return days;
}
