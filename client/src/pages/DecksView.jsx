import UploadPanel from '../components/UploadPanel';
import DeckList from '../components/DeckList';

export default function DecksView({ decks, decksLoading, busyDeckId, onDeckCreated, onStudy, onQuiz, onDelete }) {
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Decks</h1>
          <p>Upload lecture slides or notes and MedFlash turns them into a deck of flashcards.</p>
        </div>
      </header>

      <UploadPanel onDeckCreated={onDeckCreated} />

      <section>
        <div className="section-head">
          <h2>Your decks</h2>
          {!decksLoading && <span className="muted small">{decks.length}</span>}
        </div>
        {decksLoading ? (
          <div className="decks-loading">
            <span className="spinner" aria-hidden="true" />
            <span>Loading your decks…</span>
          </div>
        ) : (
          <DeckList
            decks={decks}
            busyDeckId={busyDeckId}
            onStudy={onStudy}
            onQuiz={onQuiz}
            onDelete={onDelete}
          />
        )}
      </section>
    </>
  );
}
