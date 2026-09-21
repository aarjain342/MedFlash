import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
function occlusionRect(box, crop, padFraction = 0.18) {
  const [cy0, cx0, cy1, cx1] = crop;
  const cropW = cx1 - cx0;
  const cropH = cy1 - cy0;
  const [ymin, xmin, ymax, xmax] = box;
  const padY = (ymax - ymin) * padFraction;
  const padX = (xmax - xmin) * padFraction;
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

// Largest box with the given aspect ratio that fits inside the available area ("contain").
// Done in JS rather than CSS because a CSS aspect-ratio box clamped by max-height stops
// honoring its ratio (the width stays put), which is exactly the stretching bug again.
function fitBox(availWidth, availHeight, ratio) {
  if (!availWidth || !availHeight || !ratio) return { width: 0, height: 0 };
  let width = availWidth;
  let height = width / ratio;
  if (height > availHeight) {
    height = availHeight;
    width = height * ratio;
  }
  return { width: Math.floor(width), height: Math.floor(height) };
}

// Devices with a real pointer (desktop, or an iPad with a trackpad/keyboard) get the answer
// field focused automatically; touch-only devices don't, so the on-screen keyboard doesn't
// pop up over the diagram on every single question.
function hasHoverPointer() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(any-hover: hover)').matches;
}

export default function AnatomyStudyView({ deck, onExit }) {
  const [phase, setPhase] = useState('loading'); // loading | ready | complete
  const [quizState, setQuizState] = useState(null);
  const [guess, setGuess] = useState('');
  const [revealed, setRevealed] = useState(false);
  // naturalWidth/naturalHeight per page (needed for cropAspectRatio), keyed by page index.
  // Until a page's image has loaded its ratio is unknown, so it renders hidden rather than
  // flashing at a guessed shape.
  const [aspectByPage, setAspectByPage] = useState({});
  const [stageEl, setStageEl] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const startedRef = useRef(false);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

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

  // This view is a full-screen takeover (rendered through a portal above the sidebar).
  // Lock the page underneath so dragging on the quiz can't scroll the app behind it.
  useEffect(() => {
    document.documentElement.classList.add('study-locked');
    return () => document.documentElement.classList.remove('study-locked');
  }, []);

  // When an on-screen keyboard opens (iPad), the visual viewport shrinks but the layout
  // viewport doesn't, so a plain 100vh/100dvh overlay would have its bottom — the answer
  // field — hidden behind the keyboard. Track the visual viewport and size the overlay to
  // it while a keyboard is up; otherwise leave it to the CSS default. Skipped while the
  // user has pinch-zoomed, where the visual viewport is legitimately smaller.
  useEffect(() => {
    const el = rootRef.current;
    const vv = window.visualViewport;
    if (!el || !vv) return undefined;
    const props = ['--vv-top', '--vv-height'];
    const apply = () => {
      const keyboardOpen = Math.abs(vv.scale - 1) < 0.02 && window.innerHeight - vv.height > 100;
      if (keyboardOpen) {
        el.style.setProperty('--vv-top', `${vv.offsetTop}px`);
        el.style.setProperty('--vv-height', `${vv.height}px`);
        el.classList.add('keyboard-open');
      } else {
        props.forEach((p) => el.style.removeProperty(p));
        el.classList.remove('keyboard-open');
      }
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, []);

  // Measure the area available to the diagram (content box, so stage padding is excluded).
  useLayoutEffect(() => {
    if (!stageEl) return undefined;
    const measure = (entry) => {
      const { width, height } = entry
        ? entry.contentRect
        : { width: stageEl.clientWidth, height: stageEl.clientHeight };
      setStageSize((prev) =>
        Math.round(prev.width) === Math.round(width) && Math.round(prev.height) === Math.round(height)
          ? prev
          : { width, height }
      );
    };
    measure();
    const observer = new ResizeObserver((entries) => measure(entries[0]));
    observer.observe(stageEl);
    return () => observer.disconnect();
  }, [stageEl]);

  const step = phase === 'loading' ? null : getCurrentStep(deck.pages, quizState);
  const stepNumber = step?.stepNumber;

  // Desktop convenience: put the cursor in the answer field for each new question.
  useEffect(() => {
    if (phase === 'ready' && !revealed && hasHoverPointer()) inputRef.current?.focus();
  }, [phase, revealed, stepNumber]);

  function handleReveal() {
    if (!guess.trim()) return;
    setRevealed(true);
  }

  function handleGrade(gotItRight) {
    const current = getCurrentStep(deck.pages, quizState);
    if (!current) return;
    recordActivity();
    recordResult(quizState, current.labelId, gotItRight);
    advance(deck.pages, quizState);
    void saveAnatomyProgress(deck.id, quizState);

    setGuess('');
    setRevealed(false);
    setQuizState({ ...quizState });
    setPhase(getCurrentStep(deck.pages, quizState) ? 'ready' : 'complete');
  }

  function rememberAspect(pageIndex, img) {
    if (!img?.naturalWidth || !img?.naturalHeight) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    setAspectByPage((prev) => (prev[pageIndex] === ratio ? prev : { ...prev, [pageIndex]: ratio }));
  }

  const stats = quizState ? getStats(quizState) : { correct: 0, wrong: 0, attempted: 0 };

  let body;
  if (phase === 'loading') {
    body = (
      <div className="anatomy-center">
        <span className="spinner" aria-hidden="true" />
        <p className="muted">Loading…</p>
      </div>
    );
  } else if (phase === 'complete') {
    body = (
      <div className="anatomy-center">
        <div className="panel anatomy-done">
          <h2>{deck.name}</h2>
          <p>
            You've gone through every structure in this quiz — {stats.correct} / {stats.attempted} right.
          </p>
          <button className="primary anatomy-cta" onClick={onExit}>Back to anatomy quizzes</button>
        </div>
      </div>
    );
  } else {
    const crop = getPageCrop(step.page, step.label);
    const imageAspect = aspectByPage[step.pageIndex];
    const fit = fitBox(stageSize.width, stageSize.height, imageAspect ? cropAspectRatio(crop, imageAspect) : 0);
    const label = step.label;

    body = (
      <>
        <div className="anatomy-body">
          <div className="anatomy-stage" ref={setStageEl}>
            <div
              className="occlusion-wrap"
              style={{ width: fit.width, height: fit.height, visibility: fit.width ? 'visible' : 'hidden' }}
            >
              <img
                key={step.page.page}
                ref={(img) => img?.complete && rememberAspect(step.pageIndex, img)}
                className="occlusion-image"
                src={step.page.image}
                alt={`Page ${step.page.page}`}
                draggable={false}
                style={cropImageStyle(crop)}
                onLoad={(e) => rememberAspect(step.pageIndex, e.currentTarget)}
              />
              {revealed ? (
                <div className="occlusion-ring" style={occlusionRect(label.box, crop, 0.3)} />
              ) : (
                <div className="occlusion-box" style={occlusionRect(label.box, crop)} />
              )}
            </div>
          </div>

          <div className="anatomy-controls">
            {!revealed ? (
              <form
                className="anatomy-answer"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleReveal();
                }}
              >
                <label className="eyebrow" htmlFor="anatomy-guess">
                  Name the hidden label
                </label>
                <div className="anatomy-answer-row">
                  <input
                    id="anatomy-guess"
                    ref={inputRef}
                    type="text"
                    className="anatomy-input"
                    placeholder="Type what you think it is…"
                    value={guess}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    enterKeyHint="go"
                    onChange={(e) => setGuess(e.target.value)}
                  />
                  <button type="submit" className="primary anatomy-cta" disabled={!guess.trim()}>
                    Reveal
                  </button>
                </div>
              </form>
            ) : (
              <div className="anatomy-reveal">
                <div className="anatomy-compare">
                  <div>
                    <span className="eyebrow">You typed</span>
                    <p className="anatomy-guess">{guess}</p>
                  </div>
                  <div>
                    <span className="eyebrow">Correct label</span>
                    <p className="anatomy-correct">{label.label}</p>
                  </div>
                </div>
                <div className="anatomy-grade">
                  <button className="danger anatomy-cta" onClick={() => handleGrade(false)}>Missed it</button>
                  <button className="success anatomy-cta" onClick={() => handleGrade(true)}>Got it</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  const total = step?.totalSteps || 0;
  const progressPct = total ? ((stepNumber - 1) / total) * 100 : phase === 'complete' ? 100 : 0;

  return createPortal(
    <div className="anatomy-study" ref={rootRef} role="dialog" aria-label={`${deck.name} anatomy quiz`}>
      <header className="anatomy-bar">
        <button className="ghost anatomy-exit" onClick={onExit}>
          <span aria-hidden="true">←</span> Exit
        </button>
        <h2 className="anatomy-title">{deck.name}</h2>
        {phase === 'ready' && (
          <div className="anatomy-score" aria-live="polite">
            <span>{stepNumber} / {total}</span>
            <span className="anatomy-score-right" title="Correct">✓ {stats.correct}</span>
            <span className="anatomy-score-wrong" title="Missed">✗ {stats.wrong}</span>
          </div>
        )}
      </header>
      <div className="anatomy-progress" aria-hidden="true">
        <div style={{ width: `${progressPct}%` }} />
      </div>
      {body}
    </div>,
    document.body
  );
}
