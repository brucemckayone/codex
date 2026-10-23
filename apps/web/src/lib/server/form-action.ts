/**
 * How SvelteKit reads the form action a request names (Codex-osuqt), shared by
 * the hook that refuses unservable ones and the log that flags stale ones.
 *
 * Read from the request's own URL, as Kit's action dispatch does: for a remote
 * call `event.url` is the calling page, and its search comes from a header the
 * client sets.
 */

/**
 * True for a browser's native form submit, whose Accept leads with text/html.
 * Kit sends any other POST (a `use:enhance` submit asks for application/json)
 * to the page's actions as a JSON request, and never takes it as a
 * remote-form submit.
 */
export function isNativeFormSubmit(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  return accept.trimStart().startsWith('text/html');
}

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
 * `Object.prototype`. Kit looks an action up on a plain object, so most of
 * those (`?/valueOf`, `?/__proto__`) resolve to something that throws, and it
 * refuses an explicit `?/default` by throwing too: a 500 any client could
 * cause. `?/toString` ran as an action and answered 200.
 */
export function namesUnservableAction(request: Request): boolean {
  if (request.method !== 'POST') return false;
  const action = namedFormAction(request);
  return (
    action !== undefined && (action === 'default' || action in Object.prototype)
  );
}
