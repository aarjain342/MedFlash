import { useMemo, useState } from 'react';
import { isDue, reviewCard } from '../lib/leitner';
import { recordActivity } from '../lib/streak';
import { useKeys } from '../lib/useKeys';

function CardTable({ table }) {
  return (
    <table className="card-table">
      <thead>
        <tr>
          {table.headers.map((h, i) => (
            <th key={i}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function StudyView({ deck, onUpdateDeck, onExit }) {
  const queue = useMemo(() => deck.cards.filter(isDue), [deck]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [sessionDone, setSessionDone] = useState(queue.length === 0);

  const current = queue[index];
  // Only the first card generated from a given page keeps its source image (see
  // UploadPanel) to avoid storing the same image on every card from that page — so a card
  // without one looks it up from a sibling that shares its page.
  const currentImage = current?.image || deck.cards.find((c) => c.page === current?.page && c.image)?.image;

  function handleAnswer(remembered) {
    recordActivity();
    const updatedCard = reviewCard(current, remembered);
    const cards = deck.cards.map((c) => (c.id === current.id ? updatedCard : c));
    onUpdateDeck({ ...deck, cards });

    if (index + 1 < queue.length) {
      setIndex(index + 1);
      setFlipped(false);
    } else {
      setSessionDone(true);
    }
  }

  useKeys((e) => {
    if (e.key === 'Escape') {
      onExit();
    } else if (sessionDone) {
      if (e.key === 'Enter') onExit();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      setFlipped((f) => !f);
    } else if (flipped && (e.key === '1' || e.key === 'ArrowLeft')) {
      handleAnswer(false);
    } else if (flipped && (e.key === '2' || e.key === 'ArrowRight')) {
      handleAnswer(true);
    }
  });

  if (sessionDone) {
    return (
      <div className="panel study-panel study-done">
        <p className="eyebrow">{deck.name}</p>
        <h2>All caught up</h2>
        <p className="muted">No more cards are due in this deck right now.</p>
        <div>
          <button className="primary" onClick={onExit}>Back to decks</button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel study-panel">
      <div className="study-header">
        <button className="ghost study-exit-top" onClick={onExit}>
          <span aria-hidden="true">←</span> Exit
        </button>
        <h2>{deck.name}</h2>
        <span className="study-count">{index + 1} / {queue.length}</span>
      </div>
      <div className="study-progress" aria-hidden="true">
        <div style={{ width: `${(index / queue.length) * 100}%` }} />
      </div>

      <div className={`flashcard ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((f) => !f)}>
        <div className="flashcard-inner">
          <div className="flashcard-face front">
            {current.topic && <span className="topic-tag">{current.topic}</span>}
            <p>{current.question}</p>
            <span className="flip-hint">
              <span className="kbd-hint"><kbd>Space</kbd> to flip</span>
              <span className="touch-hint">Tap to flip</span>
            </span>
          </div>
          <div className="flashcard-face back">
            <span className="eyebrow card-label">Answer</span>
            <p className="card-answer">{current.answer}</p>
            {current.table && <CardTable table={current.table} />}
            {current.mnemonic && (
              <p className="card-mnemonic">
                <span className="eyebrow">Mnemonic</span>
                {current.mnemonic}
              </p>
            )}
          </div>
        </div>
      </div>

      {currentImage && (
        <details className="slide-image-toggle">
          <summary>View source slide{current.page ? ` (slide ${current.page})` : ''}</summary>
          <img className="slide-image" src={currentImage} alt={`Source slide ${current.page || ''}`} />
        </details>
      )}

      <div className="study-actions">
        {flipped ? (
          <div className="answer-actions">
            <button className="danger" onClick={() => handleAnswer(false)}>
              Missed it <kbd className="kbd-hint">1</kbd>
            </button>
            <button className="success" onClick={() => handleAnswer(true)}>
              Got it <kbd className="kbd-hint">2</kbd>
            </button>
          </div>
        ) : (
          <button className="ghost study-show" onClick={() => setFlipped(true)}>
            Show answer <kbd className="kbd-hint">Space</kbd>
          </button>
        )}
        <button className="link study-exit-bottom" onClick={onExit}>Exit study session</button>
      </div>
    </div>
  );
}
