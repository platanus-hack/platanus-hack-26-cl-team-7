import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const THEME_KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const ThemeContext = createContext(null);

// The theme the visitor picked with the toggle: 'light', 'dark', or null when
// they never did and the system setting decides. Storage can be blocked
// (private windows, disabled site data), so every access is guarded.
function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // The choice still applies for this visit; it just is not remembered.
  }
}

function systemPrefersDark() {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

export function ThemeProvider({ children }) {
  const [stored, setStored] = useState(readStoredTheme);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Without a stored choice the page follows the system setting as it changes.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = event => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const dark = stored ? stored === 'dark' : systemDark;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const toggle = useCallback(() => {
    const next = dark ? 'light' : 'dark';
    setStored(next);
    writeStoredTheme(next);
  }, [dark]);

  const value = useMemo(() => ({ dark, toggle }), [dark, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
