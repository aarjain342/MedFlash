import { useRef, useState } from 'react';
import { generateAnatomyStream } from '../lib/anatomyApi';
import { waitForServer } from '../lib/api';

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export default function AnatomyUploadPanel({ onDeckCreated }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | waking | working | error
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0, labelCount: 0 });
  const inputRef = useRef(null);
  const inFlightRef = useRef(false);

  async function handleGenerate() {
    if (!file || inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus('waking');
    setError('');
    setWarning('');
    setProgress({ done: 0, total: 0, labelCount: 0 });

    const pagesByNumber = new Map();
    let totalPages = 0;
    const failedPages = [];

    try {
      await waitForServer(() => setStatus('waking'));
      setStatus('working');

      await generateAnatomyStream(file, ({ type, data }) => {
        if (type === 'start') {
          totalPages = data.totalPages;
          setProgress({ done: 0, total: data.totalPages, labelCount: 0 });
        } else if (type === 'page') {
          // Each label gets its id assigned here, client-side — the server only ever
          // returns { label, box }, same division of responsibility as UploadPanel
          // assigning card ids rather than the server's sanitizeCards doing it.
          const labels = data.labels.map((l) => ({ id: makeId(), label: l.label, box: l.box }));
          pagesByNumber.set(data.page, { page: data.page, image: data.image, labels, diagrams: data.diagrams || [] });
          setProgress((p) => ({
            done: p.done + 1,
            total: totalPages,
            labelCount: p.labelCount + labels.length,
          }));
        } else if (type === 'page-skipped') {
          // No labeled diagram on this page (plain lecture text) — nothing to add, just
          // count it toward progress so the bar doesn't stall on skipped pages.
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        } else if (type === 'page-error') {
          failedPages.push(data.page);
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        } else if (type === 'fatal-error') {
          throw new Error(data.error);
        }
      });

      const pages = [...pagesByNumber.keys()]
        .sort((a, b) => a - b)
        .map((page) => pagesByNumber.get(page));

      if (pages.length === 0) {
        throw new Error('No labeled anatomy diagrams were found in this PDF.');
      }

      const deck = {
        id: makeId(),
        name: file.name.replace(/\.pdf$/i, ''),
        sourceFile: file.name,
        createdAt: Date.now(),
        pages,
      };
      await onDeckCreated(deck);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      setStatus('idle');
      if (failedPages.length > 0) {
        setWarning(
          `Quiz created, but ${failedPages.length} page${failedPages.length > 1 ? 's' : ''} (${failedPages.join(', ')}) failed to process — likely a rate limit. You can re-upload the file to retry.`
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
      <h2>Create an anatomy quiz from a labeled diagram PDF</h2>
      <p className="muted">
        Upload a lecture PDF with labeled anatomy photos or diagrams. MedFlash scans every
        page, finds the ones with labeled structures, and builds a quiz that hides one label
        at a time so you can test yourself on the whole document.
      </p>

      <label className="file-drop">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        {file ? file.name : 'Choose a PDF…'}
      </label>

      <button
        className="primary"
        disabled={!file || status === 'working' || status === 'waking'}
        onClick={handleGenerate}
      >
        {status === 'working'
          ? 'Finding labeled diagrams…'
          : status === 'waking'
            ? 'Waking up server…'
            : 'Create anatomy quiz'}
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
            Page {progress.done} / {progress.total} · {progress.labelCount} structures found so far
          </p>
        </div>
      )}

      {status === 'error' && <p className="error">{error}</p>}
      {warning && <p className="warning">{warning}</p>}
    </div>
  );
}
