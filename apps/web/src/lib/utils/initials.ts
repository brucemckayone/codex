/**
 * Derive avatar initials from a display name with email fallback.
 *
 * Splits the source on whitespace AND `@` so that an email like
 * `alice@example.com` becomes `AE` (first chars of `alice` and `example`).
 * Returns `'?'` when neither name nor email is usable.
 *
 * Canonical helper for studio avatar fallbacks (subscribers, payouts, etc.).
 */
export function getInitials(
  name: string | null | undefined,
  email: string | null | undefined
): string {
  const source = name?.trim() || email?.trim() || '';
  if (!source) return '?';
  const initials = source
    .split(/\s+|@/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return initials || '?';
}
