import { useState } from 'react';

function Icon({ path, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  home: 'M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9',
  decks: 'M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z',
  flashcards: 'M3 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7ZM8 3h11a2 2 0 0 1 2 2v11',
  questions:
    'M9.1 9a3 3 0 1 1 4.6 2.5c-.9.6-1.7 1.1-1.7 2.5M12 18h.01M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4 3v-3H6a2 2 0 0 1-2-2V6Z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  signOut: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  collapse: 'M15 6l-6 6 6 6M5 4v16',
  expand: 'M9 6l6 6-6 6M19 4v16',
};

const NAV_ITEMS = [
  { key: 'home', label: 'Home', icon: ICONS.home },
  { key: 'decks', label: 'Decks', icon: ICONS.decks },
  { key: 'flashcards', label: 'Flashcards', icon: ICONS.flashcards },
  { key: 'questions', label: 'Questions', icon: ICONS.questions },
  { key: 'settings', label: 'Settings', icon: ICONS.settings },
];

const COLLAPSE_KEY = 'medflash-sidebar-collapsed';

// Persistent app-wide shell: sidebar nav on the left, whatever the current view is on the
// right. Study/Quiz render inside the same content slot as the Decks view, so the sidebar
// (and its nav state) stays visible and unaffected while moving between them.
export default function AppShell({ activeView, onNavigate, user, guestMode, onSignOut, children }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }

  return (
    <div className="app-shell">
      <nav className={`app-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="app-sidebar-top">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            {!collapsed && <span className="brand-name">MedFlash</span>}
          </div>
          <button
            className="sidebar-collapse-toggle"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon path={collapsed ? ICONS.expand : ICONS.collapse} size={16} />
          </button>
        </div>

        <ul className="sidebar-nav-list">
          {NAV_ITEMS.map((item) => (
            <li key={item.key}>
              <button
                className={`sidebar-nav-item ${activeView === item.key ? 'active' : ''}`}
                onClick={() => onNavigate(item.key)}
                title={collapsed ? item.label : undefined}
              >
                <Icon path={item.icon} />
                {!collapsed && <span>{item.label}</span>}
              </button>
            </li>
          ))}
        </ul>

        <div className="sidebar-footer">
          {!collapsed && (
            <div className="sidebar-user" title={guestMode ? undefined : user?.email}>
              {guestMode ? 'Guest mode' : user?.email}
            </div>
          )}
          {!guestMode && (
            <button
              className="sidebar-nav-item sidebar-signout"
              onClick={onSignOut}
              title={collapsed ? 'Sign out' : undefined}
            >
              <Icon path={ICONS.signOut} />
              {!collapsed && <span>Sign out</span>}
            </button>
          )}
        </div>
      </nav>

      <main className="app-shell-content stagger-in">{children}</main>
    </div>
  );
}
