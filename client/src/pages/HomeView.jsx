import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import StatsSummary from '../components/StatsSummary';
import ActivityHeatmap from '../components/ActivityHeatmap';
import ChatPanel from '../components/ChatPanel';
import { isDue } from '../lib/leitner';
import { deckHue } from '../lib/deckColor';
import { getBillingStatus } from '../lib/billingApi';

// Guest mode has no account to bill, and a billing-not-configured 503 is a real state
// this app tolerates elsewhere (see planLimit.js failing open) — either way this badge
// should just quietly not render rather than show an error on the home page.
function PlanBadge({ guestMode, onManage }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (guestMode) return;
    let cancelled = false;
    getBillingStatus()
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [guestMode]);

  if (guestMode || !status) return null;
  const isPro = status.status === 'active' || status.status === 'trialing';

  return (
    <button className="plan-badge" onClick={onManage} title={isPro ? 'Manage subscription' : 'Upgrade to MedFlash Pro'}>
      <span className={`plan-badge-dot ${isPro ? 'pro' : ''}`} aria-hidden="true" />
      {isPro ? 'Pro' : 'Free plan'}
    </button>
  );
}

// Which decks have cards due, most-overdue first. Decks whose cards are still loading are
// left out of the count (and `stillLoading` says so) rather than shown as zero.
function useDueByDeck(decks) {
  return useMemo(() => {
    const loaded = decks.filter((d) => d.cards);
    const dueByDeck = loaded
      .map((deck) => ({ deck, due: deck.cards.filter(isDue).length }))
      .filter((entry) => entry.due > 0)
      .sort((a, b) => b.due - a.due);
    return {
      dueByDeck,
      totalDue: dueByDeck.reduce((sum, entry) => sum + entry.due, 0),
      stillLoading: decks.length > 0 && loaded.length < decks.length,
    };
  }, [decks]);
}

function DueNow({ due, onStudy, onNavigate, hasDecks }) {
  const { dueByDeck, totalDue, stillLoading } = due;
  const top = dueByDeck[0];

  return (
    <section className="panel due-now">
      <p className="eyebrow">Due now</p>
      {stillLoading && dueByDeck.length === 0 ? (
        <div className="decks-loading">
          <span className="spinner" aria-hidden="true" />
          <span>Loading your cards…</span>
        </div>
      ) : totalDue === 0 ? (
        <>
          <p className="due-zero">{hasDecks ? 'All caught up' : 'No decks yet'}</p>
          <p className="muted">
            {hasDecks ? 'Nothing is due. A quiz is a good use of the time.' : 'Upload lecture slides and your first deck appears here.'}
          </p>
          <button className="primary" onClick={() => onNavigate(hasDecks ? 'questions' : 'decks')}>
            {hasDecks ? 'Take a quiz' : 'Create a deck'}
          </button>
        </>
      ) : (
        <>
          <p className="due-count num">
            <mark>{totalDue}</mark>
          </p>
          <p className="due-caption">
            card{totalDue === 1 ? '' : 's'} due across {dueByDeck.length} deck{dueByDeck.length === 1 ? '' : 's'}
          </p>
          <button className="primary" onClick={() => onStudy(top.deck)}>
            Review {top.deck.name}
          </button>
        </>
      )}
    </section>
  );
}

function DeckShortlist({ decks, due, onStudy, onNavigate }) {
  const dueById = useMemo(() => new Map(due.dueByDeck.map((e) => [e.deck.id, e.due])), [due]);
  const shown = useMemo(
    () => [...decks].sort((a, b) => (dueById.get(b.id) || 0) - (dueById.get(a.id) || 0)).slice(0, 5),
    [decks, dueById]
  );

  return (
    <section className="panel deck-panel">
      <div className="panel-head">
        <h2>Decks</h2>
        <button className="link small" onClick={() => onNavigate('decks')}>All decks</button>
      </div>
      {decks.length === 0 ? (
        <p className="muted">No decks yet.</p>
      ) : (
        <ul className="ledger">
          {shown.map((deck) => {
            const dueCount = dueById.get(deck.id) || 0;
            return (
              <li className="ledger-row" data-hue={deckHue(deck.id)} key={deck.id}>
                <span className="deck-chip" aria-hidden="true" />
                <div className="ledger-main">
                  <h3>{deck.name}</h3>
                  <p className="muted small">
                    {deck.cards ? `${deck.cards.length} cards` : 'Loading…'}
                    {dueCount > 0 && <mark className="due-tag">{dueCount} due</mark>}
                  </p>
                </div>
                <div className="ledger-actions">
                  <button className="ghost small" disabled={!deck.cards} onClick={() => onStudy(deck)}>
                    Study
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RandomCard({ decks }) {
  const loadedDecks = decks.filter((d) => d.cards && d.cards.length > 0);
  // Same "still fetching full card data in the background" signal the due count uses; without
  // it the whole panel used to be missing until the fetch finished, then pop in.
  const stillLoading = decks.length > 0 && decks.some((d) => !d.cards);
  const [seed, setSeed] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const pick = useMemo(() => {
    if (loadedDecks.length === 0) return null;
    const deck = loadedDecks[Math.floor(Math.random() * loadedDecks.length)];
    const card = deck.cards[Math.floor(Math.random() * deck.cards.length)];
    return { deck, card };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedDecks.length, seed]);

  // Nothing to show and nothing coming: hide the panel entirely.
  if (!pick && !stillLoading) return null;

  return (
    <section className="panel random-card">
      <div className="panel-head">
        <h2>Quick recall</h2>
        <button
          className="link small"
          disabled={!pick}
          onClick={() => {
            setSeed((s) => s + 1);
            setFlipped(false);
          }}
        >
          Another card
        </button>
      </div>
      {!pick ? (
        <div className="decks-loading">
          <span className="spinner" aria-hidden="true" />
          <span>Loading…</span>
        </div>
      ) : (
        <button className={`random-card-flip ${flipped ? 'is-answer' : ''}`} onClick={() => setFlipped((f) => !f)}>
          <span className="eyebrow">{flipped ? 'Answer' : `Question · ${pick.deck.name}`}</span>
          <span className="random-card-text">{flipped ? pick.card.answer : pick.card.question}</span>
          <span className="random-card-hint">{flipped ? 'Tap to see the question' : 'Tap to reveal the answer'}</span>
        </button>
      )}
    </section>
  );
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function HomeView({ decks, onNavigate, onStudy, guestMode }) {
  const [chatExpanded, setChatExpanded] = useState(false);

  // Owned here, not inside ChatPanel — see the comment in ChatPanel.jsx for why.
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState('');

  const due = useDueByDeck(decks);

  const chatBlock = (
    <section className={`panel home-chat ${chatExpanded ? 'expanded' : ''}`}>
      <div className="panel-head">
        <div>
          <h2>Ask</h2>
          <p className="muted small">Medical Q&amp;A. Not a substitute for your coursework.</p>
        </div>
        <button className="link small" onClick={() => setChatExpanded((e) => !e)}>
          {chatExpanded ? 'Close' : 'Expand'}
        </button>
      </div>
      <ChatPanel
        messages={chatMessages}
        setMessages={setChatMessages}
        input={chatInput}
        setInput={setChatInput}
        sending={chatSending}
        setSending={setChatSending}
        error={chatError}
        setError={setChatError}
      />
    </section>
  );

  return (
    <div className="home">
      <header className="page-head">
        <div>
          <p className="eyebrow">{todayLabel()}</p>
          <h1>Today</h1>
        </div>
        <PlanBadge guestMode={guestMode} onManage={() => onNavigate('settings')} />
      </header>

      <div className="home-top">
        <DueNow due={due} onStudy={onStudy} onNavigate={onNavigate} hasDecks={decks.length > 0} />
        <ActivityHeatmap />
      </div>

      <div className="home-mid">
        <DeckShortlist decks={decks} due={due} onStudy={onStudy} onNavigate={onNavigate} />
        <StatsSummary />
      </div>

      <div className="home-bottom">
        <RandomCard decks={decks} />
        {chatExpanded
          ? createPortal(
              // Portalled to <body>: an ancestor with a transform (like a page-load animation)
              // would otherwise become the containing block for position:fixed and pin the
              // "fullscreen" chat to that box instead of the viewport.
              <>
                <div className="chat-overlay-backdrop" onClick={() => setChatExpanded(false)} />
                {chatBlock}
              </>,
              document.body
            )
          : chatBlock}
      </div>
    </div>
  );
}
