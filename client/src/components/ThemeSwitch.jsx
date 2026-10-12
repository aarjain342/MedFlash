import { useThemePreference } from '../lib/useTheme';

const OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function ThemeSwitch() {
  const [preference, setPreference] = useThemePreference();
  return (
    <div className="segmented" role="group" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          className={preference === o.value ? 'active' : ''}
          aria-pressed={preference === o.value}
          onClick={() => setPreference(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
