import { useState } from 'react';
import { isDue } from '../lib/leitner';
import { exportDeckToAnki } from '../lib/ankiExport';

export default function DeckList({ decks, onStudy, onDelete }) {
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
        const dueCount = deck.cards.filter(isDue).length;
        return (
          <div className="deck-card" key={deck.id}>
            <div className="deck-card-main">
              <h3>{deck.name}</h3>
              <p className="muted">
                {deck.cards.length} cards · {dueCount} due
              </p>
            </div>
            <div className="deck-card-actions">
              <button className="primary" onClick={() => onStudy(deck)}>Study</button>
              <button
                className="ghost"
                disabled={exportingId === deck.id}
                onClick={() => handleExport(deck)}
              >
                {exportingId === deck.id ? 'Exporting…' : 'Export to Anki'}
              </button>
              <button className="ghost" onClick={() => onDelete(deck.id)}>Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
