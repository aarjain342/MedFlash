import { useEffect, useMemo, useRef, useState } from 'react';
import Brand from './Brand';
import CommandPalette from './CommandPalette';
import ThemeSwitch from './ThemeSwitch';

const NAV_ITEMS = [
  { key: 'home', label: 'Home' },
  { key: 'decks', label: 'Decks' },
  { key: 'flashcards', label: 'Flashcards' },
  { key: 'questions', label: 'Questions' },
  { key: 'anatomy', label: 'Anatomy' },
];

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </svg>
  );
}

function AccountMenu({ user, guestMode, onNavigate, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const email = user?.email || '';
  const initial = guestMode ? 'G' : (email[0] || '?').toUpperCase();

  return (
    <div className="account-menu" ref={ref}>
      <button
        className="account-button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initial}
      </button>
      {open && (
        <div className="account-popover" role="menu">
          <div className="account-who">
            <span className="eyebrow">{guestMode ? 'Guest mode' : 'Signed in as'}</span>
            <span className="account-email">{guestMode ? 'Decks stay on this device' : email}</span>
          </div>
          <button
            className="account-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNavigate('settings');
            }}
          >
            Settings
          </button>
          <div className="account-theme">
            <span className="eyebrow">Theme</span>
            <ThemeSwitch />
          </div>
          {!guestMode && (
            <button
              className="account-item account-signout"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
            >
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Persistent app frame: a top bar with the section tabs on wide screens, a bottom tab bar on
// phones and portrait tablets, and Ctrl/Cmd+K to jump anywhere. Study, Quiz and the Anatomy
// Quiz render inside the same content slot, so the active tab stays correct while they're open.
export default function AppShell({ activeView, onNavigate, user, guestMode, onSignOut, commands, children }) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const shortcutLabel = useMemo(() => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'), []);

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-topbar-inner">
          <Brand />
          <nav className="app-nav" aria-label="Sections">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                className={`app-nav-item ${activeView === item.key ? 'active' : ''}`}
                aria-current={activeView === item.key ? 'page' : undefined}
                onClick={() => onNavigate(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="app-topbar-actions">
            <button className="palette-trigger" onClick={() => setPaletteOpen(true)} aria-label="Search and commands">
              <SearchIcon />
              <span className="palette-trigger-label">Search</span>
              <kbd className="kbd-hint">{shortcutLabel}</kbd>
            </button>
            <AccountMenu user={user} guestMode={guestMode} onNavigate={onNavigate} onSignOut={onSignOut} />
          </div>
        </div>
      </header>

      <main className="app-shell-content stagger-in">{children}</main>

      <nav className="app-tabbar" aria-label="Sections">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={activeView === item.key ? 'active' : ''}
            aria-current={activeView === item.key ? 'page' : undefined}
            onClick={() => onNavigate(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands || []} />
    </div>
  );
}
