import { useEffect, useState } from 'react';
import UploadPanel from '../components/UploadPanel';
import DeckList from '../components/DeckList';
import StudyView from '../components/StudyView';
import QuizView from '../components/QuizView';
import ErrorBoundary from '../components/ErrorBoundary';
import { loadDecks, upsertDeck, deleteDeck } from '../lib/db';
import { useAuth } from '../lib/AuthContext';
import { supabaseConfigured } from '../lib/supabaseClient';

export default function Dashboard() {
  const [decks, setDecks] = useState([]);
  const [studyingDeck, setStudyingDeck] = useState(null);
  const [quizzingDeck, setQuizzingDeck] = useState(null);
  const { user, signOut } = useAuth();

  useEffect(() => {
    loadDecks().then(setDecks);
  }, []);

  async function handleDeckCreated(deck) {
    setDecks(await upsertDeck(deck));
  }

  async function handleUpdateDeck(deck) {
    setDecks(await upsertDeck(deck));
    setStudyingDeck(deck);
  }

  async function handleDeleteDeck(id) {
    setDecks(await deleteDeck(id));
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i /><i /><i /><i />
          </span>
          <span className="brand-name">MedFlash</span>
        </div>
        <div className="topbar-user">
          {supabaseConfigured ? (
            <>
              <span className="muted small">{user?.email}</span>
              <button className="ghost" onClick={signOut}>Sign out</button>
            </>
          ) : (
            <span className="muted small">Guest mode — accounts not set up yet</span>
          )}
        </div>
      </header>

      <main className="app-main">
        {studyingDeck ? (
          <ErrorBoundary
            key={studyingDeck.id}
            label="Studying this deck hit a problem."
            onExit={() => setStudyingDeck(null)}
          >
            <StudyView
              deck={studyingDeck}
              onUpdateDeck={handleUpdateDeck}
              onExit={() => setStudyingDeck(null)}
            />
          </ErrorBoundary>
        ) : quizzingDeck ? (
          <ErrorBoundary
            key={quizzingDeck.id}
            label="The quiz hit a problem — this can happen if one of the generated questions came back malformed."
            onExit={() => setQuizzingDeck(null)}
          >
            <QuizView deck={quizzingDeck} onExit={() => setQuizzingDeck(null)} />
          </ErrorBoundary>
        ) : (
          <>
            <UploadPanel onDeckCreated={handleDeckCreated} />
            <div className="panel">
              <h2>Your decks</h2>
              <DeckList
                decks={decks}
                onStudy={setStudyingDeck}
                onQuiz={setQuizzingDeck}
                onDelete={handleDeleteDeck}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
