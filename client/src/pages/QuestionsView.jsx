export default function QuestionsView({ decks, decksLoading, onQuiz }) {
  return (
    <div className="panel">
      <h2>Questions</h2>
      <p className="muted">Pick a deck to take — or resume — its USMLE-style quiz.</p>
      {decksLoading ? (
        <div className="decks-loading">
          <span className="spinner" aria-hidden="true" />
          <span className="muted">Loading…</span>
        </div>
      ) : decks.length === 0 ? (
        <p className="muted">No decks yet — generate one from the Decks page first.</p>
      ) : (
        <div className="deck-picker">
          {decks.map((d) => (
            <button key={d.id} className="deck-picker-item" disabled={!d.cards} onClick={() => onQuiz(d)}>
              {d.name}
              <span className="muted small">{d.cards ? `${d.cards.length} cards` : 'Loading…'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
