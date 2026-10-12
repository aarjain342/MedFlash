import { useEffect, useState } from 'react';
import { getThemePreference, setThemePreference } from './theme';

// [preference, setPreference] kept in sync across every place that shows the theme control
// (account menu, settings), since they can be on screen at the same time.
export function useThemePreference() {
  const [preference, setPreference] = useState(getThemePreference);

  useEffect(() => {
    const sync = () => setPreference(getThemePreference());
    window.addEventListener('medflash-theme', sync);
    return () => window.removeEventListener('medflash-theme', sync);
  }, []);

  return [preference, setThemePreference];
}
