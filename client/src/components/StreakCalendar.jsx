import { useMemo } from 'react';
import { getStreak, getWeekView } from '../lib/streak';

export default function StreakCalendar() {
  const streak = getStreak();
  const week = useMemo(() => getWeekView(), []);
  const activeThisWeek = week.filter((d) => d.active).length;

  return (
    <div className="panel streak-panel">
      <div className="streak-panel-header">
        <h2>Study streak</h2>
        <div className="streak-panel-count">
          <span aria-hidden="true">🔥</span>
          <span>{streak}</span>
          <span className="muted small">day{streak === 1 ? '' : 's'}</span>
        </div>
      </div>
      <p className="muted small">
        {activeThisWeek === 0
          ? 'No study activity yet this week — start a deck or quiz to begin your streak.'
          : `${activeThisWeek} of the last 7 days active.`}
      </p>
      <div className="streak-week">
        {week.map((d) => (
          <div key={d.date} className={`streak-week-day ${d.active ? 'active' : ''} ${d.isToday ? 'today' : ''}`}>
            <span className="streak-week-day-label">{d.label}</span>
            <span className="streak-week-day-dot" aria-hidden="true" />
          </div>
        ))}
      </div>
    </div>
  );
}
