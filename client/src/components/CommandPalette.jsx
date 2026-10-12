import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filterCommands, moveIndex } from '../lib/commands';

// Ctrl/Cmd+K. Portalled to <body> so no ancestor's transform/stacking can trap it.
export default function CommandPalette({ open, onClose, commands }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, results]);

  if (!open) return null;

  function run(command) {
    if (!command) return;
    onClose();
    command.run();
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => moveIndex(i, 1, results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => moveIndex(i, -1, results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[index]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  const showHeadings = !query.trim();

  return createPortal(
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Jump to a page, deck or setting…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search commands"
        />
        <ul className="palette-list" role="listbox" ref={listRef}>
          {results.length === 0 && <li className="palette-empty">Nothing matches “{query}”.</li>}
          {results.map((command, i) => (
            <li key={command.id} role="presentation">
              {showHeadings && (i === 0 || results[i - 1].group !== command.group) && (
                <div className="palette-heading eyebrow">{command.group}</div>
              )}
              <button
                role="option"
                aria-selected={i === index}
                className="palette-item"
                onMouseMove={() => i !== index && setIndex(i)}
                onClick={() => run(command)}
              >
                <span className="palette-item-label">{command.label}</span>
                {!showHeadings && <span className="palette-item-group">{command.group}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="palette-foot kbd-hint">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
