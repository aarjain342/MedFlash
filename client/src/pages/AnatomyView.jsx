import AnatomyUploadPanel from '../components/AnatomyUploadPanel';

export default function AnatomyView({ decks, decksLoading, busyDeckId, onDeckCreated, onStudy, onDelete }) {
  return (
    <>
      <AnatomyUploadPanel onDeckCreated={onDeckCreated} />

      <div className="panel">
        <h2>Your anatomy quizzes</h2>
        {decksLoading ? (
          <div className="decks-loading">
            <span className="spinner" aria-hidden="true" />
            <span className="muted">Loading your anatomy quizzes…</span>
          </div>
        ) : !decks.length ? (
          <p className="muted">No anatomy quizzes yet. Upload a labeled diagram PDF to create your first one.</p>
        ) : (
          <div className="deck-list">
            {decks.map((deck) => {
              const detailLoading = !deck.pages;
              const labelCount = detailLoading ? 0 : deck.pages.reduce((sum, p) => sum + p.labels.length, 0);
              const isBusy = busyDeckId === deck.id;
              return (
                <div className={`deck-card ${isBusy ? 'is-busy' : ''}`} key={deck.id}>
                  <div className="deck-card-main">
                    <h3>{deck.name}</h3>
                    <p className="muted">
                      {detailLoading ? 'Loading…' : `${deck.pages.length} pages · ${labelCount} structures`}
                    </p>
                  </div>
                  <div className="deck-card-actions">
                    <button className="primary" disabled={isBusy || detailLoading} onClick={() => onStudy(deck)}>
                      Study
                    </button>
                    <button className="ghost" disabled={isBusy} onClick={() => onDelete(deck.id)}>
                      {isBusy ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
