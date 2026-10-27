/**
 * The creator handle from a `/@username` route param (Codex-osuqt).
 *
 * A handle the identity route would refuse (`usernameSchema`) is a 404 here,
 * before any request. Sent on, it came back a 400 that every creator page let
 * through as a 500 with an error-level log, so a mistyped or crawled URL could
 * raise that alarm, and a visitor saw "something went wrong" for a page that
 * simply does not exist.
 */
import { usernameSchema } from '@codex/validation';
import { error } from '@sveltejs/kit';

export function creatorHandle(param: string): string {
  const username = param.replace(/^@/, '');
  if (!usernameSchema.safeParse(username).success) {
    error(404, 'Creator not found');
  }
  return username;
}
