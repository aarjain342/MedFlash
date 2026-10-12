// Theme preference: 'system' (follow the OS), 'light' or 'dark'. The inline script in
// index.html applies it before first paint so there's no flash; this module owns changes after
// that. The document's data-theme attribute is always the resolved 'light' | 'dark'.
const KEY = 'medflash-theme';
export const THEMES = ['system', 'light', 'dark'];

export function resolveTheme(preference, systemPrefersDark) {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemPrefersDark ? 'dark' : 'light';
}

export function getThemePreference() {
  try {
    const stored = localStorage.getItem(KEY);
    return THEMES.includes(stored) ? stored : 'system';
  } catch {
    return 'system'; // storage can be blocked (private windows); the OS setting is a fine default
  }
}

function systemPrefersDark() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(preference) {
  document.documentElement.dataset.theme = resolveTheme(preference, systemPrefersDark());
}

export function setThemePreference(preference) {
  try {
    localStorage.setItem(KEY, preference);
  } catch {
    // not persisted, but still applied for this session
  }
  applyTheme(preference);
  window.dispatchEvent(new Event('medflash-theme'));
}

// Keeps a 'system' preference live when the OS flips between light and dark.
export function watchSystemTheme() {
  if (typeof matchMedia !== 'function') return () => {};
  const query = matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getThemePreference() === 'system') applyTheme('system');
  };
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
