import { useEffect, useRef, useState } from 'react';
import {
  initAnatomyState,
  getCurrentStep,
  recordResult,
  advance,
  getStats,
} from '../lib/anatomyEngine';
import { loadAnatomyProgress, saveAnatomyProgress } from '../lib/db';
import { recordActivity } from '../lib/streak';

// Occlusion box coordinates are normalized 0-1000 to the full image regardless of its
// rendered size, so this is a straight percentage conversion — no pixel measurement or
// ResizeObserver needed. A little padding is added on each side to tolerate a model box
// that's slightly off, without covering neighboring labels.
function occlusionStyle(box) {
  const [ymin, xmin, ymax, xmax] = box;
  const padY = (ymax - ymin) * 0.18;
  const padX = (xmax - xmin) * 0.18;
  const top = Math.max(0, ymin - padY);
  const left = Math.max(0, xmin - padX);
  const bottom = Math.min(1000, ymax + padY);
  const right = Math.min(1000, xmax + padX);
  return {
    top: `${top / 10}%`,
    left: `${left / 10}%`,
    width: `${(right - left) / 10}%`,
    height: `${(bottom - top) / 10}%`,
  };
}

export default function AnatomyStudyView({ deck, onExit }) {
  const [phase, setPhase] = useState('loading'); // loading | ready | complete
  const [quizState, setQuizState] = useState(null);
  const [guess, setGuess] = useState('');
  const [revealed, setRevealed] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap() {
    const saved = await loadAnatomyProgress(deck.id);
    const state = saved || initAnatomyState(deck.pages);
    setQuizState(state);
    setPhase(getCurrentStep(deck.pages, state) ? 'ready' : 'complete');
  }

  function handleReveal() {
    if (!guess.trim()) return;
    setRevealed(true);
  }

  function handleGrade(gotItRight) {
    const step = getCurrentStep(deck.pages, quizState);
    if (!step) return;
    recordActivity();
    recordResult(quizState, step.labelId, gotItRight);
    advance(deck.pages, quizState);
    void saveAnatomyProgress(deck.id, quizState);

    setGuess('');
    setRevealed(false);
    setQuizState({ ...quizState });
    setPhase(getCurrentStep(deck.pages, quizState) ? 'ready' : 'complete');
  }

  if (phase === 'loading') {
    return (
      <div className="panel study-panel">
        <span className="spinner" aria-hidden="true" />
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const stats = getStats(quizState);

  if (phase === 'complete') {
    return (
      <div className="panel study-panel">
        <h2>{deck.name}</h2>
        <p>
          You've gone through every structure in this quiz — {stats.correct} / {stats.attempted} right.
        </p>
        <button className="primary" onClick={onExit}>Back to anatomy quizzes</button>
      </div>
    );
  }

  const step = getCurrentStep(deck.pages, quizState);

  return (
    <div className="panel study-panel">
      <div className="study-header">
        <h2>{deck.name}</h2>
        <span className="muted">
          {step.stepNumber} / {step.totalSteps} · {stats.correct} correct, {stats.wrong} wrong
        </span>
      </div>

      <div className="occlusion-wrap">
        <img className="occlusion-image" src={step.page.image} alt={`Page ${step.page.page}`} />
        {!revealed && <div className="occlusion-box" style={occlusionStyle(step.label.box)} />}
      </div>

      {!revealed ? (
        <>
          <input
            type="text"
            className="occlusion-input"
            placeholder="What structure is highlighted?"
            value={guess}
            autoFocus
            onChange={(e) => setGuess(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleReveal()}
          />
          <button className="primary" disabled={!guess.trim()} onClick={handleReveal}>
            Reveal
          </button>
        </>
      ) : (
        <div className="occlusion-reveal">
          <p className="muted small">You typed:</p>
          <p className="occlusion-guess">{guess}</p>
          <p className="muted small">Correct label:</p>
          <p className="occlusion-answer">{step.label.label}</p>
          <div className="answer-actions">
            <button className="danger" onClick={() => handleGrade(false)}>Missed it</button>
            <button className="success" onClick={() => handleGrade(true)}>Got it</button>
          </div>
        </div>
      )}

      <button className="link" onClick={onExit}>Exit anatomy quiz</button>
    </div>
  );
}
