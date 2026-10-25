/**
 * "The session ended" or "there is no such record"? (Codex-2hxff.28 review,
 * R2-M1.)
 *
 * Two different 404s reach the support pages:
 *
 * - The worker's own, "No record of this charge". `forwardClientErrors`
 *   forwards it with `code: 'NOT_FOUND'`.
 * - The remote functions' guard: a session that is no longer the platform
 *   owner's (signed out in another tab, expired, or an auth-worker failure
 *   that the hooks treat as signed out) gets a bare `error(404, 'Not Found')`
 *   with no code.
 *
 * Only the first means not found. The second, like a 401 or a 403, means sign
 * in again; "Try again" never fixes it.
 */

type Rejection =
  | { status?: unknown; body?: { code?: unknown } }
  | null
  | undefined;

/** The worker found no such record: a real "not found". */
export function isRecordNotFound(error: unknown): boolean {
  const rejection = error as Rejection;
  return rejection?.status === 404 && rejection.body?.code === 'NOT_FOUND';
}

/** The session can no longer do this: sign in again. */
export function isSessionEnded(error: unknown): boolean {
  const rejection = error as Rejection;
  const status = rejection?.status;
  if (status === 401 || status === 403) return true;
  return status === 404 && rejection?.body?.code !== 'NOT_FOUND';
}
