import { useMemo } from 'react';
import { getActivitySummary } from '../lib/streak';

// Answered cards per day over the last 17 weeks, GitHub-style, plus streak figures. History
// starts when this version first ran on the device, so a new account is honestly empty.
export default function ActivityHeatmap() {
  const summary = useMemo(() => getActivitySummary(), []);
  const { cells, streak, best, answered, activeDays, weeks } = summary;

  return (
    <section className="panel activity">
      <div className="panel-head">
        <h2>Activity</h2>
        <p className="muted small">Last {weeks} weeks</p>
      </div>

      <dl className="activity-figures">
        <div>
          <dt className="eyebrow">Day streak</dt>
          <dd className="num">{streak}</dd>
        </div>
        <div>
          <dt className="eyebrow">Best streak</dt>
          <dd className="num">{best}</dd>
        </div>
        <div>
          <dt className="eyebrow">Answered</dt>
          <dd className="num">{answered}</dd>
        </div>
      </dl>

      <div
        className="heatmap"
        style={{ '--weeks': weeks }}
        role="img"
        aria-label={`${activeDays} active days and ${answered} answers in the last ${weeks} weeks`}
      >
        {cells.map((cell) => (
          <span
            key={cell.date}
            className="heat"
            data-level={cell.level}
            data-future={cell.future || undefined}
            data-today={cell.isToday || undefined}
            title={cell.future ? undefined : `${cell.date}: ${cell.count} answered`}
          />
        ))}
      </div>

      <div className="heat-legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i key={level} className="heat" data-level={level} />
        ))}
        <span>More</span>
      </div>
    </section>
  );
}
