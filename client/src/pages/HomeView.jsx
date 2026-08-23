import StatsSummary from '../components/StatsSummary';
import ChatPanel from '../components/ChatPanel';

export default function HomeView({ userLabel, onNavigate }) {
  return (
    <>
      <div className="panel home-greeting">
        <h1>Welcome back{userLabel ? `, ${userLabel}` : ''}</h1>
        <p className="muted">Here's how your studying is going, and an assistant if you need one.</p>
        <div className="home-quick-actions">
          <button className="primary" onClick={() => onNavigate('decks')}>Generate flashcards</button>
          <button className="ghost" onClick={() => onNavigate('questions')}>View questions</button>
        </div>
      </div>

      <StatsSummary />

      <div className="panel">
        <h2>Ask MedFlash</h2>
        <p className="muted">A study assistant for quick medical questions — not a substitute for real coursework.</p>
        <ChatPanel />
      </div>
    </>
  );
}
