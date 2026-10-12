import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Brand from '../components/Brand';
import './Landing.css';

const DEMO_CARD = {
  topic: 'Fertilization',
  question: 'What triggers the block to polyspermy?',
  answer:
    'Sperm–oocyte fusion triggers cortical granule exocytosis, which hardens the zona pellucida and stops any further sperm from getting in.',
};

const DEMO_QUESTION = {
  stem:
    'A 24-year-old woman undergoes IVF. Twelve hours after sperm injection, the embryologist notes the oocyte has not extruded a second polar body and no pronuclei have formed. Which of the following best explains this?',
  options: [
    'Failure of cortical granule exocytosis',
    'Failure of sperm–oocyte membrane fusion',
    'Premature zona pellucida hardening before fertilization',
    'Arrest in metaphase I instead of metaphase II',
    'Loss of maternal centrioles',
  ],
  correctIndex: 1,
  explanation:
    'Sperm–oocyte fusion is what releases the oocyte from its metaphase II arrest, letting it complete meiosis II (extruding the second polar body) and form pronuclei. Without fusion, that whole cascade never fires. Cortical granule release and zona hardening are downstream of fusion, not the cause of this failure.',
};

// Plays upload → generating → ready once, then leaves the card fully interactive (click to
// flip). It deliberately doesn't loop, so it never yanks control away mid-interaction; "Replay"
// runs it again on demand. It starts when it scrolls into view, not on page load.
function LiveDemo() {
  const [phase, setPhase] = useState('idle'); // idle | upload | generating | ready
  const [progress, setProgress] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showExportNote, setShowExportNote] = useState(false);
  const timers = useRef([]);
  const rootRef = useRef(null);
  const hasPlayedRef = useRef(false);

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  function play() {
    clearTimers();
    setFlipped(false);
    setShowExportNote(false);
    setProgress(0);
    setPhase('upload');

    timers.current.push(
      setTimeout(() => {
        setPhase('generating');
        const start = Date.now();
        const duration = 1600;
        const tick = () => {
          const pct = Math.min(100, Math.round(((Date.now() - start) / duration) * 100));
          setProgress(pct);
          if (pct < 100) {
            timers.current.push(setTimeout(tick, 60));
          } else {
            timers.current.push(setTimeout(() => setPhase('ready'), 250));
          }
        };
        tick();
      }, 1200)
    );
  }

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasPlayedRef.current) {
          hasPlayedRef.current = true;
          play();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="demo" ref={rootRef}>
      <div className="demo-bar">
        <span className="eyebrow">Live demo</span>
        {phase === 'ready' && (
          <button type="button" className="link small" onClick={play}>
            Replay
          </button>
        )}
      </div>

      <div className="demo-stage">
        {(phase === 'idle' || phase === 'upload') && (
          <div className="demo-center">
            <span className="demo-file">
              <b>PDF</b> embryology-lecture.pdf
            </span>
            <p className="muted small">{phase === 'idle' ? 'Waiting…' : 'Uploading…'}</p>
          </div>
        )}

        {phase === 'generating' && (
          <div className="demo-center">
            <span className="demo-file">
              <b>PDF</b> embryology-lecture.pdf
            </span>
            <div className="progress demo-progress">
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <p className="muted small">Writing flashcards from your slides…</p>
          </div>
        )}

        {phase === 'ready' && (
          <div className="demo-ready">
            <button
              type="button"
              className={`demo-card ${flipped ? 'is-answer' : ''}`}
              onClick={() => setFlipped((f) => !f)}
            >
              <span className="topic-tag">{DEMO_CARD.topic}</span>
              <span className="demo-card-text">{flipped ? DEMO_CARD.answer : DEMO_CARD.question}</span>
              <span className="demo-card-hint">{flipped ? 'Click to see the question' : 'Click to reveal the answer'}</span>
            </button>
            <div className="demo-actions">
              <button
                type="button"
                className="ghost small"
                onClick={() => setShowExportNote(true)}
                onBlur={() => setShowExportNote(false)}
              >
                Export to Anki
              </button>
              {showExportNote && <span className="demo-note">Just a preview here. Sign up to export for real.</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
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

function SampleQuestion() {
  const [selected, setSelected] = useState(null);
  const answered = selected != null;

  return (
    <div className="panel sample-question">
      <div className="quiz-question-header">
        <span className="quiz-topic-tag">Fertilization</span>
        <DifficultyDots tier={4} />
      </div>
      <p className="quiz-stem">{DEMO_QUESTION.stem}</p>
      <div className="quiz-options">
        {DEMO_QUESTION.options.map((opt, i) => {
          let cls = 'quiz-option';
          if (answered) {
            if (i === DEMO_QUESTION.correctIndex) cls += ' correct';
            else if (i === selected) cls += ' incorrect';
          }
          return (
            <button key={i} className={cls} disabled={answered} onClick={() => setSelected(i)}>
              <span className="quiz-key" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
              <span className="quiz-option-text">{opt}</span>
            </button>
          );
        })}
      </div>
      {answered && (
        <div className={`quiz-feedback ${selected === DEMO_QUESTION.correctIndex ? 'correct' : 'incorrect'}`}>
          <p className="quiz-feedback-verdict">
            {selected === DEMO_QUESTION.correctIndex ? 'Correct.' : 'Not quite.'}
          </p>
          <p>{DEMO_QUESTION.explanation}</p>
        </div>
      )}
      {!answered && <p className="muted small">Pick an answer to see the explanation.</p>}
    </div>
  );
}

const STEPS = [
  {
    title: 'Upload',
    text: 'A PDF, PowerPoint or Word file. For PDFs the slide images come along too.',
  },
  {
    title: 'Generate',
    text: 'Each section becomes one or two cards, rewritten in plain language. Tables and mnemonics appear only when they help.',
  },
  {
    title: 'Study',
    text: 'Flip cards, take board-style questions built from the same deck, or export it all to Anki.',
  },
];

const FEATURES = [
  ['Flashcards', 'Every section of your file is covered, including the ones the lecturer only mentioned in passing.'],
  ['USMLE questions', 'Clinical-vignette questions from your own deck. Difficulty climbs as you master each topic, and new questions stream in while you answer.'],
  ['Anatomy quiz', 'Upload a labeled-diagram PDF. MedFlash finds every label, hides one at a time, and you type it from memory.'],
  ['Focus mode', 'Full-screen timed sessions with a little friction against quitting early.'],
  ['Anki export', 'A real .apkg with your cards, tables and slide images.'],
  ['Ask', 'A medical Q&A assistant for the moment you get stuck.'],
  ['Keyboard first', 'Space to flip, 1 and 2 to grade, A to E to answer, Ctrl K to jump anywhere. Dark mode included.'],
];

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Brand as={Link} to="/" />
          <nav className="landing-links" aria-label="Page sections">
            <a href="#how-it-works">How it works</a>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="landing-nav-actions">
            <Link to="/login" className="landing-signin">Sign in</Link>
            <Link to="/signup" className="btn btn-primary">Start free</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">For medical students</p>
            <h1>
              Slides in.
              <br />
              <mark>Study material</mark>
              <br />
              out.
            </h1>
            <p className="hero-sub">
              Upload a lecture PDF. MedFlash writes the flashcards, builds board-style questions from them, and turns
              labeled diagrams into a quiz you type your way through.
            </p>
            <div className="hero-actions">
              <Link to="/signup" className="btn btn-primary">Start free</Link>
              <a href="#how-it-works" className="btn btn-ghost">See how it works</a>
            </div>
            <p className="hero-note">The free plan includes 3 decks. No card needed.</p>
          </div>
          <LiveDemo />
        </section>

        <section id="how-it-works" className="l-section">
          <div className="l-head">
            <h2>How it works</h2>
          </div>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="num step-num">{i + 1}</span>
                <h3>{s.title}</h3>
                <p className="muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="l-section">
          <div className="l-head">
            <h2>Then quiz yourself</h2>
            <p className="muted">Board-style questions, generated from the same deck.</p>
          </div>
          <SampleQuestion />
        </section>

        <section id="features" className="l-section">
          <div className="l-head">
            <h2>What’s in it</h2>
          </div>
          <dl className="spec">
            {FEATURES.map(([name, text]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="pricing" className="l-section">
          <div className="l-head">
            <h2>Pricing</h2>
            <p className="muted">Free to try. $15 a month when you want no limits.</p>
          </div>
          <table className="plans">
            <thead>
              <tr>
                <td />
                <th scope="col">Free</th>
                <th scope="col" className="plans-pro">Pro</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Price</th>
                <td>$0</td>
                <td className="plans-pro">$15 / month</td>
              </tr>
              <tr>
                <th scope="row">Decks</th>
                <td>3</td>
                <td className="plans-pro">Unlimited</td>
              </tr>
              <tr>
                <th scope="row">AI generations</th>
                <td>10 / month</td>
                <td className="plans-pro">Unlimited</td>
              </tr>
              <tr>
                <th scope="row">Chat messages</th>
                <td>20 / month</td>
                <td className="plans-pro">Unlimited</td>
              </tr>
              <tr className="plans-cta">
                <td />
                <td><Link to="/signup" className="btn btn-ghost">Start free</Link></td>
                <td className="plans-pro"><Link to="/signup" className="btn btn-primary">Get Pro</Link></td>
              </tr>
            </tbody>
          </table>
          <p className="muted small plans-note">Upgrade any time from Settings after you sign up.</p>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <Brand />
          <span className="muted small">© {new Date().getFullYear()} MedFlash</span>
        </div>
      </footer>
    </div>
  );
}
