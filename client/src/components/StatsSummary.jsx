import { useEffect, useState } from 'react';
import { loadAllQuizStates } from '../lib/db';
import { getStatsAcross } from '../lib/quizEngine';

export default function StatsSummary({ title = 'Quiz record' }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    loadAllQuizStates().then((states) => setStats(getStatsAcross(states)));
  }, []);

  if (!stats) {
    return (
      <section className="panel stats">
        <h2>{title}</h2>
        <div className="decks-loading">
          <span className="spinner" aria-hidden="true" />
          <span>Loading…</span>
        </div>
      </section>
    );
  }

  return (
    <section className="panel stats">
      <h2>{title}</h2>
      {stats.attempted === 0 ? (
        <p className="muted">Take a USMLE quiz on one of your decks and your accuracy shows up here.</p>
      ) : (
        <>
          <p className="stats-main">
            <span className="num stats-pct">
              {stats.accuracy}
              <small>%</small>
            </span>
            <span className="eyebrow">Accuracy</span>
          </p>
          <div
            className="stats-bar"
            role="img"
            aria-label={`${stats.correct} correct, ${stats.wrong} wrong`}
          >
            <span className="ok" style={{ flexGrow: stats.correct }} />
            <span className="bad" style={{ flexGrow: stats.wrong }} />
          </div>
          <dl className="stats-list">
            <div>
              <dt>Correct</dt>
              <dd>{stats.correct}</dd>
            </div>
            <div>
              <dt>Wrong</dt>
              <dd>{stats.wrong}</dd>
            </div>
            <div>
              <dt>Attempts</dt>
              <dd>{stats.attempted}</dd>
            </div>
            <div>
              <dt>Topics mastered</dt>
              <dd>
                {stats.topicsMastered} / {stats.topicsTotal}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
