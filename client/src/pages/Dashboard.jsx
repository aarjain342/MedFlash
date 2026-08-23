import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import StudyView from '../components/StudyView';
import QuizView from '../components/QuizView';
import ErrorBoundary from '../components/ErrorBoundary';
import HomeView from './HomeView';
import DecksView from './DecksView';
import FlashcardsView from './FlashcardsView';
import QuestionsView from './QuestionsView';
import SettingsView from './SettingsView';
import { loadDecks, upsertDeck, deleteDeck } from '../lib/db';
import { useAuth } from '../lib/AuthContext';
import { supabaseConfigured } from '../lib/supabaseClient';

export default function Dashboard() {
  const [decks, setDecks] = useState([]);
  const [decksLoading, setDecksLoading] = useState(true);
  const [busyDeckId, setBusyDeckId] = useState(null);
  const [activeView, setActiveView] = useState('home'); // home | decks | flashcards | questions | settings
  const [studyingDeck, setStudyingDeck] = useState(null);
  const [quizzingDeck, setQuizzingDeck] = useState(null);
  const { user, signOut } = useAuth();
  const guestMode = !supabaseConfigured;

  useEffect(() => {
    loadDecks()
      .then(setDecks)
      .finally(() => setDecksLoading(false));
  }, []);

  function handleNavigate(view) {
    // Nav clicks always return to a top-level view — leaving an active study/quiz session.
    setStudyingDeck(null);
    setQuizzingDeck(null);
    setActiveView(view);
  }

  async function handleDeckCreated(deck) {
    setDecks(await upsertDeck(deck));
  }

  async function handleUpdateDeck(deck) {
    setDecks(await upsertDeck(deck));
    setStudyingDeck(deck);
  }

  async function handleDeleteDeck(id) {
    setBusyDeckId(id);
    try {
      setDecks(await deleteDeck(id));
    } finally {
      setBusyDeckId(null);
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
          onStudy={(deck) => {
            setQuizzingDeck(null);
            setStudyingDeck(deck);
          }}
        />
      </ErrorBoundary>
    );
  } else if (activeView === 'flashcards') {
    content = <FlashcardsView decks={decks} onStudy={setStudyingDeck} />;
  } else if (activeView === 'questions') {
    content = <QuestionsView decks={decks} onQuiz={setQuizzingDeck} />;
  } else if (activeView === 'settings') {
    content = <SettingsView user={user} guestMode={guestMode} onSignOut={signOut} />;
  } else if (activeView === 'decks') {
    content = (
      <DecksView
        decks={decks}
        decksLoading={decksLoading}
        busyDeckId={busyDeckId}
        onDeckCreated={handleDeckCreated}
        onStudy={setStudyingDeck}
        onQuiz={setQuizzingDeck}
        onDelete={handleDeleteDeck}
      />
    );
  } else {
    content = <HomeView userLabel={guestMode ? null : user?.email?.split('@')[0]} onNavigate={handleNavigate} />;
  }

  return (
    <AppShell
      activeView={activeView}
      onNavigate={handleNavigate}
      user={user}
      guestMode={guestMode}
      onSignOut={signOut}
    >
      {content}
    </AppShell>
  );
}
