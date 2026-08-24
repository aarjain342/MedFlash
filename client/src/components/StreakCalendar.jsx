import { useMemo } from 'react';
import { getStreak, getWeekView } from '../lib/streak';

export default function StreakCalendar() {
  const streak = getStreak();
  const week = useMemo(() => getWeekView(), []);

  return (
    <div className="streak-calendar" title={streak > 0 ? `${streak}-day study streak` : 'No active streak yet'}>
      <div className="streak-calendar-count">
        <span aria-hidden="true">🔥</span>
        <span>{streak}</span>
        <span className="muted small">day{streak === 1 ? '' : 's'}</span>
      </div>
      <div className="streak-calendar-days">
        {week.map((d) => (
          <div
            key={d.date}
            className={`streak-day ${d.active ? 'active' : ''} ${d.isToday ? 'today' : ''}`}
            title={d.date}
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}
