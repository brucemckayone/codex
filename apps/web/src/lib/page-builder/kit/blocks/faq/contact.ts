import { safeHref } from '../../../render/safe-href';

/** One address, nothing else: `you@example.com`, no scheme, no path. */
const BARE_EMAIL = /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/;

/**
 * The contact link's destination. A creator asked for "an email address or
 * a web page" types the address as they would anywhere else, and a bare
 * address would otherwise be a RELATIVE link to a page that does not exist —
 * so it becomes a `mailto:`. Everything passes `safeHref`.
 */
export function contactHref(raw: string | undefined): string {
  const value = raw?.trim();
  if (value && BARE_EMAIL.test(value)) return `mailto:${value}`;
  return safeHref(value);
}
