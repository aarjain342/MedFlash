import { useRef, useState } from 'react';
import { generateAnatomyStream } from '../lib/anatomyApi';
import { waitForServer } from '../lib/api';
import Dropzone from './Dropzone';

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export default function AnatomyUploadPanel({ onDeckCreated }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | waking | working | error
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0, labelCount: 0 });
  const [dropKey, setDropKey] = useState(0); // remounts the picker so the same file can be chosen again
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
      setDropKey((k) => k + 1);
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
    <section className="panel upload-panel">
      <Dropzone
        key={dropKey}
        file={file}
        onFile={(f) => {
          setFile(f);
          setWarning('');
        }}
        onReject={() => setWarning('Anatomy quizzes need a PDF.')}
        accept=".pdf,application/pdf"
        extensions={['.pdf']}
        title="Drop a labeled-diagram PDF here"
        hint="or click to choose a file"
        disabled={status === 'working' || status === 'waking'}
      />

      <button
        className="primary"
        disabled={!file || status === 'working' || status === 'waking'}
        onClick={handleGenerate}
      >
        {status === 'working'
          ? 'Finding labeled diagrams…'
          : status === 'waking'
            ? 'Starting server…'
            : 'Create anatomy quiz'}
      </button>

      {status === 'waking' && (
        <p className="muted small">The server was idle and is starting up. This can take up to a minute.</p>
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
            Page {progress.done} of {progress.total} · {progress.labelCount} labels found so far
          </p>
        </div>
      )}

      {status === 'error' && <p className="error">{error}</p>}
      {warning && <p className="warning">{warning}</p>}
    </section>
  );
}
