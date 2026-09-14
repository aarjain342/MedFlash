import { useEffect, useRef, useState } from 'react';
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

// A source PDF page is rendered whole (title/branding chrome included) and can contain
// several separate diagrams — getPageCrop (anatomyEngine.js) picks just the one diagram
// the current label belongs to, so that diagram fills the frame instead of the whole page
// (or every diagram on it). The image and the current label's occlusion box are then
// expressed as percentages of that cropped region rather than the full 0-1000 page.
//
// The crop box coordinates are normalized 0-1000 independently per axis (x against the
// image's own width, y against its own height), so `(cx1-cx0)` and `(cy1-cy0)` are NOT
// directly comparable lengths unless the source image happens to be square — a real slide
// image here is ~16:9. Using the raw normalized box as a CSS aspect-ratio stretched the
// image (confirmed live). `imageAspect` (naturalWidth/naturalHeight, measured once per page
// via the <img>'s onLoad below) converts the normalized box into its true aspect ratio;
// everything else here is still pure percentage math, no pixel measurement needed beyond
// that one ratio.
function cropAspectRatio(crop, imageAspect) {
  const [cy0, cx0, cy1, cx1] = crop;
  return ((cx1 - cx0) / (cy1 - cy0)) * imageAspect;
}

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
  // naturalWidth/naturalHeight of the currently-loaded page image, for cropAspectRatio.
  // Re-measured whenever the page changes (a different page can be a different image
  // size in principle, even though in practice a source PDF's pages are usually uniform).
  const [imageAspect, setImageAspect] = useState(1);
  const startedRef = useRef(false);
  const measuredPageIndexRef = useRef(null);

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
  // Recomputed per label (cheap — a handful of boxes at most) so the frame follows the
  // specific diagram the current label belongs to, not the whole page's worth of diagrams.
  const crop = step ? getPageCrop(step.page, step.label) : [0, 0, 1000, 1000];

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

      <div className="occlusion-wrap" style={{ aspectRatio: cropAspectRatio(crop, imageAspect) }}>
        <img
          className="occlusion-image"
          src={step.page.image}
          alt={`Page ${step.page.page}`}
          style={cropImageStyle(crop)}
          onLoad={(e) => {
            if (measuredPageIndexRef.current === step.pageIndex) return;
            measuredPageIndexRef.current = step.pageIndex;
            const { naturalWidth, naturalHeight } = e.target;
            if (naturalWidth && naturalHeight) setImageAspect(naturalWidth / naturalHeight);
          }}
        />
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
