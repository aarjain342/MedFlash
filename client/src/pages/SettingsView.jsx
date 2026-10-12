import { useEffect, useState } from 'react';
import { getBillingStatus, startCheckout, openBillingPortal } from '../lib/billingApi';
import ThemeSwitch from '../components/ThemeSwitch';

function UsageLine({ label, used, limit }) {
  const percent = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="usage-line">
      <div className="usage-line-text">
        <span>{label}</span>
        <span className="usage-line-figure">{limit == null ? 'Unlimited' : `${used} / ${limit}`}</span>
      </div>
      {limit != null && (
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

function PlanPanel({ checkoutBanner }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function fetchStatus() {
    getBillingStatus()
      .then(setStatus)
      .catch((err) => setError(err.message || 'Could not load your plan'));
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  async function handleUpgrade() {
    setBusy(true);
    setError('');
    try {
      const url = await startCheckout();
      window.location.href = url;
    } catch (err) {
      setError(err.message || 'Could not start checkout');
      setBusy(false);
    }
  }

  async function handleManage() {
    setBusy(true);
    setError('');
    try {
      const url = await openBillingPortal();
      window.location.href = url;
    } catch (err) {
      setError(err.message || 'Could not open the billing portal');
      setBusy(false);
    }
  }

  const isPro = status?.status === 'active' || status?.status === 'trialing';

  return (
    <section className="panel">
      <h2>Plan</h2>
      {checkoutBanner === 'success' && <p className="warning">You’re on MedFlash Pro. Thanks for subscribing.</p>}
      {checkoutBanner === 'cancelled' && <p className="warning">Checkout cancelled. You weren’t charged.</p>}

      {!status ? (
        <p className="muted">Loading…</p>
      ) : isPro ? (
        <div className="settings-stack">
          <p className="plan-name">
            <mark>MedFlash Pro</mark>
          </p>
          {status.currentPeriodEnd && (
            <p className="muted">Renews {new Date(status.currentPeriodEnd).toLocaleDateString()}</p>
          )}
          <div>
            <button className="ghost" onClick={handleManage} disabled={busy}>
              Manage subscription
            </button>
          </div>
        </div>
      ) : (
        <div className="settings-stack">
          <p className="plan-name">Free plan</p>
          <UsageLine label="Decks" used={status.usage.decks.used} limit={status.usage.decks.limit} />
          <UsageLine label="AI generations this month" used={status.usage.generations.used} limit={status.usage.generations.limit} />
          <UsageLine label="Chat messages this month" used={status.usage.chat.used} limit={status.usage.chat.limit} />
          <p className="muted">MedFlash Pro removes every limit for $15 a month.</p>
          <div>
            <button className="primary" onClick={handleUpgrade} disabled={busy}>
              Upgrade to Pro
            </button>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], what: 'Open the command palette (⌘K on a Mac)' },
  { keys: ['Space'], what: 'Flip a flashcard, or reveal an anatomy label' },
  { keys: ['1'], what: 'Grade a card as missed' },
  { keys: ['2'], what: 'Grade a card as known' },
  { keys: ['A', '–', 'E'], what: 'Choose an answer in a quiz (1 to 5 works too)' },
  { keys: ['Enter'], what: 'Submit an answer, or move to the next question' },
  { keys: ['Esc'], what: 'Leave a study session' },
];

export default function SettingsView({ user, guestMode, onSignOut }) {
  const checkoutBanner = new URLSearchParams(window.location.search).get('checkout');

  useEffect(() => {
    if (!checkoutBanner) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('checkout');
    url.searchParams.delete('view');
    window.history.replaceState({}, '', url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Settings</h1>
        </div>
      </header>

      <div className="settings-grid">
        <section className="panel">
          <h2>Account</h2>
          {guestMode ? (
            <p className="muted">
              You’re in guest mode, so decks and quiz progress are saved only on this device. Sign up
              for an account to sync them across devices.
            </p>
          ) : (
            <div className="settings-stack">
              <div className="settings-row">
                <span className="eyebrow">Signed in as</span>
                <strong>{user?.email}</strong>
              </div>
              <div>
                <button className="ghost" onClick={onSignOut}>Sign out</button>
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Appearance</h2>
          <div className="settings-stack">
            <p className="muted">Follow your device, or pick a theme. It applies everywhere in MedFlash.</p>
            <ThemeSwitch />
          </div>
        </section>

        {!guestMode && <PlanPanel checkoutBanner={checkoutBanner} />}

        <section className="panel shortcuts kbd-hint">
          <h2>Keyboard</h2>
          <dl className="shortcut-list">
            {SHORTCUTS.map((s) => (
              <div key={s.what}>
                <dt>
                  {s.keys.map((k, i) => (k === '–' ? <span key={i}>–</span> : <kbd key={i}>{k}</kbd>))}
                </dt>
                <dd>{s.what}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}
