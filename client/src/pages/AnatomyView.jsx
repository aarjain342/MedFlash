import AnatomyUploadPanel from '../components/AnatomyUploadPanel';
import { deckHue } from '../lib/deckColor';

export default function AnatomyView({ decks, decksLoading, busyDeckId, onDeckCreated, onStudy, onDelete }) {
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Anatomy quiz</h1>
          <p>
            Upload a lecture PDF with labeled diagrams. MedFlash finds every label, hides them one at
            a time, and you type each name from memory.
          </p>
        </div>
      </header>

      <AnatomyUploadPanel onDeckCreated={onDeckCreated} />

      <section>
        <div className="section-head">
          <h2>Your anatomy quizzes</h2>
          {!decksLoading && <span className="muted small">{decks.length}</span>}
        </div>
        {decksLoading ? (
          <div className="decks-loading">
            <span className="spinner" aria-hidden="true" />
            <span>Loading…</span>
          </div>
        ) : decks.length === 0 ? (
          <p className="muted">Nothing here yet. Drop a labeled-diagram PDF above to make your first quiz.</p>
        ) : (
          <ul className="ledger">
            {decks.map((deck) => {
              const detailLoading = !deck.pages;
              const labelCount = detailLoading ? 0 : deck.pages.reduce((sum, p) => sum + p.labels.length, 0);
              const isBusy = busyDeckId === deck.id;
              return (
                <li className={`ledger-row ${isBusy ? 'is-busy' : ''}`} data-hue={deckHue(deck.id)} key={deck.id}>
                  <span className="deck-chip" aria-hidden="true" />
                  <div className="ledger-main">
                    <h3>{deck.name}</h3>
                    <p className="muted small">
                      {detailLoading ? 'Loading…' : `${deck.pages.length} pages · ${labelCount} labels`}
                    </p>
                  </div>
                  <div className="ledger-actions">
                    <button className="primary small" disabled={isBusy || detailLoading} onClick={() => onStudy(deck)}>
                      Study
                    </button>
                    <button className="link small delete-link" disabled={isBusy} onClick={() => onDelete(deck.id)}>
                      {isBusy ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
