/**
 * One line naming a thrown value, for a log field such as a ServiceError's
 * `cause`. Never for a response: it names internals.
 *
 * An Error reads `Name: message`. Anything else is JSON, or String() when it
 * will not serialise, so a plain-object cause is not logged as
 * '[object Object]'.
 *
 * A drizzle query error is the exception. Its message ends with the query's
 * bound params, which can hold tokens and email addresses, and it sets no
 * `name` of its own, so it is known by the `params` it carries. The driver
 * error underneath says what failed, so that is what gets named.
 */
export function describeThrown(value: unknown): string {
  if (value instanceof Error) {
    if ('params' in value) {
      return value.cause === undefined
        ? 'Failed query'
        : `Failed query: ${describeThrown(value.cause)}`;
    }
    return `${value.name}: ${value.message}`;
  }
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
