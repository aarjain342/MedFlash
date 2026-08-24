import { useState } from 'react';
import { exportDeckToAnki } from '../lib/ankiExport';

export default function FlashcardsView({ decks, decksLoading, onStudy, onQuiz, onDelete, busyDeckId }) {
  const [selectedId, setSelectedId] = useState(decks[0]?.id ?? null);
  const [exportingId, setExportingId] = useState(null);
  const [exportError, setExportError] = useState('');
  const selected = decks.find((d) => d.id === selectedId);

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

  return (
    <div className="panel">
      <h2>Flashcards</h2>
      {decksLoading ? (
        <div className="decks-loading">
          <span className="spinner" aria-hidden="true" />
          <span className="muted">Loading…</span>
        </div>
      ) : decks.length === 0 ? (
        <p className="muted">No decks yet — generate one from the Decks page first.</p>
      ) : (
        <>
          <div className="deck-picker">
            {decks.map((d) => (
              <button
                key={d.id}
                className={`deck-picker-item ${selectedId === d.id ? 'active' : ''}`}
                onClick={() => setSelectedId(d.id)}
              >
                {d.name}
                <span className="muted small">{d.cards.length} cards</span>
              </button>
            ))}
          </div>

          {exportError && <p className="error">{exportError}</p>}

          {selected && (
            <div className="flashcard-browser">
              <div className="flashcard-browser-header">
                <h3>{selected.name}</h3>
                <div className="flashcard-browser-actions">
                  <button
                    className="primary"
                    disabled={busyDeckId === selected.id}
                    onClick={() => onStudy(selected)}
                  >
                    Study this deck
                  </button>
                  <button
                    className="ghost"
                    disabled={busyDeckId === selected.id}
                    onClick={() => onQuiz?.(selected)}
                  >
                    USMLE Quiz
                  </button>
                  <button
                    className="ghost"
                    disabled={busyDeckId === selected.id || exportingId === selected.id}
                    onClick={() => handleExport(selected)}
                  >
                    {exportingId === selected.id ? 'Exporting…' : 'Export to Anki'}
                  </button>
                  <button
                    className="ghost"
                    disabled={busyDeckId === selected.id}
                    onClick={() => onDelete?.(selected.id)}
                  >
                    {busyDeckId === selected.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
              <div className="flashcard-table">
                {selected.cards.map((c) => (
                  <div key={c.id} className="flashcard-row">
                    {c.topic && <span className="flashcard-row-topic">{c.topic}</span>}
                    <p className="flashcard-row-q">{c.question}</p>
                    <p className="flashcard-row-a muted">{c.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
