export default function SettingsView({ user, guestMode, onSignOut }) {
  return (
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
  );
}
