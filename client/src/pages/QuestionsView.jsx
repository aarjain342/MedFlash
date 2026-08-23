export default function QuestionsView({ decks, onQuiz }) {
  return (
    <div className="panel">
      <h2>Questions</h2>
      <p className="muted">Pick a deck to take — or resume — its USMLE-style quiz.</p>
      {decks.length === 0 ? (
        <p className="muted">No decks yet — generate one from the Decks page first.</p>
      ) : (
        <div className="deck-picker">
          {decks.map((d) => (
            <button key={d.id} className="deck-picker-item" onClick={() => onQuiz(d)}>
              {d.name}
              <span className="muted small">{d.cards.length} cards</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
