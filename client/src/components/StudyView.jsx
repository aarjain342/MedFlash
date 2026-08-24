import { useMemo, useState } from 'react';
import { isDue, reviewCard } from '../lib/leitner';
import { recordActivity } from '../lib/streak';

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

  if (sessionDone) {
    return (
      <div className="panel study-panel">
        <h2>{deck.name}</h2>
        <p>All caught up! No more cards due right now.</p>
        <button className="primary" onClick={onExit}>Back to decks</button>
      </div>
    );
  }

  return (
    <div className="panel study-panel">
      <div className="study-header">
        <h2>{deck.name}</h2>
        <span className="muted">{index + 1} / {queue.length}</span>
      </div>

      <div className={`flashcard ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((f) => !f)}>
        <div className="flashcard-inner">
          <div className="flashcard-face front">
            {current.topic && <span className="topic-tag">{current.topic}</span>}
            <p>{current.question}</p>
            <span className="muted small">Click to flip</span>
          </div>
          <div className="flashcard-face back">
            <p className="card-answer">{current.answer}</p>
            {current.table && <CardTable table={current.table} />}
            {current.mnemonic && (
              <p className="card-mnemonic">💡 {current.mnemonic}</p>
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

      {flipped ? (
        <div className="answer-actions">
          <button className="danger" onClick={() => handleAnswer(false)}>Didn't know it</button>
          <button className="success" onClick={() => handleAnswer(true)}>Knew it</button>
        </div>
      ) : (
        <button className="ghost" onClick={() => setFlipped(true)}>Show answer</button>
      )}

      <button className="link" onClick={onExit}>Exit study session</button>
    </div>
  );
}
