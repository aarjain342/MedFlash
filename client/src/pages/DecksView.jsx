import UploadPanel from '../components/UploadPanel';
import DeckList from '../components/DeckList';

export default function DecksView({ decks, decksLoading, busyDeckId, onDeckCreated, onStudy, onQuiz, onDelete }) {
  return (
    <>
      <UploadPanel onDeckCreated={onDeckCreated} />

      <div className="panel">
        <h2>Your decks</h2>
        {decksLoading ? (
          <div className="decks-loading">
            <span className="spinner" aria-hidden="true" />
            <span className="muted">Loading your decks…</span>
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
      </div>

      {/* Reserved for upcoming deck-management tools (folders, tags, sharing, etc.) */}
      <div className="panel deck-more-placeholder">
        <h3>More coming here</h3>
        <p className="muted small">This space is reserved for upcoming deck management tools.</p>
      </div>
    </>
  );
}
