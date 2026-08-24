import { useEffect, useState } from 'react';
import { loadAllQuizStates } from '../lib/db';
import { getStatsAcross } from '../lib/quizEngine';
import StreakCalendar from './StreakCalendar';

function AccuracyRing({ percent }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const filled = ((percent || 0) / 100) * c;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={`${percent ?? 0}% accuracy`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--border)" strokeWidth="14" />
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c - filled}`}
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="66" textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--text)">
        {percent == null ? '—' : `${percent}%`}
      </text>
      <text x="70" y="86" textAnchor="middle" fontSize="12" fill="var(--muted)">
        accuracy
      </text>
    </svg>
  );
}

export default function StatsSummary({ title = 'Your stats' }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    loadAllQuizStates().then((states) => setStats(getStatsAcross(states)));
  }, []);

  if (!stats) {
    return (
      <div className="panel">
        <div className="stats-panel-header">
          <h2>{title}</h2>
          <StreakCalendar />
        </div>
        <div className="decks-loading">
          <span className="spinner" aria-hidden="true" />
          <span className="muted">Loading your stats…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="panel stats-panel">
      <div className="stats-panel-header">
        <h2>{title}</h2>
        <StreakCalendar />
      </div>
      {stats.attempted === 0 ? (
        <p className="muted">Take a USMLE quiz on one of your decks to start building stats here.</p>
      ) : (
        <div className="stats-grid">
          <div className="stats-donut-card">
            <AccuracyRing percent={stats.accuracy} />
          </div>
          <div className="stats-numbers">
            <div className="stat-row">
              <span className="stat-dot correct" aria-hidden="true" />
              <span>Correct answers</span>
              <strong>{stats.correct}</strong>
            </div>
            <div className="stat-row">
              <span className="stat-dot wrong" aria-hidden="true" />
              <span>Wrong answers</span>
              <strong>{stats.wrong}</strong>
            </div>
            <div className="stat-row">
              <span className="stat-dot" aria-hidden="true" />
              <span>Total attempts</span>
              <strong>{stats.attempted}</strong>
            </div>
            <div className="stat-row">
              <span className="stat-dot mastered" aria-hidden="true" />
              <span>Topics mastered</span>
              <strong>{stats.topicsMastered} / {stats.topicsTotal}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
