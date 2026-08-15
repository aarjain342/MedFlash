import { useEffect, useRef, useState } from 'react';
import { generateQuizStream } from '../lib/quizApi';
import { initQuizState, getCurrentQuestion, submitAnswer, getTopicSummaries } from '../lib/quizEngine';
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

export default function QuizView({ deck, onExit }) {
  const [phase, setPhase] = useState('loading'); // loading | generating | ready | complete | error
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
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
    const topicResults = new Map();
    let total = 0;

    try {
      await generateQuizStream(deck.cards, ({ type, data }) => {
        if (type === 'start') {
          total = data.totalTopics;
          setGenProgress({ done: 0, total });
        } else if (type === 'topic') {
          topicResults.set(data.topic, data.questions);
          setGenProgress((p) => ({ done: p.done + 1, total }));
        } else if (type === 'topic-error') {
          setGenProgress((p) => ({ done: p.done + 1, total }));
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
    const result = submitAnswer(quizState, current.topicName, current.presented, selected);
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

  return (
    <div className="quiz-layout">
      <div className="panel quiz-panel">
        {phase === 'loading' && <p className="muted">Loading…</p>}

        {phase === 'generating' && (
          <div>
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
          </div>
        )}

        {phase === 'error' && (
          <div>
            <p className="error">{error}</p>
            <button className="primary" onClick={generate}>Try again</button>
            <button className="link" onClick={onExit}>Back to decks</button>
          </div>
        )}

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

      {topicSummaries.length > 0 && (
        <div className="panel quiz-sidebar">
          <h3>Topics</h3>
          <ul className="topic-mastery-list">
            {topicSummaries.map((t) => (
              <li
                key={t.name}
                className={`topic-mastery-item ${t.mastered ? 'mastered' : ''} ${
                  current?.topicName === t.name ? 'active' : ''
                }`}
              >
                <span className="topic-mastery-name" title={t.name}>
                  {t.mastered ? '✓ ' : ''}
                  {t.name}
                </span>
                {!t.mastered && <DifficultyDots tier={t.tier} />}
                {t.struggling && !t.mastered && <span className="struggling-badge">practicing</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
