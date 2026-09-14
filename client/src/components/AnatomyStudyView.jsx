import { useEffect, useMemo, useRef, useState } from 'react';
import {
  initAnatomyState,
  getCurrentStep,
  recordResult,
  advance,
  getStats,
  getPageCrop,
} from '../lib/anatomyEngine';
import { loadAnatomyProgress, saveAnatomyProgress } from '../lib/db';
import { recordActivity } from '../lib/streak';

// A source PDF page is rendered whole (title/branding chrome included), but the actual
// diagram is often only a small region of it — getPageCrop (anatomyEngine.js) picks the
// region that contains every label on the page, so a small inset diagram on an otherwise
// mostly-empty page fills the frame instead of rendering as a postage stamp. Both the
// image and each label's occlusion box are then expressed as percentages of that cropped
// region rather than the full 0-1000 page — still no pixel measurement or ResizeObserver
// needed, just one more layer of the same percentage math.
function cropImageStyle(crop) {
  const [cy0, cx0, cy1, cx1] = crop;
  const cropW = cx1 - cx0;
  const cropH = cy1 - cy0;
  return {
    width: `${(1000 / cropW) * 100}%`,
    height: `${(1000 / cropH) * 100}%`,
    left: `${-(cx0 / cropW) * 100}%`,
    top: `${-(cy0 / cropH) * 100}%`,
  };
}

// A little padding is added around each label's own box to tolerate a model box that's
// slightly off, without covering neighboring labels.
function occlusionStyle(box, crop) {
  const [cy0, cx0, cy1, cx1] = crop;
  const cropW = cx1 - cx0;
  const cropH = cy1 - cy0;
  const [ymin, xmin, ymax, xmax] = box;
  const padY = (ymax - ymin) * 0.18;
  const padX = (xmax - xmin) * 0.18;
  const top = Math.max(cy0, ymin - padY);
  const left = Math.max(cx0, xmin - padX);
  const bottom = Math.min(cy1, ymax + padY);
  const right = Math.min(cx1, xmax + padX);
  return {
    top: `${((top - cy0) / cropH) * 100}%`,
    left: `${((left - cx0) / cropW) * 100}%`,
    width: `${((right - left) / cropW) * 100}%`,
    height: `${((bottom - top) / cropH) * 100}%`,
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

  const step = phase === 'loading' ? null : getCurrentStep(deck.pages, quizState);
  // Held fixed per page (not recomputed per label) so the framing doesn't jump around as
  // you step through a page's labels, and every other label on the page stays visible —
  // same reasoning as only occluding the current label.
  const crop = useMemo(() => getPageCrop(step?.page), [step?.pageIndex]);

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

  return (
    <div className="panel study-panel">
      <div className="study-header">
        <h2>{deck.name}</h2>
        <span className="muted">
          {step.stepNumber} / {step.totalSteps} · {stats.correct} correct, {stats.wrong} wrong
        </span>
      </div>

      <div className="occlusion-wrap" style={{ aspectRatio: `${crop[3] - crop[1]} / ${crop[2] - crop[0]}` }}>
        <img className="occlusion-image" src={step.page.image} alt={`Page ${step.page.page}`} style={cropImageStyle(crop)} />
        {!revealed && <div className="occlusion-box" style={occlusionStyle(step.label.box, crop)} />}
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
