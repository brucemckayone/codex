/**
 * The opening plays once a visit, not on every return to the landing (the
 * owner's, 2026-11-23: "every session should maybe get one, but not each
 * time"). A visit is the tab's session; each org is its own origin, so its
 * own visit. Storage can be missing or throw (a private window, blocked
 * site data): then the opening plays as before.
 */
const KEY = 'showreel:opening-seen';

/** Whether this visit has had its opening. */
export function openingSeen(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** This visit has had its opening. */
export function markOpeningSeen(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // No storage: the next return plays it again, as before.
  }
}
