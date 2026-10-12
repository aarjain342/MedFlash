import { DIFFICULTIES, hasSet, setProgress } from '../lib/quizSets';

const LABEL = { hard: 'Hard', easy: 'Easy' };
const BLURB = { hard: 'Clinical vignettes', easy: 'Vocab and basics' };

// One deck, two question sets. Each difficulty keeps its own progress, and one that hasn't been
// generated yet says so (clicking it asks before spending an AI generation).
export default function DifficultySwitch({ store, busy, onSwitch, onRegenerate }) {
  return (
    <div className="difficulty-block">
      <div className="difficulty-switch" role="group" aria-label="Question difficulty">
        {DIFFICULTIES.map((d) => {
          const exists = hasSet(store, d);
          const progress = exists ? setProgress(store.sets[d]) : null;
          return (
            <button
              key={d}
              className={`difficulty-option ${store.active === d ? 'active' : ''}`}
              aria-pressed={store.active === d}
              disabled={busy}
              onClick={() => onSwitch(d)}
              title={busy ? 'Wait for the current set to finish generating' : BLURB[d]}
            >
              <span className="difficulty-option-name">{LABEL[d]}</span>
              <span className="difficulty-option-meta">{exists ? `${progress.done} / ${progress.total}` : 'Generate'}</span>
            </button>
          );
        })}
      </div>
      <button className="link small" disabled={busy} onClick={onRegenerate}>
        Regenerate this set
      </button>
    </div>
  );
}
