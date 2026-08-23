import { useRef, useState } from 'react';
import { generateFlashcardsStream, waitForServer } from '../lib/api';
import { initCardProgress } from '../lib/leitner';

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export default function UploadPanel({ onDeckCreated }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | waking | working | error
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0, cardCount: 0 });
  const inputRef = useRef(null);
  const inFlightRef = useRef(false);

  async function handleGenerate() {
    // Guards against rapid double/triple-clicks firing overlapping requests — React's
    // `disabled` prop update isn't synchronous, so a fast enough click sequence could
    // otherwise slip through before the button actually disables.
    if (!file || inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus('waking');
    setError('');
    setWarning('');
    setProgress({ done: 0, total: 0, cardCount: 0 });

    const cardsByPage = new Map();
    let totalPages = 0;
    const failedSlides = [];

    try {
      await waitForServer(() => setStatus('waking'));
      setStatus('working');

      await generateFlashcardsStream(file, ({ type, data }) => {
        if (type === 'start') {
          totalPages = data.totalPages;
          setProgress({ done: 0, total: data.totalPages, cardCount: 0 });
        } else if (type === 'slide') {
          cardsByPage.set(data.page, { cards: data.cards, image: data.image });
          setProgress((p) => ({
            done: p.done + 1,
            total: totalPages,
            cardCount: p.cardCount + data.cards.length,
          }));
        } else if (type === 'slide-error') {
          failedSlides.push(data.page);
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        } else if (type === 'fatal-error') {
          throw new Error(data.error);
        }
      });

      const cards = [];
      const sortedPages = [...cardsByPage.keys()].sort((a, b) => a - b);
      for (const page of sortedPages) {
        const { cards: pageCards, image } = cardsByPage.get(page);
        // A slide often yields 2-3 cards, but they all show the SAME source image. Storing
        // that (often 100KB+) base64 image on every one of those cards was tripling/
        // quadrupling deck size for no reason — one real deck hit ~30MB this way, which is
        // almost certainly why Supabase saves for image-heavy decks kept hitting the
        // statement timeout. Only the first card for a page keeps the image; StudyView
        // looks it up from a sibling card sharing the same page when it's missing.
        pageCards.forEach((c, i) => {
          cards.push({
            id: makeId(),
            question: c.question,
            answer: c.answer,
            table: c.table || null,
            mnemonic: c.mnemonic || '',
            topic: c.topic || '',
            page,
            image: i === 0 ? image : null,
            ...initCardProgress(),
          });
        });
      }

      if (cards.length === 0) {
        throw new Error('No flashcards could be generated from this file.');
      }

      const deck = {
        id: makeId(),
        name: file.name.replace(/\.(pdf|pptx|docx)$/i, ''),
        sourceFile: file.name,
        createdAt: Date.now(),
        cards,
      };
      await onDeckCreated(deck);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      setStatus('idle');
      if (failedSlides.length > 0) {
        setWarning(
          `Deck created, but ${failedSlides.length} section${failedSlides.length > 1 ? 's' : ''} (${failedSlides.join(', ')}) failed to generate — likely a rate limit. You can re-upload the file to retry; already-generated cards won't be duplicated into a new deck.`
        );
      }
    } catch (err) {
      setError(err.message);
      setStatus('error');
    } finally {
      inFlightRef.current = false;
    }
  }

  return (
    <div className="panel upload-panel">
      <h2>Create a deck from your notes</h2>
      <p className="muted">
        Upload a PDF, PowerPoint, or Word document. MedFlash goes section by section — reading
        both the text and (for PDFs) the slide image — and makes clear, consolidated flashcards
        (with tables and memory tricks where they help) plus the source slide image attached
        where available.
      </p>

      <label className="file-drop">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.pptx,.docx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        {file ? file.name : 'Choose a PDF, PPTX, or DOCX…'}
      </label>

      <button
        className="primary"
        disabled={!file || status === 'working' || status === 'waking'}
        onClick={handleGenerate}
      >
        {status === 'working'
          ? 'Generating flashcards…'
          : status === 'waking'
            ? 'Waking up server…'
            : 'Generate flashcards'}
      </button>

      {status === 'waking' && (
        <p className="muted small">
          The server's been idle and is spinning back up — this can take up to a minute on a free
          host. Hang tight.
        </p>
      )}

      {status === 'working' && progress.total > 0 && (
        <div className="progress">
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
          <p className="muted small">
            Slide {progress.done} / {progress.total} · {progress.cardCount} cards so far
          </p>
        </div>
      )}

      {status === 'error' && <p className="error">{error}</p>}
      {warning && <p className="warning">{warning}</p>}
    </div>
  );
}
