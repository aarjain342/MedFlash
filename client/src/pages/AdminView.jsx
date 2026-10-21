import { useEffect, useMemo, useState } from 'react';
import {
  getAdminOverview,
  getAdminUsers,
  getAdminPayments,
  getAdminSystem,
  getAdminUser,
} from '../lib/adminApi';
import {
  formatMoney,
  formatMoneyMap,
  formatDate,
  formatDateTime,
  relativeTime,
  safeHttpsUrl,
  filterUsers,
  sortUsers,
  billingIssueLabel,
  billingIssueExplanation,
} from '../lib/adminFormat';

// Owner-only dashboard. This screen is only mounted for an admin, but that is a convenience:
// every endpoint it calls enforces admin access on the server, so a non-admin who reached this
// component would just see "not an admin" errors and no data.

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'payments', label: 'Payments' },
  { key: 'system', label: 'System' },
];

// `fetcher` must be a stable (module-level) function. `version` bumps on Refresh, which also
// asks the server to skip its short cache.
function useAdminData(fetcher, version, key = '') {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ data: version > 0 ? s.data : null, error: '', loading: true }));
    fetcher(key, { fresh: version > 0 })
      .then((data) => {
        if (!cancelled) setState({ data, error: '', loading: false });
      })
      .catch((err) => {
        if (!cancelled) setState({ data: null, error: err.message || 'Could not load', loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, version, key]);
  return state;
}

// Adapters so every loader has the (key, options) shape useAdminData expects.
const loadOverview = (_k, o) => getAdminOverview(o);
const loadUsers = (_k, o) => getAdminUsers(o);
const loadPayments = (_k, o) => getAdminPayments(o);
const loadSystem = (_k, o) => getAdminSystem(o);
const loadUser = (id, o) => getAdminUser(id, o);

function Loaded({ state, children }) {
  if (state.error) return <p className="error">{state.error}</p>;
  if (!state.data) {
    return (
      <div className="decks-loading">
        <span className="spinner" aria-hidden="true" />
        <span className="muted">Loading…</span>
      </div>
    );
  }
  return <div className={state.loading ? 'admin-refreshing' : undefined}>{children(state.data)}</div>;
}

function Tile({ label, value, sub }) {
  return (
    <div className="admin-tile">
      <span className="eyebrow">{label}</span>
      <span className="num">{value}</span>
      {sub && <span className="admin-tile-sub">{sub}</span>}
    </div>
  );
}

function Badge({ tone, children }) {
  return <span className={`admin-badge ${tone || ''}`}>{children}</span>;
}

function planBadge(plan) {
  return plan === 'pro' ? <Badge tone="pro">Pro</Badge> : <Badge>Free</Badge>;
}

function statusBadge(status) {
  const tone = status === 'active' || status === 'trialing' ? 'ok' : status === 'past_due' || status === 'unpaid' ? 'bad' : '';
  return <Badge tone={tone}>{status}</Badge>;
}

function chargeBadge(c) {
  if (c.disputed) return <Badge tone="bad">Disputed</Badge>;
  if (c.status === 'failed') return <Badge tone="bad">Failed</Badge>;
  if (c.refunded) return <Badge>Refunded</Badge>;
  if (c.amountRefunded > 0) return <Badge>Part refunded</Badge>;
  if (c.paid) return <Badge tone="ok">Paid</Badge>;
  return <Badge>{c.status}</Badge>;
}

function KeyValues({ rows }) {
  return (
    <dl className="admin-kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function StripeNotes({ errors, reason }) {
  const messages = [...Object.values(errors || {}), reason].filter(Boolean);
  if (messages.length === 0) return null;
  return (
    <div className="warning">
      {messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  );
}

function BillingIssuesNotice({ issues, mode }) {
  const missing = issues?.not_in_stripe || 0;
  const expired = issues?.period_expired || 0;
  if (!missing && !expired) return null;
  return (
    <div className="warning">
      {missing > 0 && (
        <p>
          <strong>{missing} {missing === 1 ? 'user has' : 'users have'} Pro access that Stripe does not know about.</strong>{' '}
          {billingIssueExplanation('not_in_stripe', mode)}
        </p>
      )}
      {expired > 0 && (
        <p>
          <strong>{expired} {expired === 1 ? 'subscription is' : 'subscriptions are'} still active past {expired === 1 ? 'its' : 'their'} period end.</strong>{' '}
          {billingIssueExplanation('period_expired')}
        </p>
      )}
      <p className="small">Open the Users tab and choose Needs review to see who.</p>
    </div>
  );
}

function TestModeNotice({ mode }) {
  if (mode !== 'test') return null;
  return <p className="warning">Stripe is in test mode, so the payments below are not real money.</p>;
}

function SignupChart({ days }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((n, d) => n + d.count, 0);
  return (
    <div>
      <div className="admin-bars" role="img" aria-label={`${total} signups in the last 30 days`}>
        {days.map((d) => (
          <div
            key={d.date}
            className={`admin-bar ${d.count === 0 ? 'zero' : ''}`}
            style={{ height: `${(d.count / max) * 100}%` }}
            title={`${d.date}: ${d.count} signup${d.count === 1 ? '' : 's'}`}
          />
        ))}
      </div>
      <div className="admin-bars-axis">
        <span>{days[0]?.date}</span>
        <span>{days.at(-1)?.date}</span>
      </div>
    </div>
  );
}

// ---- Overview ------------------------------------------------------------------------------

function OverviewTab({ version }) {
  const state = useAdminData(loadOverview, version);
  return (
    <Loaded state={state}>
      {(d) => {
        const r = d.revenue;
        const money = (map) => (r.available ? formatMoneyMap(map) : '—');
        return (
          <div className="admin-stack">
            <TestModeNotice mode={r.mode} />
            <BillingIssuesNotice issues={d.plans.billingIssues} mode={r.mode} />
            <div className="admin-tiles">
              <Tile label="Users" value={d.users.total} sub={`${d.users.new7d} new this week · ${d.users.new30d} in 30 days`} />
              <Tile label="Active, 30 days" value={d.users.active30d} sub={`${d.users.active7d} in the last 7 days`} />
              <Tile
                label="Pro subscribers"
                value={d.plans.pro}
                sub={`${d.plans.free} on the free plan${
                  d.plans.billingIssues.not_in_stripe ? ` · ${d.plans.billingIssues.not_in_stripe} not in Stripe` : ''
                }`}
              />
              <Tile
                label="Monthly recurring"
                value={money(r.mrr)}
                sub={r.available ? `${r.activeSubscribers} active · list price` : 'Stripe unavailable'}
              />
              <Tile label="Net revenue" value={money(r.net)} sub={r.available ? `${money(r.last30Days)} in the last 30 days` : undefined} />
              <Tile
                label="Decks"
                value={d.content.decks}
                sub={`${d.content.decksNew7d} new this week · ${d.content.anatomyDecks} anatomy · ${d.content.quizzes} quizzes`}
              />
            </div>

            <div className="admin-two">
              <section className="panel">
                <h2>Signups, last 30 days</h2>
                <SignupChart days={d.users.signupsByDay} />
              </section>
              <section className="panel">
                <h2>Accounts</h2>
                <KeyValues
                  rows={[
                    ['Confirmed email', d.users.confirmed],
                    ['Unconfirmed', d.users.unconfirmed],
                    ['Never signed in', d.users.neverSignedIn],
                    ...Object.entries(d.plans.byStatus).map(([status, n]) => [`Subscription: ${status}`, n]),
                  ]}
                />
              </section>
            </div>

            <div className="admin-two">
              <section className="panel">
                <h2>Revenue</h2>
                {r.available ? (
                  <KeyValues
                    rows={[
                      ['Gross', formatMoneyMap(r.gross)],
                      ['Refunded', formatMoneyMap(r.refunded)],
                      ['Net', formatMoneyMap(r.net)],
                      ['Last 30 days (net)', formatMoneyMap(r.last30Days)],
                      ['Paid charges', r.charges.succeeded],
                      ['Failed charges', r.charges.failed],
                      ['Disputed', r.charges.disputed],
                      ['Past-due subscriptions', r.pastDue],
                      ['Cancelling at period end', r.canceling],
                    ]}
                  />
                ) : (
                  <p className="muted">Payment data is not available.</p>
                )}
                <StripeNotes errors={r.errors} reason={r.reason} />
              </section>
              <section className="panel">
                <h2>AI usage, {d.usage.month.slice(0, 7)}</h2>
                <KeyValues
                  rows={[
                    ['Generations this month', d.usage.generations],
                    ['Chat messages this month', d.usage.chat],
                    ['Generations, all time', d.usage.lifetimeGenerations],
                    ['Chat messages, all time', d.usage.lifetimeChat],
                  ]}
                />
                {d.usage.top.length > 0 && (
                  <>
                    <p className="eyebrow admin-subhead">Heaviest users this month</p>
                    <div className="admin-table-wrap">
                      <table className="admin-table compact">
                        <thead>
                          <tr>
                            <th>User</th>
                            <th className="num-cell">Gen</th>
                            <th className="num-cell">Chat</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.usage.top.map((u) => (
                            <tr key={u.id}>
                              <td>{u.email || u.id}</td>
                              <td className="num-cell">{u.generations}</td>
                              <td className="num-cell">{u.chat}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            </div>
            <p className="muted small">Updated {formatDateTime(d.generatedAt)}</p>
          </div>
        );
      }}
    </Loaded>
  );
}

// ---- Users ---------------------------------------------------------------------------------

const USER_COLUMNS = [
  { key: 'email', label: 'Email', render: (u) => u.email || u.id },
  {
    key: 'plan',
    label: 'Plan',
    render: (u) => (
      <>
        {planBadge(u.plan)}
        {u.billingIssue && (
          <>
            {' '}
            <Badge tone="bad">{billingIssueLabel(u.billingIssue)}</Badge>
          </>
        )}
      </>
    ),
  },
  { key: 'createdAt', label: 'Joined', render: (u) => formatDate(u.createdAt) },
  { key: 'lastSignInAt', label: 'Last seen', render: (u) => relativeTime(u.lastSignInAt) },
  { key: 'decks', label: 'Decks', numeric: true, render: (u) => u.decks },
  { key: 'anatomyDecks', label: 'Anatomy', numeric: true, render: (u) => u.anatomyDecks },
  { key: 'quizzes', label: 'Quizzes', numeric: true, render: (u) => u.quizzes },
  { key: 'generations', label: 'Gen / mo', numeric: true, render: (u) => u.usageThisMonth.generations },
  { key: 'chat', label: 'Chat / mo', numeric: true, render: (u) => u.usageThisMonth.chat },
  { key: 'paid', label: 'Paid', numeric: true, render: (u) => (u.paid == null ? '—' : formatMoneyMap(u.paid)) },
];

function UsersTab({ version }) {
  const state = useAdminData(loadUsers, version);
  const [query, setQuery] = useState('');
  const [plan, setPlan] = useState('all');
  const [sort, setSort] = useState({ key: 'createdAt', dir: 'desc' });
  const [selectedId, setSelectedId] = useState(null);

  const rows = useMemo(() => {
    if (!state.data) return [];
    return sortUsers(filterUsers(state.data.users, { query, plan }), sort.key, sort.dir);
  }, [state.data, query, plan, sort]);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'email' ? 'asc' : 'desc' }));
  }

  if (selectedId) return <UserDetail id={selectedId} version={version} onBack={() => setSelectedId(null)} />;

  return (
    <Loaded state={state}>
      {(d) => (
        <div className="admin-stack">
          <div className="admin-toolbar">
            <input
              type="search"
              className="admin-search"
              placeholder="Search by email or id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search users"
            />
            <div className="segmented" role="group" aria-label="Filter by plan">
              {[
                ['all', 'All'],
                ['pro', 'Pro'],
                ['free', 'Free'],
                ['issues', 'Needs review'],
              ].map(([p, label]) => (
                <button key={p} className={plan === p ? 'active' : ''} onClick={() => setPlan(p)}>
                  {label}
                </button>
              ))}
            </div>
            <span className="muted small">
              {rows.length} of {d.users.length} users
            </span>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {USER_COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={c.numeric ? 'num-cell' : undefined}
                      aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button className="admin-th-button" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        {sort.key === c.key && <span aria-hidden="true">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="clickable" onClick={() => setSelectedId(u.id)}>
                    {USER_COLUMNS.map((c) => (
                      <td key={c.key} className={c.numeric ? 'num-cell' : undefined}>
                        {c.render(u)}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={USER_COLUMNS.length} className="muted">
                      No users match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Loaded>
  );
}

function ChargesTable({ charges }) {
  if (charges.length === 0) return <p className="muted">No charges.</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Customer</th>
            <th className="num-cell">Amount</th>
            <th>Status</th>
            <th className="num-cell">Refunded</th>
            <th>Description</th>
            <th>Receipt</th>
          </tr>
        </thead>
        <tbody>
          {charges.map((c) => {
            const receipt = safeHttpsUrl(c.receiptUrl);
            return (
              <tr key={c.id}>
                <td>{formatDateTime(c.createdAt)}</td>
                <td>{c.email || c.customerId || '—'}</td>
                <td className="num-cell">{formatMoney(c.amount, c.currency)}</td>
                <td>
                  {chargeBadge(c)}
                  {c.failureMessage && <span className="muted small"> {c.failureMessage}</span>}
                </td>
                <td className="num-cell">{c.amountRefunded ? formatMoney(c.amountRefunded, c.currency) : '—'}</td>
                <td>{c.description || '—'}</td>
                <td>
                  {receipt ? (
                    <a href={receipt} target="_blank" rel="noopener noreferrer">
                      View
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SubscriptionsTable({ subscriptions }) {
  if (subscriptions.length === 0) return <p className="muted">No subscriptions.</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Status</th>
            <th className="num-cell">Price</th>
            <th>Interval</th>
            <th>Started</th>
            <th>Renews / ends</th>
            <th>Cancels at period end</th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.map((s) => (
            <tr key={s.id}>
              <td>{s.email || s.userId || '—'}</td>
              <td>{statusBadge(s.status)}</td>
              <td className="num-cell">{s.amount == null ? '—' : formatMoney(s.amount, s.currency)}</td>
              <td>{s.interval || '—'}</td>
              <td>{formatDate(s.createdAt)}</td>
              <td>{formatDate(s.canceledAt || s.currentPeriodEnd)}</td>
              <td>{s.cancelAtPeriodEnd ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserDetail({ id, version, onBack }) {
  const state = useAdminData(loadUser, version, id);
  return (
    <div className="admin-stack">
      <div>
        <button className="ghost" onClick={onBack}>
          ← All users
        </button>
      </div>
      <Loaded state={state}>
        {(u) => (
          <div className="admin-stack">
            {u.billingIssue && <p className="warning">{billingIssueExplanation(u.billingIssue)}</p>}
            <section className="panel">
              <div className="panel-head">
                <h2>{u.email || u.id}</h2>
                <div>{planBadge(u.subscription && (u.subscription.status === 'active' || u.subscription.status === 'trialing') ? 'pro' : 'free')}</div>
              </div>
              <KeyValues
                rows={[
                  ['User id', u.id],
                  ['Joined', formatDateTime(u.createdAt)],
                  ['Last sign-in', u.lastSignInAt ? `${formatDateTime(u.lastSignInAt)} (${relativeTime(u.lastSignInAt)})` : 'never'],
                  ['Email confirmed', u.confirmed ? 'Yes' : 'No'],
                  ['Sign-in method', u.provider],
                  ['Phone', u.phone],
                  ['Banned until', u.bannedUntil ? formatDateTime(u.bannedUntil) : null],
                  ['Subscription status', u.subscription?.status ?? 'none'],
                  ['Period ends', u.subscription?.currentPeriodEnd ? formatDateTime(u.subscription.currentPeriodEnd) : null],
                  ['Stripe customer', u.subscription?.stripeCustomerId],
                ]}
              />
            </section>

            <div className="admin-two">
              <section className="panel">
                <h2>Decks ({u.decks.length})</h2>
                {u.decks.length === 0 ? (
                  <p className="muted">None.</p>
                ) : (
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <tbody>
                        {u.decks.map((d) => (
                          <tr key={d.id}>
                            <td>{d.name}</td>
                            <td className="muted">{d.sourceFile || '—'}</td>
                            <td>{formatDate(d.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="eyebrow admin-subhead">Anatomy quizzes ({u.anatomyDecks.length}) · Saved quizzes ({u.quizzes.length})</p>
                {u.anatomyDecks.map((d) => (
                  <p key={d.id} className="muted small">
                    {d.name} · {formatDate(d.createdAt)}
                  </p>
                ))}
              </section>
              <section className="panel">
                <h2>AI usage by month</h2>
                {u.usage.length === 0 ? (
                  <p className="muted">No usage recorded.</p>
                ) : (
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th className="num-cell">Generations</th>
                          <th className="num-cell">Chat</th>
                        </tr>
                      </thead>
                      <tbody>
                        {u.usage.map((m) => (
                          <tr key={m.month}>
                            <td>{String(m.month).slice(0, 7)}</td>
                            <td className="num-cell">{m.generations}</td>
                            <td className="num-cell">{m.chat}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <section className="panel">
              <h2>Payments</h2>
              {u.payments.available ? (
                <div className="admin-stack">
                  <StripeNotes errors={u.payments.errors} />
                  <SubscriptionsTable subscriptions={u.payments.subscriptions} />
                  <ChargesTable charges={u.payments.charges} />
                </div>
              ) : (
                <p className="muted">No billing account on file for this user.</p>
              )}
            </section>
          </div>
        )}
      </Loaded>
    </div>
  );
}

// ---- Payments ------------------------------------------------------------------------------

function PaymentsTab({ version }) {
  const state = useAdminData(loadPayments, version);
  return (
    <Loaded state={state}>
      {(d) =>
        !d.available ? (
          <p className="muted">{d.reason || 'Payment data is not available.'}</p>
        ) : (
          <div className="admin-stack">
            <TestModeNotice mode={d.mode} />
            <StripeNotes errors={d.errors} />
            <section className="panel">
              <h2>Subscriptions ({d.subscriptions.length})</h2>
              <SubscriptionsTable subscriptions={d.subscriptions} />
            </section>
            <section className="panel">
              <h2>Charges ({d.charges.length}{d.truncated ? '+' : ''})</h2>
              {d.truncated && <p className="muted small">Showing the most recent {d.charges.length}.</p>}
              <ChargesTable charges={d.charges} />
            </section>
            <p className="muted small">Updated {formatDateTime(d.generatedAt)}</p>
          </div>
        )
      }
    </Loaded>
  );
}

// ---- System --------------------------------------------------------------------------------

function Check({ ok, children }) {
  return (
    <span>
      <Badge tone={ok ? 'ok' : 'bad'}>{ok ? 'Set' : 'Missing'}</Badge> {children}
    </span>
  );
}

function SystemTab({ version }) {
  const state = useAdminData(loadSystem, version);
  return (
    <Loaded state={state}>
      {(s) => (
        <div className="admin-stack">
          {s.configured.adminUserIdsPinned === 0 && (
            <p className="warning">
              Admin access is matched by email only. Email confirmation is off for sign-ups, so if this admin account were ever
              deleted, anyone could register the same address and become admin. Set ADMIN_USER_IDS on the server to pin it to
              your account.
            </p>
          )}
          <div className="admin-two">
            <section className="panel">
              <h2>Services</h2>
              <KeyValues
                rows={[
                  ['Supabase service role', <Check key="a" ok={s.configured.supabaseAdmin} />],
                  ['Stripe key', <Check key="b" ok={s.configured.stripe}>{s.stripeMode} mode</Check>],
                  [
                    'Stripe account',
                    s.stripeAccount?.available
                      ? `${s.stripeAccount.id} · ${s.stripeAccount.country || '?'} · charges ${s.stripeAccount.chargesEnabled ? 'on' : 'off'}`
                      : s.stripeAccount?.reason || 'unavailable',
                  ],
                  ['Stripe webhook secret', <Check key="c" ok={s.configured.stripeWebhookSecret} />],
                  ['Stripe price', <Check key="d" ok={s.configured.stripePrice} />],
                  ['Gemini key', <Check key="e" ok={s.configured.gemini} />],
                  ['Groq key', <Check key="f" ok={s.configured.groq} />],
                  ['LLM provider', s.llmProvider],
                  ['Admin emails configured', s.configured.adminEmails],
                  ['Admin ids pinned', s.configured.adminUserIdsPinned],
                ]}
              />
            </section>
            <section className="panel">
              <h2>Server</h2>
              <KeyValues
                rows={[
                  ['Node', s.node],
                  ['Uptime', `${Math.floor(s.uptimeSeconds / 3600)}h ${Math.floor((s.uptimeSeconds % 3600) / 60)}m`],
                  ['Memory (rss)', `${s.memoryMb.rss} MB`],
                  ['Memory (heap)', `${s.memoryMb.heapUsed} MB`],
                  ['Frontend URL', s.frontendUrl],
                  ['Checked', formatDateTime(s.generatedAt)],
                ]}
              />
            </section>
          </div>
        </div>
      )}
    </Loaded>
  );
}

// ---- Page ----------------------------------------------------------------------------------

export default function AdminView() {
  const [tab, setTab] = useState('overview');
  const [version, setVersion] = useState(0);

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Owner only</p>
          <h1>Admin</h1>
        </div>
        <div className="admin-head-tools">
          <div className="segmented" role="tablist" aria-label="Admin sections">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? 'active' : ''}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button className="ghost" onClick={() => setVersion((v) => v + 1)}>
            Refresh
          </button>
        </div>
      </header>

      {tab === 'overview' && <OverviewTab version={version} />}
      {tab === 'users' && <UsersTab version={version} />}
      {tab === 'payments' && <PaymentsTab version={version} />}
      {tab === 'system' && <SystemTab version={version} />}
    </>
  );
}
