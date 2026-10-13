import { otherDifficulty } from '../lib/quizSets';

const LABEL = { hard: 'Hard', easy: 'Easy' };

// The end-of-session debrief (also reachable mid-session): what went well, what to look at again
// with the memory tricks for the questions that were missed, and a short plan. All of it comes
// from getSessionSummary, so it appears instantly.
export default function QuizSummary({ summary, deckName, complete, difficulty, hasOtherSet, onBack, onExit, onSwitch, lockedIn }) {
  const other = otherDifficulty(difficulty);

  return (
    <div className="quiz-summary">
      <p className="eyebrow">{complete ? 'Quiz complete' : 'Session so far'}</p>
      <h2>{complete ? 'You finished this quiz' : deckName}</h2>
      {complete && <p className="muted">“{deckName}”, {LABEL[difficulty]} set</p>}

      {summary.attempted > 0 ? (
        <p className="summary-score">
          <span className="summary-percent">{summary.accuracy}%</span>
          <span className="muted">
            {summary.correct} right · {summary.wrong} wrong
          </span>
        </p>
      ) : (
        <p className="muted">No answers yet.</p>
      )}

      {summary.strengths.length > 0 && (
        <section className="summary-block">
          <h3>What went well</h3>
          <ul className="summary-list">
            {summary.strengths.map((s) => (
              <li key={s.name}>
                <span>{s.name}</span>
                <span className="muted small">
                  {s.accuracy}% · {s.correct}/{s.attempts}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.weaknesses.length > 0 && (
        <section className="summary-block">
          <h3>Needs another look</h3>
          {summary.weaknesses.map((w) => (
            <div className="summary-weak" key={w.name}>
              <p className="summary-weak-title">
                <strong>{w.name}</strong>
                <span className="muted small">
                  {w.wrong} missed of {w.attempts}
                </span>
              </p>
              {w.missed.map((m, i) => (
                <div className="summary-missed" key={i}>
                  <p>{m.stem}</p>
                  {m.memoryAid && (
                    <p className="memory-aid-text">
                      <span className="eyebrow">Remember it</span> {m.memoryAid}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      <section className="summary-block">
        <h3>Plan</h3>
        <ol className="summary-plan">
          {summary.plan.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </section>

      {(summary.skippedTopics > 0 || summary.omittedQuestions > 0) && (
        <p className="muted small">
          Left out of this quiz at your request:{' '}
          {[
            summary.skippedTopics > 0 && `${summary.skippedTopics} topic${summary.skippedTopics === 1 ? '' : 's'}`,
            summary.omittedQuestions > 0 && `${summary.omittedQuestions} question${summary.omittedQuestions === 1 ? '' : 's'}`,
          ]
            .filter(Boolean)
            .join(' and ')}
          . You can bring them back from the list on the left.
        </p>
      )}

      <div className="summary-actions">
        {!complete && (
          <button className="primary" onClick={onBack}>
            Back to questions
          </button>
        )}
        {complete && (
          <button className="ghost" onClick={() => onSwitch(other)}>
            {hasOtherSet ? `Go to the ${LABEL[other]} set` : `Try the ${LABEL[other]} set`}
          </button>
        )}
        {!lockedIn && (
          <button className={complete ? 'primary' : 'link'} onClick={onExit}>
            Back to decks
          </button>
        )}
      </div>
    </div>
  );
}
