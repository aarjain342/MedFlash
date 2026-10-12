import { useEffect, useReducer, useRef, useState } from 'react';
import { generateQuizStream } from '../lib/quizApi';
import {
  initQuizState,
  addTopicToState,
  setShuffleMode,
  presentQuestion,
  getCurrentQuestion,
  submitAnswer,
  omitQuestion,
  restoreQuestion,
  skipTopic,
  restoreTopic,
  getTopicSummaries,
  getOverallStats,
  getSessionSummary,
} from '../lib/quizEngine';
import {
  toStore,
  emptyStore,
  activeSet,
  hasSet,
  putSet,
  switchTo,
  skippedTopicNames,
  normalizeDifficulty,
} from '../lib/quizSets';
import { loadQuizState, saveQuizState } from '../lib/db';
import { recordActivity } from '../lib/streak';
import DifficultySwitch from './DifficultySwitch';
import QuizSummary from './QuizSummary';

const PREFS_KEY = 'medflash:quizPrefs';
const LOCKED_IN_EXIT_PASSWORD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1324';
const LOCKED_IN_DURATIONS = [30, 60, 90];
const DIFFICULTY_LABEL = { hard: 'Hard', easy: 'Easy' };

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      shuffle: !!parsed.shuffle,
      difficulty: parsed.difficulty === 'easy' ? 'easy' : 'hard',
    };
  } catch {
    return { shuffle: false, difficulty: 'hard' };
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable (private browsing, quota) — preferences just won't persist.
  }
}

function DifficultyDots({ tier }) {
  return (
    <span className="difficulty-dots" title={`Difficulty ${tier} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={n <= tier ? 'dot filled' : 'dot'} />
      ))}
    </span>
  );
}

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function QuizView({ deck, onExit, onStudy }) {
  const [phase, setPhase] = useState('loading'); // loading | setup | generating | ready | complete | error
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [genDifficulty, setGenDifficulty] = useState('hard');
  const [liveTopics, setLiveTopics] = useState([]); // [{ name, questions, error }] — grows as SSE events arrive
  const [bgGenerating, setBgGenerating] = useState(false);
  const [bgGenError, setBgGenError] = useState('');
  const [expandedTopic, setExpandedTopic] = useState(null);
  const [flashcardsOpen, setFlashcardsOpen] = useState(true);
  const [questionsOpen, setQuestionsOpen] = useState(true);
  const [sidebarMinimized, setSidebarMinimized] = useState(false);
  const [error, setError] = useState('');
  const [canResume, setCanResume] = useState(false); // a failed generation left an earlier set to go back to
  const [current, setCurrent] = useState(null); // { topicName, tier, presented }
  const [selected, setSelected] = useState(null);
  const [feedback, setFeedback] = useState(null); // { correct, explanation, memoryAid }
  const [prefs, setPrefs] = useState(loadPrefs);
  const [confirm, setConfirm] = useState(null); // { kind: 'generate' | 'regenerate', difficulty }
  const [undo, setUndo] = useState(null); // { message, run } for the last thing the student removed
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Locked-in mode
  const [lockedIn, setLockedIn] = useState(null); // { endsAt, durationMin } | null
  const [lockedInDuration, setLockedInDuration] = useState(30);
  const [remainingMs, setRemainingMs] = useState(null);
  const [exitPasswordOpen, setExitPasswordOpen] = useState(false);
  const [exitPasswordValue, setExitPasswordValue] = useState('');
  const [exitPasswordError, setExitPasswordError] = useState(false);

  const startedRef = useRef(false);
  const phaseRef = useRef('loading');
  // The deck's saved quiz: an easy set and/or a hard set (see quizSets.js). The engine mutates the
  // active set in place, so it lives in a ref and `bump` re-renders after each change.
  const storeRef = useRef(null);
  const lastTargetRef = useRef('hard');
  const [, bump] = useReducer((n) => n + 1, 0);

  const store = storeRef.current;
  const quizState = store ? activeSet(store) : null;

  function updatePhase(p) {
    phaseRef.current = p;
    setPhase(p);
  }

  function persist() {
    if (storeRef.current) void saveQuizState(deck.id, storeRef.current);
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Locked-in countdown — ticks once a second, auto-ends the session (no password needed)
  // when time runs out.
  useEffect(() => {
    if (!lockedIn) return undefined;
    const tick = () => {
      const left = lockedIn.endsAt - Date.now();
      setRemainingMs(left);
      if (left <= 0) endLockedIn();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedIn]);

  // The "removed" notice (with its Undo) goes away on its own.
  useEffect(() => {
    if (!undo) return undefined;
    const id = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(id);
  }, [undo]);

  // Puts the next question from `state` on screen, or the finish screen when there is none.
  function showQuestion(state) {
    setSelected(null);
    setFeedback(null);
    const next = state ? getCurrentQuestion(state) : null;
    if (next) {
      setCurrent(next);
      updatePhase('ready');
    } else {
      setCurrent(null);
      updatePhase('complete');
    }
  }

  async function bootstrap() {
    const saved = await loadQuizState(deck.id);
    const loaded = toStore(saved, prefs.difficulty);
    if (loaded) {
      storeRef.current = loaded;
      lastTargetRef.current = loaded.active;
      showQuestion(activeSet(loaded));
      return;
    }
    updatePhase('setup');
  }

  function updatePrefs(patch) {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  }

  async function generate(difficulty) {
    const target = normalizeDifficulty(difficulty);
    lastTargetRef.current = target;
    setGenDifficulty(target);
    setConfirm(null);
    setSummaryOpen(false);
    setUndo(null);
    // If this fails before anything arrives, the student can go back to the set they had.
    setCanResume(Boolean(storeRef.current && activeSet(storeRef.current)));
    // "Avoid this topic" holds when a new set is generated.
    const skipTopics = skippedTopicNames(storeRef.current);

    updatePhase('generating');
    setError('');
    setBgGenError('');
    setLiveTopics([]);
    setGenProgress({ done: 0, total: 0 });
    const topicResults = new Map();
    let total = 0;
    let localState = null;

    try {
      // Only what the quiz prompt uses goes up: strip everything else (notably the base64 slide
      // images) so the request stays small regardless of deck size. `page` groups cards by slide
      // and `table` carries facts the answer text often leaves out.
      const promptCards = deck.cards.map((c) => ({
        topic: c.topic,
        question: c.question,
        answer: c.answer,
        page: c.page,
        table: c.table || null,
      }));

      await generateQuizStream(
        promptCards,
        target,
        ({ type, data }) => {
          if (type === 'start') {
            total = data.totalTopics;
            setGenProgress({ done: 0, total });
          } else if (type === 'topic') {
            topicResults.set(data.topic, data.questions);
            setGenProgress((p) => ({ done: p.done + 1, total }));
            setLiveTopics((t) => [...t, { name: data.topic, questions: data.questions }]);

            if (!localState) {
              // First topic to arrive — let the user start answering immediately instead of
              // waiting for every topic to finish generating. Remaining topics keep streaming
              // in behind the scenes and get folded into the session as they land.
              const topics = [...topicResults.entries()].map(([name, questions]) => ({ name, questions }));
              localState = initQuizState(topics, { shuffle: prefs.shuffle });
              const nextStore = storeRef.current || emptyStore(target);
              putSet(nextStore, target, localState); // replaces a set of the same difficulty, keeps the other
              storeRef.current = nextStore;
              updatePrefs({ difficulty: target });
              persist();
              showQuestion(localState);
              setBgGenerating(true);
            } else {
              addTopicToState(localState, data.topic, data.questions);
              persist();
              bump();
              // If the user had already finished every topic that was loaded so far, this
              // new arrival brings the session back to life.
              if (phaseRef.current === 'complete') showQuestion(localState);
            }
          } else if (type === 'topic-error') {
            setGenProgress((p) => ({ done: p.done + 1, total }));
            setLiveTopics((t) => [...t, { name: data.topic, error: data.error }]);
          } else if (type === 'fatal-error') {
            throw new Error(data.error);
          }
        },
        { skipTopics }
      );

      if (!localState) {
        throw new Error('No quiz questions could be generated for this deck.');
      }
      setBgGenerating(false);
    } catch (err) {
      setBgGenerating(false);
      if (localState) {
        // The user already has a usable session running — don't blow it away, just flag
        // that background generation hit a problem.
        setBgGenError(err.message);
      } else {
        setError(err.message);
        updatePhase('error');
      }
    }
  }

  function handleSubmit() {
    if (selected == null || !current || !quizState) return;
    recordActivity();
    setUndo(null);
    const result = submitAnswer(quizState, current.topicName, current.index, current.presented, selected);
    setFeedback({
      correct: result.correct,
      explanation: current.presented.explanation,
      memoryAid: current.presented.memoryAid || '',
    });
    persist();
  }

  function handleNext() {
    setUndo(null);
    showQuestion(quizState);
  }

  // Lets the user jump straight to any question in the bank instead of only the one the
  // engine would auto-pick next.
  function handleSelectQuestion(topicName, index) {
    if (!quizState) return;
    const q = presentQuestion(quizState, topicName, index);
    if (!q) return;
    setSelected(null);
    setFeedback(null);
    setSummaryOpen(false);
    setCurrent(q);
    if (phaseRef.current !== 'ready') updatePhase('ready');
  }

  // Shows a specific question again (after an undo).
  function presentAgain(topicName, index) {
    const q = quizState ? presentQuestion(quizState, topicName, index) : null;
    if (!q) {
      showQuestion(quizState);
      return;
    }
    setSelected(null);
    setFeedback(null);
    setCurrent(q);
    updatePhase('ready');
  }

  // Both removals move straight on to the next question and leave an Undo behind.
  function removeAndAdvance(message, undoRun) {
    persist();
    bump();
    setUndo({ message, run: undoRun });
    showQuestion(quizState);
  }

  function handleSkipQuestion() {
    if (!current || !quizState) return;
    const { topicName, index } = current;
    omitQuestion(quizState, topicName, index);
    removeAndAdvance('Question removed. It won’t come back.', () => {
      restoreQuestion(quizState, topicName, index);
      persist();
      bump();
      presentAgain(topicName, index);
    });
  }

  function handleSkipTopic() {
    if (!current || !quizState) return;
    const { topicName, index } = current;
    skipTopic(quizState, topicName);
    removeAndAdvance(`You won’t be asked about “${topicName}” again.`, () => {
      restoreTopic(quizState, topicName);
      persist();
      bump();
      presentAgain(topicName, index);
    });
  }

  function handleRestoreQuestion(topicName, index) {
    if (!quizState || !restoreQuestion(quizState, topicName, index)) return;
    persist();
    bump();
    if (phaseRef.current === 'complete') showQuestion(quizState);
  }

  function handleRestoreTopic(topicName) {
    if (!quizState || !restoreTopic(quizState, topicName)) return;
    persist();
    bump();
    if (phaseRef.current === 'complete') showQuestion(quizState);
  }

  function handleToggleShuffle() {
    if (!quizState) return;
    setShuffleMode(quizState, !quizState.shuffle);
    persist();
    bump();
  }

  // Easy <-> Hard. A set that already exists is simply switched to; one that doesn't asks first,
  // because generating costs an AI generation.
  function handleSwitchDifficulty(difficulty) {
    const target = normalizeDifficulty(difficulty);
    const current_ = storeRef.current;
    if (!current_ || bgGenerating) return;
    setUndo(null);
    setSummaryOpen(false);
    if (target === current_.active && hasSet(current_, target)) return;
    if (hasSet(current_, target)) {
      switchTo(current_, target);
      updatePrefs({ difficulty: target });
      lastTargetRef.current = target;
      persist();
      showQuestion(activeSet(current_));
      return;
    }
    setConfirm({ kind: 'generate', difficulty: target });
  }

  function handleRegenerate() {
    if (!store || bgGenerating) return;
    setConfirm({ kind: 'regenerate', difficulty: store.active });
  }

  async function startLockedIn() {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // Fullscreen can be denied/unsupported — the timer and exit-gate still work without it.
    }
    setLockedIn({ endsAt: Date.now() + lockedInDuration * 60 * 1000, durationMin: lockedInDuration });
  }

  function endLockedIn() {
    setLockedIn(null);
    setExitPasswordOpen(false);
    setExitPasswordValue('');
    setExitPasswordError(false);
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  function confirmExitLockedIn() {
    if (exitPasswordValue === LOCKED_IN_EXIT_PASSWORD) {
      endLockedIn();
    } else {
      setExitPasswordError(true);
    }
  }

  const topicSummaries = quizState ? getTopicSummaries(quizState) : [];
  const stats = quizState ? getOverallStats(quizState) : { correct: 0, wrong: 0, attempted: 0, accuracy: null };
  const activeDifficulty = store?.active || prefs.difficulty;
  const otherDifficultyName = activeDifficulty === 'hard' ? 'easy' : 'hard';

  if (phase === 'loading') {
    return (
      <div className="quiz-centered">
        <div className="panel quiz-panel-narrow">
          <span className="spinner" aria-hidden="true" />
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (phase === 'setup') {
    return (
      <div className="quiz-centered">
        <div className="panel quiz-panel-narrow quiz-setup-panel">
          <h2>Set up your quiz</h2>
          <p className="muted">Questions are pulled from "{deck.name}".</p>

          <div className="quiz-setup-options">
            <div className="quiz-setup-row">
              <div>
                <strong>Question order</strong>
                <p className="muted small">Slide order follows how the deck was generated.</p>
              </div>
              <div className="segmented">
                <button
                  className={!prefs.shuffle ? 'active' : ''}
                  onClick={() => updatePrefs({ shuffle: false })}
                >
                  Slide order
                </button>
                <button
                  className={prefs.shuffle ? 'active' : ''}
                  onClick={() => updatePrefs({ shuffle: true })}
                >
                  Shuffle
                </button>
              </div>
            </div>

            <div className="quiz-setup-row">
              <div>
                <strong>Difficulty</strong>
                <p className="muted small">Easy: vocab & basics. Hard: clinical application. You can switch any time.</p>
              </div>
              <div className="segmented">
                <button
                  className={prefs.difficulty === 'easy' ? 'active' : ''}
                  onClick={() => updatePrefs({ difficulty: 'easy' })}
                >
                  Easy
                </button>
                <button
                  className={prefs.difficulty === 'hard' ? 'active' : ''}
                  onClick={() => updatePrefs({ difficulty: 'hard' })}
                >
                  Hard
                </button>
              </div>
            </div>
          </div>

          <button className="primary" onClick={() => generate(prefs.difficulty)}>Start quiz</button>
          <button className="link" onClick={onExit}>Back to decks</button>
        </div>
      </div>
    );
  }

  if (phase === 'generating') {
    return (
      <div className="quiz-centered">
        <div className="panel quiz-generating-panel">
          <h2>Building your {DIFFICULTY_LABEL[genDifficulty]} quiz</h2>
          <p className="muted">
            Writing questions for each topic in "{deck.name}"… the first question will be ready as
            soon as one topic finishes.
          </p>
          {genProgress.total > 0 && (
            <div className="progress">
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${(genProgress.done / genProgress.total) * 100}%` }}
                />
              </div>
              <p className="muted small">
                Topic {genProgress.done} / {genProgress.total}
              </p>
            </div>
          )}

          {liveTopics.length > 0 && (
            <ul className="live-topic-feed">
              {[...liveTopics].reverse().map((t) => (
                <li key={t.name} className={`live-topic-item ${t.error ? 'errored' : ''}`}>
                  <button
                    className="live-topic-toggle"
                    disabled={!!t.error}
                    onClick={() => setExpandedTopic((cur) => (cur === t.name ? null : t.name))}
                  >
                    <span>{t.error ? '⚠ ' : '✓ '}{t.name}</span>
                    <span className="muted small">
                      {t.error ? 'failed' : `${t.questions.length} question${t.questions.length === 1 ? '' : 's'}`}
                    </span>
                  </button>
                  {expandedTopic === t.name && !t.error && (
                    <ul className="live-topic-questions">
                      {t.questions.map((q, i) => (
                        <li key={i}>
                          <DifficultyDots tier={q.difficulty} />
                          <span className="muted small">{q.stem}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="quiz-centered">
        <div className="panel quiz-panel-narrow">
          <p className="error">{error}</p>
          <button className="primary" onClick={() => generate(lastTargetRef.current)}>Try again</button>
          {canResume && store && activeSet(store) && (
            <button className="ghost" onClick={() => showQuestion(activeSet(store))}>Back to my quiz</button>
          )}
          <button className="link" onClick={onExit}>Back to decks</button>
        </div>
      </div>
    );
  }

  const showingSummary = phase === 'complete' || summaryOpen;

  return (
    <div className="quiz-layout">
      {/* Only shown when the quiz takes over the whole screen (tablets/narrow windows, see
          App.css) — there the app's own navigation is covered, so this is the way out. */}
      {!lockedIn && (
        <div className="quiz-topbar">
          <button className="ghost" onClick={onExit}>
            <span aria-hidden="true">←</span> Exit
          </button>
          <span className="quiz-topbar-title">{deck.name}</span>
          <span className="quiz-topbar-stats">
            <span className="quiz-topbar-correct">✓ {stats.correct}</span>
            <span className="quiz-topbar-wrong">✗ {stats.wrong}</span>
          </span>
        </div>
      )}
      {lockedIn && (
        <div className="locked-in-bar">
          <div className="locked-in-timer">
            <span className="eyebrow">Locked in</span>
            <span className="locked-in-clock">{formatClock(remainingMs ?? 0)}</span>
          </div>
          {!exitPasswordOpen ? (
            <button className="ghost small" onClick={() => setExitPasswordOpen(true)}>Exit locked-in mode</button>
          ) : (
            <div className="locked-in-exit-form">
              <span className="locked-in-password-hint muted small">
                Type <code>{LOCKED_IN_EXIT_PASSWORD}</code> to confirm:
              </span>
              <input
                type="text"
                autoFocus
                placeholder="Type the exit password"
                value={exitPasswordValue}
                onChange={(e) => {
                  setExitPasswordValue(e.target.value);
                  setExitPasswordError(false);
                }}
                onKeyDown={(e) => e.key === 'Enter' && confirmExitLockedIn()}
              />
              <button className="primary small" onClick={confirmExitLockedIn}>Confirm exit</button>
              <button className="link small" onClick={() => setExitPasswordOpen(false)}>Cancel</button>
              {exitPasswordError && <span className="error small">Incorrect password.</span>}
            </div>
          )}
        </div>
      )}

      <div className={`panel quiz-sidebar ${sidebarMinimized ? 'minimized' : ''}`}>
        <button
          className="sidebar-minimize-toggle"
          onClick={() => setSidebarMinimized((m) => !m)}
          title={sidebarMinimized ? 'Expand sidebar' : 'Minimize sidebar'}
          aria-label={sidebarMinimized ? 'Expand sidebar' : 'Minimize sidebar'}
        >
          {sidebarMinimized ? '»' : '«'}
        </button>

        {sidebarMinimized ? (
          <div className="quiz-stats-mini">
            <span className="quiz-stat-value correct">{stats.correct}</span>
            <span className="quiz-stat-value wrong">{stats.wrong}</span>
          </div>
        ) : (
          <>
            <div className="quiz-stats-bar">
              <div className="quiz-stat">
                <span className="quiz-stat-value correct">{stats.correct}</span>
                <span className="muted small">Correct</span>
              </div>
              <div className="quiz-stat">
                <span className="quiz-stat-value wrong">{stats.wrong}</span>
                <span className="muted small">Wrong</span>
              </div>
              <div className="quiz-stat">
                <span className="quiz-stat-value">{stats.accuracy == null ? '—' : `${stats.accuracy}%`}</span>
                <span className="muted small">Accuracy</span>
              </div>
            </div>

            {bgGenerating && (
              <p className="muted small quiz-bg-generating">
                <span className="spinner spinner-tiny" aria-hidden="true" /> More topics generating in the background…
              </p>
            )}
            {bgGenError && (
              <p className="warning small">Background generation hit a snag: {bgGenError}</p>
            )}

            {store && (
              <DifficultySwitch
                store={store}
                busy={bgGenerating}
                onSwitch={handleSwitchDifficulty}
                onRegenerate={handleRegenerate}
              />
            )}

            {confirm && (
              <div className="confirm-box" role="alertdialog" aria-label="Confirm">
                <p>
                  {confirm.kind === 'generate'
                    ? `Generate ${DIFFICULTY_LABEL[confirm.difficulty]} questions for this deck? It uses 1 AI generation.`
                    : `Replace your ${DIFFICULTY_LABEL[confirm.difficulty]} set with fresh questions? Your progress on it will be lost. It uses 1 AI generation.`}
                </p>
                {skippedTopicNames(store).length > 0 && (
                  <p className="muted small">Topics you skipped stay skipped.</p>
                )}
                <div className="confirm-actions">
                  <button className="primary small" onClick={() => generate(confirm.difficulty)}>
                    {confirm.kind === 'generate' ? 'Generate' : 'Replace it'}
                  </button>
                  <button className="link small" onClick={() => setConfirm(null)}>Cancel</button>
                </div>
              </div>
            )}

            {/* Always visible — not tucked behind a collapsible section, so shuffle and
                locked-in are easy to find even when resuming a quiz that skips the setup screen. */}
            <div className="quiz-toolbar">
              <button
                className={`toolbar-btn ${quizState?.shuffle ? 'active' : ''}`}
                onClick={handleToggleShuffle}
                title="Toggle between slide order and shuffled question order"
              >
                {quizState?.shuffle ? 'Shuffled' : 'Slide order'}
              </button>
              <button
                className="toolbar-btn"
                onClick={() => setSummaryOpen((open) => !open)}
                title="See how this session is going"
              >
                Summary
              </button>
            </div>

            {!lockedIn && (
              <div className="quiz-toolbar locked-in-toolbar">
                <div className="segmented">
                  {LOCKED_IN_DURATIONS.map((d) => (
                    <button
                      key={d}
                      className={lockedInDuration === d ? 'active' : ''}
                      onClick={() => setLockedInDuration(d)}
                    >
                      {d}m
                    </button>
                  ))}
                </div>
                <button className="primary small" onClick={startLockedIn}>Lock in</button>
              </div>
            )}
            {!lockedIn && (
              <p className="muted small locked-in-hint">
                Exit early by typing <code>{LOCKED_IN_EXIT_PASSWORD}</code> — enough friction to stop you bailing, not a real lock.
              </p>
            )}

            <div className="sidebar-section">
              <button className="sidebar-section-header" onClick={() => setFlashcardsOpen((o) => !o)}>
                <span>Flashcards</span>
                <span aria-hidden="true">{flashcardsOpen ? '−' : '+'}</span>
              </button>
              {flashcardsOpen && (
                <div className="sidebar-section-body">
                  <p className="muted small">{deck.cards.length} cards in "{deck.name}"</p>
                  <button className="ghost small" onClick={() => onStudy?.(deck)}>Study flashcards</button>
                </div>
              )}
            </div>

            <div className="sidebar-section">
              <button className="sidebar-section-header" onClick={() => setQuestionsOpen((o) => !o)}>
                <span>Questions</span>
                <span aria-hidden="true">{questionsOpen ? '−' : '+'}</span>
              </button>
              {questionsOpen && (
                <ul className="topic-tree">
                  {topicSummaries.map((t) => {
                    if (t.skipped) {
                      return (
                        <li key={t.name} className="topic-tree-item skipped">
                          <div className="topic-tree-skipped">
                            <span className="topic-tree-name" title={t.name}>{t.name}</span>
                            <button className="link small" onClick={() => handleRestoreTopic(t.name)}>
                              Restore topic
                            </button>
                          </div>
                        </li>
                      );
                    }
                    const inQuiz = t.questions.filter((q) => !q.omitted);
                    const doneCount = inQuiz.filter((q) => q.correct).length;
                    return (
                      <li key={t.name} className="topic-tree-item">
                        <button
                          className={`topic-tree-toggle ${t.mastered ? 'mastered' : ''} ${
                            current?.topicName === t.name ? 'active' : ''
                          }`}
                          onClick={() => setExpandedTopic((cur) => (cur === t.name ? null : t.name))}
                        >
                          <span className="topic-tree-name" title={t.name}>
                            {t.mastered ? '✓ ' : ''}
                            {t.name}
                          </span>
                          <span className="topic-progress muted small">{doneCount}/{inQuiz.length}</span>
                        </button>

                        {expandedTopic === t.name && (
                          <ul className="question-tree-list">
                            {t.questions.map((q) => {
                              if (q.omitted) {
                                return (
                                  <li key={q.index} className="question-tree-item omitted">
                                    <div className="question-tree-omitted">
                                      <span className="question-tree-stem">{q.stem}</span>
                                      <button className="link small" onClick={() => handleRestoreQuestion(t.name, q.index)}>
                                        Restore
                                      </button>
                                    </div>
                                  </li>
                                );
                              }
                              const isActive = current?.topicName === t.name && current.index === q.index;
                              const status = q.correct ? 'correct' : q.wrong > 0 ? 'wrong' : 'unattempted';
                              return (
                                <li key={q.index} className={`question-tree-item ${status} ${isActive ? 'active' : ''}`}>
                                  <button
                                    className="question-tree-select"
                                    onClick={() => handleSelectQuestion(t.name, q.index)}
                                  >
                                    <span className={`question-status-icon ${status}`} aria-hidden="true">
                                      {status === 'correct' ? '✓' : status === 'wrong' ? '✗' : '•'}
                                    </span>
                                    <span className="question-tree-stem">{q.stem}</span>
                                    <DifficultyDots tier={q.difficulty} />
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      <div className="panel quiz-panel">
        {undo && (
          <div className="undo-bar" role="status">
            <span>{undo.message}</span>
            <button
              className="link small"
              onClick={() => {
                undo.run();
                setUndo(null);
              }}
            >
              Undo
            </button>
          </div>
        )}

        {showingSummary && quizState && (
          <QuizSummary
            summary={getSessionSummary(quizState)}
            deckName={deck.name}
            complete={phase === 'complete'}
            difficulty={activeDifficulty}
            hasOtherSet={hasSet(store, otherDifficultyName)}
            onBack={() => setSummaryOpen(false)}
            onExit={onExit}
            onSwitch={handleSwitchDifficulty}
            lockedIn={Boolean(lockedIn)}
          />
        )}

        {!showingSummary && phase === 'ready' && current && (
          <div>
            <div className="quiz-question-header">
              <span className="quiz-topic-tag">{current.topicName}</span>
              <DifficultyDots tier={current.tier} />
            </div>

            <p className="quiz-stem">{current.presented.stem}</p>

            <div className="quiz-options">
              {current.presented.options.map((opt, i) => {
                let cls = 'quiz-option';
                if (feedback) {
                  if (i === current.presented.correctIndex) cls += ' correct';
                  else if (i === selected) cls += ' incorrect';
                } else if (i === selected) {
                  cls += ' selected';
                }
                return (
                  <button
                    key={i}
                    className={cls}
                    disabled={!!feedback}
                    onClick={() => setSelected(i)}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            {feedback && (
              <div className={`quiz-feedback ${feedback.correct ? 'correct' : 'incorrect'}`}>
                <p className="quiz-feedback-verdict">
                  {feedback.correct ? 'Correct.' : 'Not quite. You’ll see this topic again.'}
                </p>
                <p>{feedback.explanation}</p>
                {feedback.memoryAid &&
                  (feedback.correct ? (
                    <details className="memory-aid">
                      <summary>Memory trick</summary>
                      <p className="memory-aid-text">{feedback.memoryAid}</p>
                    </details>
                  ) : (
                    <div className="memory-aid open">
                      <span className="eyebrow">Remember it</span>
                      <p className="memory-aid-text">{feedback.memoryAid}</p>
                    </div>
                  ))}
              </div>
            )}

            {!feedback ? (
              <button className="primary" disabled={selected == null} onClick={handleSubmit}>
                Submit answer
              </button>
            ) : (
              <button className="primary" onClick={handleNext}>Next question</button>
            )}

            <div className="quiz-skip">
              <button
                className="link"
                onClick={handleSkipQuestion}
                title="Remove this question from your quiz. It won’t come back."
              >
                Skip question
              </button>
              <button
                className="link"
                onClick={handleSkipTopic}
                title="Stop asking about this topic."
              >
                Skip this topic
              </button>
              {!lockedIn && <button className="link quiz-exit" onClick={onExit}>Exit quiz</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
