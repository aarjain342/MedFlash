import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './Landing.css';

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
      <path d="M5 12.5l4.5 4.5L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <circle cx="12" cy="12" r="9" stroke="#12141a" strokeWidth="1.6" />
      <path d="M12 7v5l3.5 2" stroke="#12141a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const DEMO_CARD = {
  topic: 'Fertilization',
  question: 'What triggers the block to polyspermy?',
  answer:
    "Sperm–oocyte fusion triggers cortical granule exocytosis, which hardens the zona pellucida and stops any further sperm from getting in.",
};

const DEMO_QUESTION = {
  stem:
    "A 24-year-old woman undergoes IVF. Twelve hours after sperm injection, the embryologist notes the oocyte has not extruded a second polar body and no pronuclei have formed. Which of the following best explains this?",
  options: [
    'Failure of cortical granule exocytosis',
    'Failure of sperm–oocyte membrane fusion',
    'Premature zona pellucida hardening before fertilization',
    'Arrest in metaphase I instead of metaphase II',
    'Loss of maternal centrioles',
  ],
  correctIndex: 1,
  explanation:
    "Sperm–oocyte fusion is what releases the oocyte from its metaphase II arrest, letting it complete meiosis II (extruding the second polar body) and form pronuclei. Without fusion, that whole cascade never fires — cortical granule release and zona hardening are downstream of fusion, not the cause of this failure.",
};

// Auto-plays upload → generating → ready once on mount, then leaves the card fully
// interactive (flip on click) — deliberately doesn't loop indefinitely so it doesn't yank
// control away from someone mid-interaction. "Replay" re-triggers it on demand.
function LiveDemoSection() {
  const [phase, setPhase] = useState('upload'); // upload | generating | ready
  const [progress, setProgress] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showExportNote, setShowExportNote] = useState(false);
  const timers = useRef([]);

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
      }, 1400)
    );
  }

  const sectionRef = useRef(null);
  const hasPlayedRef = useRef(false);

  // Only starts once the section actually scrolls into view, not on page load — otherwise
  // it plays out entirely off-screen while someone's still reading the hero above it.
  useEffect(() => {
    const node = sectionRef.current;
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
    <section className="demo-section" ref={sectionRef}>
      <div className="feature-section-header">
        <span className="eyebrow">See it work</span>
        <h2>From lecture slide to flashcard</h2>
      </div>

      <div className="demo-stage">
        {phase === 'upload' && (
          <div className="demo-panel demo-upload">
            <div className="demo-file-chip">
              <span className="demo-file-icon" aria-hidden="true">📄</span>
              <span>embryology-lecture.pdf</span>
            </div>
            <p className="muted small">Uploading…</p>
          </div>
        )}

        {phase === 'generating' && (
          <div className="demo-panel demo-generating">
            <p className="muted small">Generating flashcards from your slides…</p>
            <div className="progress-bar demo-progress-bar">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {phase === 'ready' && (
          <div className="demo-ready">
            <button
              type="button"
              className={`demo-flashcard ${flipped ? 'flipped' : ''}`}
              onClick={() => setFlipped((f) => !f)}
            >
              <span className="demo-flashcard-topic">{DEMO_CARD.topic}</span>
              <span className="demo-flashcard-label">{flipped ? 'Answer' : 'Question'}</span>
              <span className="demo-flashcard-text">{flipped ? DEMO_CARD.answer : DEMO_CARD.question}</span>
              <span className="muted small">Click to {flipped ? 'flip back' : 'reveal answer'}</span>
            </button>

            <div className="demo-actions">
              <div className="demo-export-wrap">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowExportNote(true)}
                  onBlur={() => setShowExportNote(false)}
                >
                  Export to Anki
                </button>
                {showExportNote && (
                  <span className="demo-export-note">Just a preview here — sign up to export for real.</span>
                )}
              </div>
              <button type="button" className="link small" onClick={play}>
                Replay
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
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

function ExampleQuizSection() {
  const [selected, setSelected] = useState(null);

  return (
    <section className="demo-section">
      <div className="feature-section-header">
        <span className="eyebrow">Then quiz yourself</span>
        <h2>Board-style questions, generated from that same deck</h2>
      </div>

      <div className="demo-quiz-panel">
        <div className="demo-quiz-header">
          <span className="quiz-topic-tag">Fertilization</span>
          <DifficultyDots tier={4} />
        </div>
        <p className="demo-quiz-stem">{DEMO_QUESTION.stem}</p>
        <div className="demo-quiz-options">
          {DEMO_QUESTION.options.map((opt, i) => {
            let cls = 'quiz-option';
            if (selected != null) {
              if (i === DEMO_QUESTION.correctIndex) cls += ' correct';
              else if (i === selected) cls += ' incorrect';
            }
            return (
              <button key={i} className={cls} disabled={selected != null} onClick={() => setSelected(i)}>
                {opt}
              </button>
            );
          })}
        </div>
        {selected != null && (
          <div className={`quiz-feedback ${selected === DEMO_QUESTION.correctIndex ? 'correct' : 'incorrect'}`}>
            <p className="quiz-feedback-verdict">
              {selected === DEMO_QUESTION.correctIndex ? 'Correct!' : "Not quite."}
            </p>
            <p>{DEMO_QUESTION.explanation}</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">MedFlash</span>
        </div>
        <nav className="landing-links">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="landing-nav-actions">
          <Link to="/login" className="nav-link">Sign in</Link>
          <Link to="/signup" className="pill-button">Get started</Link>
        </div>
      </header>

      <section className="hero-section">
        <div className="hero-visual">
          <div className="float-card sticky-note">
            <p>Upload your lecture slides and let MedFlash pull out every topic worth knowing.</p>
            <span className="pin" aria-hidden="true" />
          </div>
          <div className="float-badge check-badge" aria-hidden="true">
            <CheckIcon />
          </div>

          <div className="float-card reminder-card">
            <div className="reminder-card-title">Study reminder</div>
            <div className="reminder-row">
              <span className="reminder-dot" />
              <div>
                <div className="reminder-row-title">Cardio deck due</div>
                <div className="reminder-row-time">42 cards · 6:00 – 6:45pm</div>
              </div>
            </div>
          </div>
          <div className="float-badge clock-badge" aria-hidden="true">
            <ClockIcon />
          </div>

          <div className="hero-copy">
            <h1>
              Turn slides into
              <br />
              <span className="hero-muted">flashcards that stick.</span>
            </h1>
            <p className="hero-sub">Upload a lecture PDF, get clean study cards in minutes.</p>
            <Link to="/signup" className="pill-button hero-cta">Get started free</Link>
          </div>

          <div className="float-card mock-deck-card">
            <div className="deck-card-title">Today's deck</div>
            <div className="deck-row">
              <span className="deck-tag tag-red">Cardiac cycle</span>
              <span className="deck-progress"><span style={{ width: '60%' }} /></span>
            </div>
            <div className="deck-row">
              <span className="deck-tag tag-green">Heart sounds</span>
              <span className="deck-progress"><span style={{ width: '85%' }} /></span>
            </div>
          </div>

          <div className="float-card integrations-card">
            <div className="integrations-title">Works with</div>
            <div className="integrations-icons">
              <span className="integration-badge badge-red">PDF</span>
              <span className="integration-badge badge-blue">AI</span>
              <span className="integration-badge badge-dark">Anki</span>
            </div>
          </div>
        </div>
      </section>

      <LiveDemoSection />
      <ExampleQuizSection />

      <section id="features" className="feature-section-wrap">
        <div className="feature-section-header">
          <span className="eyebrow">Features</span>
          <h2>Everything you need to actually learn it</h2>
        </div>
        <div className="feature-section">
          <div className="feature-card">
            <h3>Any format, one pipeline</h3>
            <p className="muted">Upload a PDF, PowerPoint, or Word doc — MedFlash reads the text (and slide images for PDFs) section by section.</p>
          </div>
          <div className="feature-card">
            <h3>Slide by slide</h3>
            <p className="muted">Every topic gets covered, even the ones just briefly mentioned — nothing skipped.</p>
          </div>
          <div className="feature-card">
            <h3>Actually explained</h3>
            <p className="muted">Cards rewrite the slide in plain, approachable language instead of parroting it back at you.</p>
          </div>
          <div className="feature-card">
            <h3>Tables &amp; memory tricks</h3>
            <p className="muted">Naturally tabular content becomes an actual table, and a mnemonic gets added — but only when one really fits.</p>
          </div>
          <div className="feature-card">
            <h3>Adaptive USMLE-style quiz</h3>
            <p className="muted">Board-style clinical vignette questions generated straight from your own deck, getting harder as you master each topic.</p>
          </div>
          <div className="feature-card">
            <h3>Answer while it keeps generating</h3>
            <p className="muted">No waiting for the whole quiz to build — new questions stream in behind the scenes while you work through what's ready.</p>
          </div>
          <div className="feature-card">
            <h3>Study your way</h3>
            <p className="muted">Slide order or shuffled, easy vocab or hard clinical application, jump to any question — your call.</p>
          </div>
          <div className="feature-card">
            <h3>Locked-in focus sessions</h3>
            <p className="muted">Full-screen, timed study blocks with real friction against bailing out early.</p>
          </div>
          <div className="feature-card">
            <h3>Export to Anki</h3>
            <p className="muted">One click gets you a real .apkg — cards, tables, and slide images included.</p>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <span className="muted small">© {new Date().getFullYear()} MedFlash</span>
      </footer>
    </div>
  );
}
