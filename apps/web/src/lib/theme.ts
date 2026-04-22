/**
 * Theme management — toggle, persist, and reactively track light/dark mode.
 *
 * Persistence order (read): cookie → localStorage → prefers-color-scheme.
 * The blocking script in app.html reads this same chain before first paint,
 * so the toggle here stays in sync with the initial value.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const COOKIE_NAME = 'theme';

/** Read the current theme from the DOM attribute (source of truth after app.html init). */
export function getTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'dark' : 'light';
}

/** Apply a theme to the DOM and persist it. */
function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);

  // Persist to localStorage (fast reads) and cookie (SSR-accessible if needed)
  localStorage.setItem(STORAGE_KEY, theme);
  document.cookie = `${COOKIE_NAME}=${theme};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
}

/** Toggle between light and dark. Returns the new theme. */
export function toggleTheme(): Theme {
  const next = getTheme() === 'light' ? 'dark' : 'light';
  setTheme(next);
  return next;
}
