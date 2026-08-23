import { useState } from 'react';

export default function FlashcardsView({ decks, onStudy }) {
  const [selectedId, setSelectedId] = useState(decks[0]?.id ?? null);
  const selected = decks.find((d) => d.id === selectedId);

  return (
    <div className="panel">
      <h2>Flashcards</h2>
      {decks.length === 0 ? (
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

          {selected && (
            <div className="flashcard-browser">
              <div className="flashcard-browser-header">
                <h3>{selected.name}</h3>
                <button className="primary" onClick={() => onStudy(selected)}>Study this deck</button>
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
