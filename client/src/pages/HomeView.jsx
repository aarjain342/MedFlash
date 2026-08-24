import { useMemo, useState } from 'react';
import StatsSummary from '../components/StatsSummary';
import ChatPanel from '../components/ChatPanel';
import { isDue } from '../lib/leitner';
import { getStreak, getWeekView } from '../lib/streak';

function StreakCalendar() {
  const streak = getStreak();
  const week = useMemo(() => getWeekView(), []);

  return (
    <div className="streak-calendar" title={streak > 0 ? `${streak}-day study streak` : 'No active streak yet'}>
      <div className="streak-calendar-count">
        <span aria-hidden="true">🔥</span>
        <span>{streak}</span>
        <span className="muted small">day{streak === 1 ? '' : 's'}</span>
      </div>
      <div className="streak-calendar-days">
        {week.map((d) => (
          <div
            key={d.date}
            className={`streak-day ${d.active ? 'active' : ''} ${d.isToday ? 'today' : ''}`}
            title={d.date}
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function DueTodayWidget({ decks, onStudy }) {
  const loadedDecks = decks.filter((d) => d.cards);
  const stillLoading = decks.length > 0 && loadedDecks.length < decks.length;

  const dueByDeck = useMemo(
    () =>
      loadedDecks
        .map((d) => ({ deck: d, due: d.cards.filter(isDue).length }))
        .filter((d) => d.due > 0)
        .sort((a, b) => b.due - a.due),
    [loadedDecks]
  );
  const totalDue = dueByDeck.reduce((sum, d) => sum + d.due, 0);

  return (
    <div className="panel due-today-panel">
      <h2>Due today</h2>
      {stillLoading && dueByDeck.length === 0 ? (
        <div className="decks-loading">
          <span className="spinner" aria-hidden="true" />
          <span className="muted">Loading…</span>
        </div>
      ) : totalDue === 0 ? (
        <p className="muted">Nothing due right now — you're all caught up.</p>
      ) : (
        <>
          <p className="due-today-count">{totalDue}</p>
          <p className="muted small">card{totalDue === 1 ? '' : 's'} across {dueByDeck.length} deck{dueByDeck.length === 1 ? '' : 's'}</p>
          <button className="primary small" onClick={() => onStudy(dueByDeck[0].deck)}>
            Study "{dueByDeck[0].deck.name}"
          </button>
        </>
      )}
    </div>
  );
}

function RandomCardWidget({ decks }) {
  const loadedDecks = decks.filter((d) => d.cards && d.cards.length > 0);
  const [seed, setSeed] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const pick = useMemo(() => {
    if (loadedDecks.length === 0) return null;
    const deck = loadedDecks[Math.floor(Math.random() * loadedDecks.length)];
    const card = deck.cards[Math.floor(Math.random() * deck.cards.length)];
    return { deck, card };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedDecks.length, seed]);

  if (!pick) return null;

  return (
    <div className="panel random-card-panel">
      <div className="random-card-header">
        <h2>Quick recall</h2>
        <button
          className="ghost small"
          onClick={() => {
            setSeed((s) => s + 1);
            setFlipped(false);
          }}
        >
          Shuffle
        </button>
      </div>
      <p className="muted small">A random card from "{pick.deck.name}" — see if it's stuck.</p>
      <button className="random-card-flip" onClick={() => setFlipped((f) => !f)}>
        <span className="random-card-label">{flipped ? 'Answer' : 'Question'}</span>
        <span className="random-card-text">{flipped ? pick.card.answer : pick.card.question}</span>
        <span className="muted small random-card-hint">Click to {flipped ? 'flip back' : 'reveal answer'}</span>
      </button>
    </div>
  );
}

export default function HomeView({ userLabel, decks, onNavigate, onStudy }) {
  const [chatExpanded, setChatExpanded] = useState(false);

  return (
    <div className="home-grid">
      <div className="home-grid-main">
        <div className="panel home-greeting">
          <div className="home-greeting-top">
            <div>
              <h1>Welcome back{userLabel ? `, ${userLabel}` : ''}</h1>
              <p className="muted">Here's how your studying is going, and an assistant if you need one.</p>
            </div>
            <StreakCalendar />
          </div>
          <div className="home-quick-actions">
            <button className="primary" onClick={() => onNavigate('decks')}>Generate flashcards</button>
            <button className="ghost" onClick={() => onNavigate('questions')}>View questions</button>
          </div>
        </div>

        <StatsSummary />
      </div>

      {chatExpanded && <div className="chat-overlay-backdrop" onClick={() => setChatExpanded(false)} />}
      <div className={`panel home-chat-panel ${chatExpanded ? 'expanded' : ''}`}>
        <div className="home-chat-panel-header">
          <div>
            <h2>Ask MedFlash</h2>
            <p className="muted">A study assistant for quick medical questions — not a substitute for real coursework.</p>
          </div>
          <button className="ghost small chat-expand-toggle" onClick={() => setChatExpanded((e) => !e)}>
            {chatExpanded ? 'Back' : 'Expand'}
          </button>
        </div>
        <ChatPanel />
      </div>

      <div className="home-widget-row">
        <DueTodayWidget decks={decks} onStudy={onStudy} />
        <RandomCardWidget decks={decks} />
      </div>
    </div>
  );
}
