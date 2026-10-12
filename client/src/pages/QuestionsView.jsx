import { deckHue } from '../lib/deckColor';

export default function QuestionsView({ decks, decksLoading, onQuiz }) {
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Questions</h1>
          <p>Board-style questions built from a deck. Pick one to start, or to pick up where you left off.</p>
        </div>
      </header>

      {decksLoading ? (
        <div className="decks-loading">
          <span className="spinner" aria-hidden="true" />
          <span>Loading…</span>
        </div>
      ) : decks.length === 0 ? (
        <p className="muted">No decks yet. Create one on the Decks page first.</p>
      ) : (
        <ul className="ledger">
          {decks.map((d) => (
            <li className="ledger-row" data-hue={deckHue(d.id)} key={d.id}>
              <span className="deck-chip" aria-hidden="true" />
              <div className="ledger-main">
                <h3>{d.name}</h3>
                <p className="muted small">{d.cards ? `${d.cards.length} cards` : 'Loading…'}</p>
              </div>
              <div className="ledger-actions">
                <button className="primary small" disabled={!d.cards} onClick={() => onQuiz(d)}>
                  Open quiz
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
