/**
 * The client-facing error for a remote function whose input failed its schema
 * — what `hooks.server.ts`'s `handleValidationError` returns.
 *
 * SvelteKit's default is `{ message: 'Bad Request' }`, so a page-builder
 * autosave the page schema refused said "Couldn't save your changes — Bad
 * Request", with nothing to say which section or what to fix, and every later
 * autosave failed the same way (Codex-61zsk review). The first issue is the
 * part a creator can act on, and it describes their own input, so nothing
 * server-side leaks into it.
 */

/** A Standard Schema issue, structurally (SvelteKit passes these). */
export interface ValidationIssue {
  message: string;
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
}

export function validationErrorFor(
  issues: readonly ValidationIssue[]
): App.Error {
  const [first] = issues;
  if (!first) return { message: 'Bad Request', code: 'VALIDATION_ERROR' };

  const path = (first.path ?? []).map((segment) =>
    typeof segment === 'object' && segment !== null ? segment.key : segment
  );
  // Page saves carry `sections[i]`, and "Section 3" is the name a creator can
  // find; any other path stays out of the message.
  const where =
    path[0] === 'sections' && typeof path[1] === 'number'
      ? `Section ${path[1] + 1}: `
      : '';

  return { message: `${where}${first.message}`, code: 'VALIDATION_ERROR' };
}
