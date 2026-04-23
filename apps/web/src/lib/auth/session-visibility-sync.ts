/**
 * Session Visibility Sync — decision logic for re-validating the auth
 * session when a tab returns to the foreground.
 *
 * Extracted as a pure function so the rules can be exercised by unit tests
 * without a browser, a cookie jar, or a Svelte mount. The root layout calls
 * this on every `visibilitychange`-visible event and invalidates
 * `app:auth` based on the decision.
 *
 * Why two triggers?
 *   1. **Cookie-diff (same-device fast path)** — when the session cookie
 *      appeared/disappeared since the last check (login/logout on another
 *      tab or subdomain), re-validate immediately regardless of cooldown.
 *   2. **Unauthenticated re-check (cross-device / bfcache)** — when we
 *      currently think we are signed out (`hasUser=false`) re-validate on
 *      visibility-return even if the cookie did not change. Catches Safari
 *      bfcache restoring a pre-login DOM snapshot where the cookie IS
 *      present, and same-device OAuth / magic-link flows where the cookie
 *      was written after our last observation. Throttled by `cooldownMs`
 *      so rapid tab-switches do not hammer the session endpoint.
 */

export type VisibilityState = 'visible' | 'hidden' | 'prerender';

export type AuthRevalidationDecision =
  | { action: 'none' }
  | {
      action: 'invalidate';
      reason: 'cookie-diff' | 'unauthenticated-recheck';
    };

export interface AuthRevalidationInput {
  visibilityState: VisibilityState;
  /** Whether the session cookie is present RIGHT NOW. */
  nowHasCookie: boolean;
  /** Whether the session cookie was present on the previous check. */
  lastHadCookie: boolean;
  /** Current authenticated state from the last server load. */
  hasUser: boolean;
  /** Current timestamp (ms). Injected for deterministic tests. */
  nowMs: number;
  /** Timestamp of the last revalidation trigger (ms). 0 if never. */
  lastRecheckMs: number;
  /** Throttle window for the unauthenticated re-check. */
  cooldownMs: number;
}

export function decideAuthRevalidation(
  input: AuthRevalidationInput
): AuthRevalidationDecision {
  if (input.visibilityState !== 'visible') {
    return { action: 'none' };
  }

  if (input.nowHasCookie !== input.lastHadCookie) {
    return { action: 'invalidate', reason: 'cookie-diff' };
  }

  if (!input.hasUser && input.nowMs - input.lastRecheckMs >= input.cooldownMs) {
    return { action: 'invalidate', reason: 'unauthenticated-recheck' };
  }

  return { action: 'none' };
}
