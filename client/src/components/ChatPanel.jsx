import { useRef, useState } from 'react';
import { sendChatMessage } from '../lib/chatApi';

export default function ChatPanel() {
  const [messages, setMessages] = useState([]); // [{ role, content }]
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    setError('');

    try {
      const reply = await sendChatMessage(text, messages.slice(-6));
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="muted small chat-empty">
            Ask anything about the medical field — mechanisms, pathophysiology, drug classes,
            board-style reasoning, whatever's on your mind while studying.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {sending && (
          <div className="chat-bubble assistant chat-thinking">
            <span className="spinner" aria-hidden="true" />
          </div>
        )}
      </div>

      {error && <p className="error chat-error">{error}</p>}

      <div className="chat-input-row">
        <textarea
          className="chat-input"
          placeholder="Ask a medical question…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button className="primary" disabled={!input.trim() || sending} onClick={handleSend}>
          Send
        </button>
      </div>
    </div>
  );
}
