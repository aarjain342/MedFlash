import { useEffect, useState } from 'react';
import { getBillingStatus, startCheckout, openBillingPortal } from '../lib/billingApi';

function UsageLine({ label, used, limit }) {
  if (limit == null) return <p className="muted small">{label}: unlimited</p>;
  return (
    <p className="muted small">
      {label}: {used} / {limit}
    </p>
  );
}

function PlanPanel({ checkoutBanner }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [interval, setInterval_] = useState('monthly');
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
      const url = await startCheckout(interval);
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
    <div className="panel">
      <h2>Plan</h2>
      {checkoutBanner === 'success' && (
        <p className="muted small">You're on MedFlash Pro — thanks for subscribing!</p>
      )}
      {checkoutBanner === 'cancelled' && <p className="muted small">Checkout cancelled — no charge was made.</p>}

      {!status ? (
        <p className="muted small">Loading…</p>
      ) : isPro ? (
        <>
          <p>
            <strong>MedFlash Pro</strong> ({status.plan === 'annual' ? 'annual' : 'monthly'})
          </p>
          {status.currentPeriodEnd && (
            <p className="muted small">Renews {new Date(status.currentPeriodEnd).toLocaleDateString()}</p>
          )}
          <button className="ghost" onClick={handleManage} disabled={busy}>
            Manage subscription
          </button>
        </>
      ) : (
        <>
          <p className="muted">Free plan</p>
          <UsageLine label="Decks" used={status.usage.decks.used} limit={status.usage.decks.limit} />
          <UsageLine label="AI generations this month" used={status.usage.generations.used} limit={status.usage.generations.limit} />
          <UsageLine label="Chat messages this month" used={status.usage.chat.used} limit={status.usage.chat.limit} />

          <div className="settings-row">
            <label>
              <input
                type="radio"
                name="interval"
                checked={interval === 'monthly'}
                onChange={() => setInterval_('monthly')}
              />{' '}
              $9/month
            </label>
            <label>
              <input
                type="radio"
                name="interval"
                checked={interval === 'annual'}
                onChange={() => setInterval_('annual')}
              />{' '}
              $79/year
            </label>
          </div>

          <button className="primary" onClick={handleUpgrade} disabled={busy}>
            Upgrade to MedFlash Pro
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

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
      <div className="panel">
        <h2>Settings</h2>
        {guestMode ? (
          <p className="muted">
            You're in guest mode — decks and quiz progress are saved only on this device. Sign up
            for an account to sync them across devices.
          </p>
        ) : (
          <>
            <div className="settings-row">
              <span className="muted">Signed in as</span>
              <strong>{user?.email}</strong>
            </div>
            <button className="ghost" onClick={onSignOut}>Sign out</button>
          </>
        )}
      </div>

      {!guestMode && <PlanPanel checkoutBanner={checkoutBanner} />}
    </>
  );
}
