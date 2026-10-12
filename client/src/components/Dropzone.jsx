import { useState } from 'react';

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// A file picker you can also drop onto. `extensions` (['.pdf', ...]) is checked for dropped
// files, since drag-and-drop bypasses the input's `accept`; a file that fails it goes to
// `onReject` instead of being silently swallowed.
export default function Dropzone({ file, onFile, onReject, accept, extensions, title, hint, disabled }) {
  const [dragging, setDragging] = useState(false);

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    if (extensions.some((ext) => dropped.name.toLowerCase().endsWith(ext))) onFile(dropped);
    else onReject?.(dropped);
  }

  return (
    <label
      className={`dropzone ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => onFile(e.target.files?.[0] || null)}
      />
      <span className="dropzone-title">{file ? file.name : title}</span>
      <span className="dropzone-hint">{file ? formatBytes(file.size) : hint}</span>
    </label>
  );
}
