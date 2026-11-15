/**
 * Every arg a remote read's schema parsed, as the query it forwards: the
 * args ARE the worker's own query schema's, so the two cannot drift. A
 * hand-picked copy once dropped `contentType` and `accessType`, which the
 * worker took all along, so the studio list's Type and Access menus changed
 * nothing (Codex-a6ofh.3.1). An undefined arg is left out.
 */
export function searchParamsOf(
  args: Readonly<Record<string, unknown>> | undefined
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params;
}
