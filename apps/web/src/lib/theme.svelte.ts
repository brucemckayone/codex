/**
 * Theme management — toggle, persist, and reactively track light/dark mode.
 *
 * Persistence order (read): cookie → localStorage → prefers-color-scheme.
 * The blocking script in app.html reads this same chain before first paint,
 * so the reactive state here stays in sync with the initial value.
 *
 * Runes note (Codex-micw3): this file is `.svelte.ts` so it can hold a
 * module-level `$state`. Every consumer reading `themeState.theme` via
 * `$derived` stays in sync when setTheme() fires, regardless of which
 * component triggered the toggle. Prevents the stale-icon bug that used
 * to hit multi-instance ThemeToggle (sidebar, studio, mobile nav, etc.)
 * when one was clicked and the others were still mounted.
 */

import { browser } from '$app/environment';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const COOKIE_NAME = 'theme';

/**
 * Reactive theme state — the single source of truth for all UI that
 * displays the current theme. Components should read `themeState.theme`
 * via `$derived(themeState.theme)` so they re-render when it changes.
 *
 * The `<html data-theme>` attribute is kept in lock-step with this state;
 * either can be read but this is the canonical reactive source.
 */
export const themeState = $state<{ theme: Theme }>({
  theme: browser
    ? document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light'
    : 'light',
});

/** Read the current theme from the DOM attribute. Kept for legacy callers. */
export function getTheme(): Theme {
  return themeState.theme;
}

/** Apply a theme to the DOM and persist it; updates the reactive state. */
function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);

  // Persist to localStorage (fast reads) and cookie (SSR-accessible if needed)
  localStorage.setItem(STORAGE_KEY, theme);
  document.cookie = `${COOKIE_NAME}=${theme};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;

  // Notify reactive consumers. Every ThemeToggle + anything else derived
  // from themeState.theme re-renders this tick.
  themeState.theme = theme;
}

/** Toggle between light and dark. Returns the new theme. */
export function toggleTheme(): Theme {
  const next = themeState.theme === 'light' ? 'dark' : 'light';
  setTheme(next);
  return next;
}
