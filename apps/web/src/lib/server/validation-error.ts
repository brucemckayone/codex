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

function pathKeys(issue: ValidationIssue): PropertyKey[] {
  return (issue.path ?? []).map((segment) =>
    typeof segment === 'object' ? segment.key : segment
  );
}

/** A segment shaped like a schema's own field name. */
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;

/**
 * A path segment as a log may name it: an array index, or a field name. Any
 * other key is `*`, because a record's keys are the caller's, so the key of a
 * refused record entry (an email, any text) is input, not schema.
 */
function loggableSegment(key: PropertyKey): string {
  if (typeof key === 'number') return String(key);
  if (typeof key === 'string' && FIELD_NAME.test(key)) return key;
  return '*';
}

/** Each issue's path as `a.b.0`: what a log may say about refused input, never its values. */
export function issuePaths(issues: readonly ValidationIssue[]): string[] {
  return issues.map((issue) => pathKeys(issue).map(loggableSegment).join('.'));
}

export function validationErrorFor(
  issues: readonly ValidationIssue[]
): App.Error {
  const [first] = issues;
  if (!first) return { message: 'Bad Request', code: 'VALIDATION_ERROR' };

  const path = pathKeys(first);
  // Page saves carry `sections[i]`, and "Section 3" is the name a creator can
  // find; any other path stays out of the message.
  const where =
    path[0] === 'sections' && typeof path[1] === 'number'
      ? `Section ${path[1] + 1}: `
      : '';

  return { message: `${where}${first.message}`, code: 'VALIDATION_ERROR' };
}
