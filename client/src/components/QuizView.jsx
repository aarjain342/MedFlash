import { useEffect, useRef, useState } from 'react';
import { generateQuizStream } from '../lib/quizApi';
import {
  initQuizState,
  getCurrentQuestion,
  submitAnswer,
  getTopicSummaries,
  getOverallStats,
} from '../lib/quizEngine';
import { loadQuizState, saveQuizState } from '../lib/db';

function DifficultyDots({ tier }) {
  return (
    <span className="difficulty-dots" title={`Difficulty ${tier} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={n <= tier ? 'dot filled' : 'dot'} />
      ))}
    </span>
  );
}

export default function QuizView({ deck, onExit, onStudy }) {
  const [phase, setPhase] = useState('loading'); // loading | generating | ready | complete | error
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [liveTopics, setLiveTopics] = useState([]); // [{ name, questions, error }] — grows as SSE events arrive
  const [expandedTopic, setExpandedTopic] = useState(null);
  const [flashcardsOpen, setFlashcardsOpen] = useState(true);
  const [questionsOpen, setQuestionsOpen] = useState(true);
  const [error, setError] = useState('');
  const [quizState, setQuizState] = useState(null);
  const [current, setCurrent] = useState(null); // { topicName, tier, presented }
  const [selected, setSelected] = useState(null);
  const [feedback, setFeedback] = useState(null); // { correct, explanation }
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap() {
    const saved = await loadQuizState(deck.id);
    if (saved) {
      setQuizState(saved);
      const next = getCurrentQuestion(saved);
      if (!next) {
        setPhase('complete');
      } else {
        setCurrent(next);
        setPhase('ready');
      }
      return;
    }
    await generate();
  }

  async function generate() {
    setPhase('generating');
    setError('');
    setLiveTopics([]);
    const topicResults = new Map();
    let total = 0;

    try {
      // Only topic/question/answer feed the quiz prompt — strip everything else (notably
      // the base64 slide images) so the request body stays small regardless of deck size.
      const promptCards = deck.cards.map((c) => ({
        topic: c.topic,
        question: c.question,
        answer: c.answer,
      }));

      await generateQuizStream(promptCards, ({ type, data }) => {
        if (type === 'start') {
          total = data.totalTopics;
          setGenProgress({ done: 0, total });
        } else if (type === 'topic') {
          topicResults.set(data.topic, data.questions);
          setGenProgress((p) => ({ done: p.done + 1, total }));
          setLiveTopics((t) => [...t, { name: data.topic, questions: data.questions }]);
        } else if (type === 'topic-error') {
          setGenProgress((p) => ({ done: p.done + 1, total }));
          setLiveTopics((t) => [...t, { name: data.topic, error: data.error }]);
        } else if (type === 'fatal-error') {
          throw new Error(data.error);
        }
      });

      const topics = [...topicResults.entries()].map(([name, questions]) => ({ name, questions }));
      if (topics.length === 0) throw new Error('No quiz questions could be generated for this deck.');

      const state = initQuizState(topics);
      await saveQuizState(deck.id, state);
      setQuizState(state);

      const next = getCurrentQuestion(state);
      if (!next) {
        setPhase('complete');
      } else {
        setCurrent(next);
        setPhase('ready');
      }
    } catch (err) {
      setError(err.message);
      setPhase('error');
    }
  }

  function handleSubmit() {
    if (selected == null || !current || !quizState) return;
    const result = submitAnswer(quizState, current.topicName, current.index, current.presented, selected);
    setFeedback({ correct: result.correct, explanation: current.presented.explanation });
    void saveQuizState(deck.id, quizState);
  }

  function handleNext() {
    setSelected(null);
    setFeedback(null);
    const next = getCurrentQuestion(quizState);
    if (!next) {
      setPhase('complete');
    } else {
      setCurrent(next);
    }
  }

  const topicSummaries = quizState ? getTopicSummaries(quizState) : [];
  const stats = quizState ? getOverallStats(quizState) : { correct: 0, wrong: 0, attempted: 0, accuracy: null };

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

  if (phase === 'generating') {
    return (
      <div className="quiz-centered">
        <div className="panel quiz-generating-panel">
          <h2>Building your USMLE-style quiz</h2>
          <p className="muted">
            Generating progressively harder questions for each topic in "{deck.name}"…
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
                      {t.error ? 'failed' : `${t.questions.length} questions`}
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
          <button className="primary" onClick={generate}>Try again</button>
          <button className="link" onClick={onExit}>Back to decks</button>
        </div>
      </div>
    );
  }

  return (
    <div className="quiz-layout">
      <div className="panel quiz-sidebar">
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
              {topicSummaries.map((t) => (
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
                    <DifficultyDots tier={t.tier} />
                  </button>

                  {expandedTopic === t.name && (
                    <ul className="question-tree-list">
                      {t.questions.map((q) => {
                        const isActive = current?.topicName === t.name && current.index === q.index;
                        const status = q.correct ? 'correct' : q.wrong > 0 ? 'wrong' : 'unattempted';
                        return (
                          <li key={q.index} className={`question-tree-item ${status} ${isActive ? 'active' : ''}`}>
                            <span className={`question-status-icon ${status}`} aria-hidden="true">
                              {status === 'correct' ? '✓' : status === 'wrong' ? '✗' : '•'}
                            </span>
                            <span className="question-tree-stem">{q.stem}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="panel quiz-panel">
        {phase === 'ready' && current && (
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
                  {feedback.correct ? "Correct!" : "Not quite — you'll see this topic again."}
                </p>
                <p>{feedback.explanation}</p>
              </div>
            )}

            {!feedback ? (
              <button className="primary" disabled={selected == null} onClick={handleSubmit}>
                Submit answer
              </button>
            ) : (
              <button className="primary" onClick={handleNext}>Next question</button>
            )}

            <button className="link" onClick={onExit}>Exit quiz</button>
          </div>
        )}

        {phase === 'complete' && (
          <div>
            <h2>Quiz complete!</h2>
            <p>You've mastered every topic in "{deck.name}" — nice work.</p>
            <button className="primary" onClick={onExit}>Back to decks</button>
          </div>
        )}
      </div>
    </div>
  );
}
