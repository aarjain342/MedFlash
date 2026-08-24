import { useState } from 'react';
import { isDue } from '../lib/leitner';
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
    return <p className="muted">No decks yet. Upload a PDF to create your first one.</p>;
  }

  return (
    <div className="deck-list">
      {exportError && <p className="error">{exportError}</p>}
      {decks.map((deck) => {
        const detailLoading = !deck.cards;
        const dueCount = detailLoading ? 0 : deck.cards.filter(isDue).length;
        const isBusy = busyDeckId === deck.id;
        return (
          <div className={`deck-card ${isBusy ? 'is-busy' : ''}`} key={deck.id}>
            <div className="deck-card-main">
              <h3>{deck.name}</h3>
              <p className="muted">
                {detailLoading ? 'Loading…' : `${deck.cards.length} cards · ${dueCount} due`}
              </p>
            </div>
            <div className="deck-card-actions">
              <button className="primary" disabled={isBusy || detailLoading} onClick={() => onStudy(deck)}>Study</button>
              <button className="ghost" disabled={isBusy || detailLoading} onClick={() => onQuiz(deck)}>USMLE Quiz</button>
              <button
                className="ghost"
                disabled={isBusy || detailLoading || exportingId === deck.id}
                onClick={() => handleExport(deck)}
              >
                {exportingId === deck.id ? 'Exporting…' : 'Export to Anki'}
              </button>
              <button className="ghost" disabled={isBusy} onClick={() => onDelete(deck.id)}>
                {isBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
