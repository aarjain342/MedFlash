import { useState } from 'react';
import { isDue } from '../lib/leitner';
import { deckHue } from '../lib/deckColor';
import { exportDeckToAnki } from '../lib/ankiExport';

export default function DeckList({ decks, busyDeckId, onStudy, onQuiz, onDelete }) {
  const [exportingId, setExportingId] = useState(null);
  const [exportError, setExportError] = useState('');

  async function handleExport(deck) {
    setExportingId(deck.id);
    setExportError('');
    try {
      await exportDeckToAnki(deck);
    } catch (err) {
      setExportError(`Export failed: ${err.message}`);
    } finally {
      setExportingId(null);
    }
  }

  if (!decks.length) {
    return <p className="muted">No decks yet. Drop a PDF above to make your first one.</p>;
  }

  return (
    <>
      {exportError && <p className="error">{exportError}</p>}
      <ul className="ledger">
        {decks.map((deck) => {
          const detailLoading = !deck.cards;
          const dueCount = detailLoading ? 0 : deck.cards.filter(isDue).length;
          const isBusy = busyDeckId === deck.id;
          return (
            <li className={`ledger-row ${isBusy ? 'is-busy' : ''}`} data-hue={deckHue(deck.id)} key={deck.id}>
              <span className="deck-chip" aria-hidden="true" />
              <div className="ledger-main">
                <h3>{deck.name}</h3>
                <p className="muted small">
                  {detailLoading ? 'Loading…' : `${deck.cards.length} cards`}
                  {dueCount > 0 && <mark className="due-tag">{dueCount} due</mark>}
                </p>
              </div>
              <div className="ledger-actions">
                <button className="primary small" disabled={isBusy || detailLoading} onClick={() => onStudy(deck)}>
                  Study
                </button>
                <button className="ghost small" disabled={isBusy || detailLoading} onClick={() => onQuiz(deck)}>
                  USMLE quiz
                </button>
                <button
                  className="link small"
                  disabled={isBusy || detailLoading || exportingId === deck.id}
                  onClick={() => handleExport(deck)}
                >
                  {exportingId === deck.id ? 'Exporting…' : 'Export to Anki'}
                </button>
                <button className="link small delete-link" disabled={isBusy} onClick={() => onDelete(deck.id)}>
                  {isBusy ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
