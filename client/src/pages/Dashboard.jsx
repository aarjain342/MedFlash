import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import StudyView from '../components/StudyView';
import QuizView from '../components/QuizView';
import AnatomyStudyView from '../components/AnatomyStudyView';
import ErrorBoundary from '../components/ErrorBoundary';
import HomeView from './HomeView';
import DecksView from './DecksView';
import FlashcardsView from './FlashcardsView';
import QuestionsView from './QuestionsView';
import AnatomyView from './AnatomyView';
import SettingsView from './SettingsView';
import {
  loadDecks,
  loadDecksMeta,
  upsertDeck,
  deleteDeck,
  loadAnatomyDecks,
  loadAnatomyDecksMeta,
  upsertAnatomyDeck,
  deleteAnatomyDeck,
} from '../lib/db';
import { useAuth } from '../lib/AuthContext';
import { supabaseConfigured } from '../lib/supabaseClient';

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const [decks, setDecks] = useState([]);
  const [decksLoading, setDecksLoading] = useState(true);
  const [decksError, setDecksError] = useState(null);
  const [busyDeckId, setBusyDeckId] = useState(null);
  // Defaults to 'settings' when redirected back from Stripe Checkout/the billing portal
  // (?view=settings) so the checkout success/cancelled banner is actually visible.
  const [activeView, setActiveView] = useState(
    searchParams.get('view') === 'settings' ? 'settings' : 'home'
  ); // home | decks | flashcards | questions | anatomy | settings
  const [studyingDeck, setStudyingDeck] = useState(null);
  const [quizzingDeck, setQuizzingDeck] = useState(null);
  // Anatomy Quiz decks are a separate content type from flashcard decks (image-occlusion
  // quizzes, not spaced-repetition cards) — kept as their own state slice throughout,
  // never merged with `decks`.
  const [anatomyDecks, setAnatomyDecks] = useState([]);
  const [anatomyDecksLoading, setAnatomyDecksLoading] = useState(true);
  const [anatomyDecksError, setAnatomyDecksError] = useState(null);
  const [busyAnatomyDeckId, setBusyAnatomyDeckId] = useState(null);
  const [studyingAnatomyDeck, setStudyingAnatomyDeck] = useState(null);
  const { user, signOut } = useAuth();
  const guestMode = !supabaseConfigured;

  // Two-stage load: the lightweight metadata query paints the deck list almost instantly
  // (no card/image data), then the full fetch fills in `cards` per deck in the background.
  // Deck list items read `cards === null` as "still loading" rather than "empty" — see
  // FlashcardsView/QuestionsView/DeckList. A failed fetch here used to render exactly like
  // "you have no decks" (this account's deck data is large enough that the full fetch can
  // genuinely time out), so both stages surface real errors instead of silently clearing
  // the list.
  function fetchDecks() {
    setDecksLoading(true);
    setDecksError(null);
    loadDecksMeta()
      .then((meta) => {
        setDecks(meta);
        setDecksLoading(false);
        return loadDecks();
      })
      .then(setDecks)
      .catch((err) => setDecksError(err.message || 'Failed to load your decks'))
      .finally(() => setDecksLoading(false));
  }

  // Same two-stage load, same reasoning, for anatomy decks' `pages` (which embed page
  // images the same way decks.cards does).
  function fetchAnatomyDecks() {
    setAnatomyDecksLoading(true);
    setAnatomyDecksError(null);
    loadAnatomyDecksMeta()
      .then((meta) => {
        setAnatomyDecks(meta);
        setAnatomyDecksLoading(false);
        return loadAnatomyDecks();
      })
      .then(setAnatomyDecks)
      .catch((err) => setAnatomyDecksError(err.message || 'Failed to load your anatomy quizzes'))
      .finally(() => setAnatomyDecksLoading(false));
  }

  useEffect(() => {
    fetchDecks();
    fetchAnatomyDecks();
  }, []);

  function handleNavigate(view) {
    // Nav clicks always return to a top-level view — leaving an active study/quiz session.
    setStudyingDeck(null);
    setQuizzingDeck(null);
    setStudyingAnatomyDeck(null);
    setActiveView(view);
  }

  // Study/Quiz are opened from several places (Decks grid, Flashcards/Questions pickers,
  // QuizView's own "Study flashcards" link) — always routing through here keeps the
  // sidebar's active section in sync with whichever one is actually on screen.
  function handleStudy(deck) {
    setActiveView('flashcards');
    setQuizzingDeck(null);
    setStudyingDeck(deck);
  }

  function handleQuiz(deck) {
    setActiveView('questions');
    setStudyingDeck(null);
    setQuizzingDeck(deck);
  }

  async function handleDeckCreated(deck) {
    const saved = await upsertDeck(deck);
    setDecks((prev) => [saved, ...prev.filter((d) => d.id !== saved.id)]);
  }

  async function handleUpdateDeck(deck) {
    const saved = await upsertDeck(deck);
    setDecks((prev) => prev.map((d) => (d.id === saved.id ? saved : d)));
    setStudyingDeck(saved);
  }

  async function handleDeleteDeck(id) {
    setBusyDeckId(id);
    try {
      await deleteDeck(id);
      setDecks((prev) => prev.filter((d) => d.id !== id));
    } finally {
      setBusyDeckId(null);
    }
  }

  function handleStudyAnatomy(deck) {
    setActiveView('anatomy');
    setStudyingAnatomyDeck(deck);
  }

  async function handleAnatomyDeckCreated(deck) {
    const saved = await upsertAnatomyDeck(deck);
    setAnatomyDecks((prev) => [saved, ...prev.filter((d) => d.id !== saved.id)]);
  }

  async function handleDeleteAnatomyDeck(id) {
    setBusyAnatomyDeckId(id);
    try {
      await deleteAnatomyDeck(id);
      setAnatomyDecks((prev) => prev.filter((d) => d.id !== id));
    } finally {
      setBusyAnatomyDeckId(null);
    }
  }

  let content;
  if (studyingDeck) {
    content = (
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
    );
  } else if (quizzingDeck) {
    content = (
      <ErrorBoundary
        key={quizzingDeck.id}
        label="The quiz hit a problem — this can happen if one of the generated questions came back malformed."
        onExit={() => setQuizzingDeck(null)}
      >
        <QuizView
          deck={quizzingDeck}
          onExit={() => setQuizzingDeck(null)}
          onStudy={handleStudy}
        />
      </ErrorBoundary>
    );
  } else if (studyingAnatomyDeck) {
    content = (
      <ErrorBoundary
        key={studyingAnatomyDeck.id}
        label="The anatomy quiz hit a problem."
        onExit={() => setStudyingAnatomyDeck(null)}
      >
        <AnatomyStudyView deck={studyingAnatomyDeck} onExit={() => setStudyingAnatomyDeck(null)} />
      </ErrorBoundary>
    );
  } else if (activeView === 'flashcards') {
    content = (
      <FlashcardsView
        decks={decks}
        decksLoading={decksLoading}
        onStudy={handleStudy}
        onQuiz={handleQuiz}
        onDelete={handleDeleteDeck}
        busyDeckId={busyDeckId}
      />
    );
  } else if (activeView === 'questions') {
    content = <QuestionsView decks={decks} decksLoading={decksLoading} onQuiz={handleQuiz} />;
  } else if (activeView === 'settings') {
    content = <SettingsView user={user} guestMode={guestMode} onSignOut={signOut} />;
  } else if (activeView === 'decks') {
    content = (
      <DecksView
        decks={decks}
        decksLoading={decksLoading}
        busyDeckId={busyDeckId}
        onDeckCreated={handleDeckCreated}
        onStudy={handleStudy}
        onQuiz={handleQuiz}
        onDelete={handleDeleteDeck}
      />
    );
  } else if (activeView === 'anatomy') {
    content = (
      <AnatomyView
        decks={anatomyDecks}
        decksLoading={anatomyDecksLoading}
        busyDeckId={busyAnatomyDeckId}
        onDeckCreated={handleAnatomyDeckCreated}
        onStudy={handleStudyAnatomy}
        onDelete={handleDeleteAnatomyDeck}
      />
    );
  } else {
    content = (
      <HomeView
        userLabel={guestMode ? null : user?.email?.split('@')[0]}
        decks={decks}
        onNavigate={handleNavigate}
        onStudy={handleStudy}
        guestMode={guestMode}
      />
    );
  }

  return (
    <AppShell
      activeView={activeView}
      onNavigate={handleNavigate}
      user={user}
      guestMode={guestMode}
      onSignOut={signOut}
    >
      {decksError && (
        <div className="deck-load-error">
          <span>Couldn't load your decks: {decksError}</span>
          <button className="ghost" onClick={fetchDecks}>Retry</button>
        </div>
      )}
      {anatomyDecksError && (
        <div className="deck-load-error">
          <span>Couldn't load your anatomy quizzes: {anatomyDecksError}</span>
          <button className="ghost" onClick={fetchAnatomyDecks}>Retry</button>
        </div>
      )}
      {content}
    </AppShell>
  );
}
