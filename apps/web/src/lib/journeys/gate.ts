/**
 * Course entitlement gate — the PURE decision (Codex-2pryk · WP-4).
 *
 * The `canEnterCourse` gate (SPEC §6.3 / HARDENING §E) is enforced server-side
 * in the dashboard / player `+page.server.ts`. The I/O (resolve slug→course,
 * call the resolver) lives in the load; the DECISION — 404 vs redirect-to-sell
 * vs proceed — is extracted here so it is unit-testable without SvelteKit or a
 * live resolver.
 *
 * Surface states (SPEC §6.3 / §14.2):
 *   - no course row for slug           → 404 (nothing to sell).
 *   - anonymous visitor                → redirect to the public sales page.
 *   - authed but `!canEnterCourse`     → redirect to sales (`?notenrolled` is
 *     `canView && !canEnterCourse`; the sales page owns that upsell surface).
 *   - authed and `canEnterCourse`      → proceed.
 */

export type CourseGateOutcome =
  | { kind: 'ok' }
  | { kind: 'not-found' }
  | { kind: 'redirect-to-sales' };

export interface CourseGateInput {
  /** Whether a course row resolved for the requested slug. */
  courseExists: boolean;
  /** Whether the request carries an authenticated user. */
  isAuthenticated: boolean;
  /** The resolver's answer for this (user, course). Meaningless when anon. */
  canEnterCourse: boolean;
}

/**
 * Decide what a course member surface should do for a given request. Pure —
 * no I/O, no redirect throwing; the caller acts on the outcome.
 */
export function evaluateCourseGate(input: CourseGateInput): CourseGateOutcome {
  if (!input.courseExists) return { kind: 'not-found' };
  if (!input.isAuthenticated) return { kind: 'redirect-to-sales' };
  if (!input.canEnterCourse) return { kind: 'redirect-to-sales' };
  return { kind: 'ok' };
}
