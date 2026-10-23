/**
 * How SvelteKit reads the form action a request names (Codex-osuqt), shared by
 * the hook that refuses unservable ones and the log that flags stale ones.
 *
 * Read from the request's own URL, as Kit's action dispatch does: for a remote
 * call `event.url` is the calling page, and its search comes from a header the
 * client sets.
 */

/** The form action a request names: its first `?/<name>` key, or none. */
export function namedFormAction(request: Request): string | undefined {
  for (const [key] of new URL(request.url).searchParams) {
    if (key.startsWith('/')) return key.slice(1);
  }
  return undefined;
}

/**
 * True for a POST naming an action no page can have: Kit's reserved `default`
 * (a POST naming no action already reaches the default one), or a member of
 * `Object.prototype`. Kit looks an action up on a plain object, so
 * `?/valueOf` or `?/__proto__` resolves to something that throws, and it
 * refuses an explicit `?/default` by throwing too: each was a 500 any client
 * could cause.
 */
export function namesUnservableAction(request: Request): boolean {
  if (request.method !== 'POST') return false;
  const action = namedFormAction(request);
  return (
    action !== undefined && (action === 'default' || action in Object.prototype)
  );
}
