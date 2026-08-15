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

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i /><i /><i /><i />
          </span>
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

          <div className="float-card deck-card">
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

      <section id="features" className="feature-section">
        <div className="feature-card">
          <h3>Slide by slide</h3>
          <p className="muted">Every topic gets covered, even the ones just briefly mentioned — nothing skipped.</p>
        </div>
        <div className="feature-card">
          <h3>Actually explained</h3>
          <p className="muted">Cards rewrite the slide in plain language, with tables and memory tricks where they help.</p>
        </div>
        <div className="feature-card">
          <h3>Export to Anki</h3>
          <p className="muted">One click gets you a real .apkg — cards, tables, and slide images included.</p>
        </div>
      </section>

      <footer className="landing-footer">
        <span className="muted small">© {new Date().getFullYear()} MedFlash</span>
      </footer>
    </div>
  );
}
