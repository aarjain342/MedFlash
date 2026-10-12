// Day-streak and activity tracker. Deliberately just localStorage: per-browser is fine for a
// motivational counter, and it doesn't need to sync across devices the way decks do.
//
// Stored shape: { lastDate, streak, activeDates: [...], counts: { 'YYYY-MM-DD': n } }
// `counts` is how many answers were recorded that day (it drives the heatmap's intensity);
// `activeDates` is the list of days with any activity (it drives the streak).
const KEY = 'medflash-streak';
const MAX_TRACKED_DAYS = 400; // a bit over a year, far more than the heatmap shows

const pad = (n) => String(n).padStart(2, '0');

// Local calendar date, not UTC: a session at 9pm should count as today, not tomorrow.
export function localDateStr(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

function loadData() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    data = null; // corrupt or blocked storage: start fresh rather than break the page
  }
  data = data || { lastDate: null, streak: 0 };
  // Backfill for data saved before activeDates existed: only the latest active day is known.
  if (!data.activeDates) data.activeDates = data.lastDate ? [data.lastDate] : [];
  // And for data saved before per-day counts existed: every known active day counts as one.
  if (!data.counts) data.counts = Object.fromEntries(data.activeDates.map((d) => [d, 1]));
  return data;
}

function saveData(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Not persisted (private window / quota): the streak just won't survive this session.
  }
}

// Call once per answered card/question. Counts every call; the streak only advances on the
// first call of a day.
export function recordActivity(now = new Date()) {
  const today = localDateStr(now);
  const data = loadData();
  data.counts[today] = (data.counts[today] || 0) + 1;

  if (data.lastDate !== today) {
    const gap = data.lastDate ? daysBetween(data.lastDate, today) : null;
    data.streak = gap === 1 ? data.streak + 1 : 1;
    data.lastDate = today;
    data.activeDates = [...data.activeDates, today];
  }

  data.activeDates = data.activeDates.slice(-MAX_TRACKED_DAYS);
  const keep = new Set(data.activeDates);
  data.counts = Object.fromEntries(Object.entries(data.counts).filter(([d]) => keep.has(d)));
  saveData(data);
}

// A streak is still alive through the day after the last activity (so it doesn't reset the
// moment midnight passes) and only breaks once a full day is skipped.
export function getStreak(now = new Date()) {
  const data = loadData();
  if (!data.lastDate) return 0;
  return daysBetween(data.lastDate, localDateStr(now)) > 1 ? 0 : data.streak;
}

// 0 = nothing, 4 = a heavy day. Thresholds are in answered cards.
export function levelFor(count) {
  if (!count) return 0;
  if (count < 5) return 1;
  if (count < 15) return 2;
  if (count < 30) return 3;
  return 4;
}

// The heatmap: `weeks` columns of 7 days (Sunday first), the last column containing today.
// Returned in column order, one entry per day; days after today are flagged `future`.
export function buildActivityGrid(counts, today = new Date(), weeks = 17) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - end.getDay() - (weeks - 1) * 7);
  const todayStr = localDateStr(end);

  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const date = localDateStr(day);
    const future = day > end;
    const count = counts[date] || 0;
    cells.push({ date, count, level: future ? 0 : levelFor(count), future, isToday: date === todayStr });
  }
  return cells;
}

// Longest run of consecutive days in a list of 'YYYY-MM-DD' strings.
export function longestRun(dates) {
  const sorted = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  sorted.forEach((date, i) => {
    run = i > 0 && daysBetween(sorted[i - 1], date) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

export function getActivitySummary(now = new Date(), weeks = 17) {
  const data = loadData();
  const cells = buildActivityGrid(data.counts, now, weeks);
  const shown = cells.filter((c) => !c.future);
  return {
    cells,
    streak: getStreak(now),
    best: longestRun(data.activeDates),
    activeDays: shown.filter((c) => c.count > 0).length,
    answered: shown.reduce((sum, c) => sum + c.count, 0),
    weeks,
  };
}
