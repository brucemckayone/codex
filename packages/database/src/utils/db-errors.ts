import { POSTGRES_ERROR_CODES } from '@codex/constants';

/**
 * Database Error Utilities
 *
 * Type-safe error detection for Postgres/Neon database errors.
 */

/**
 * Query condition construction error
 * Used when a helper fails to produce a SQL condition (e.g., and() returns undefined)
 */
export interface QueryConditionContext {
  scope?: 'creator' | 'organization';
  table?: string;
}

export class QueryConditionError extends Error {
  constructor(
    message: string,
    public readonly context?: QueryConditionContext
  ) {
    super(message);
    this.name = 'QueryConditionError';
  }
}

/**
 * Postgres Error Interface
 * Represents the structure of errors returned by Postgres/Neon
 */
interface PostgresError extends Error {
  code: string;
  detail?: string;
  constraint?: string;
  table?: string;
  schema?: string;
}

/**
 * Type guard to check if an error is a Postgres error
 */
function isPostgresError(error: unknown): error is PostgresError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

/**
 * Check if error is a unique constraint violation
 * Postgres error code: 23505
 *
 * Checks both the error itself and its cause (for DrizzleQueryError wrapping)
 */
export function isUniqueViolation(error: unknown): boolean {
  if (
    isPostgresError(error) &&
    error.code === POSTGRES_ERROR_CODES.UNIQUE_VIOLATION
  ) {
    return true;
  }

  // Check if the error has a cause (Drizzle wraps Postgres errors)
  if (error instanceof Error && 'cause' in error) {
    const cause = (error as { cause: unknown }).cause;
    return (
      isPostgresError(cause) &&
      cause.code === POSTGRES_ERROR_CODES.UNIQUE_VIOLATION
    );
  }

  return false;
}

/**
 * Check if error is a foreign key violation
 * Postgres error code: 23503
 *
 * Checks both the error itself and its cause (for DrizzleQueryError wrapping)
 */
export function isForeignKeyViolation(error: unknown): boolean {
  if (
    isPostgresError(error) &&
    error.code === POSTGRES_ERROR_CODES.FOREIGN_KEY_VIOLATION
  ) {
    return true;
  }

  // Check if the error has a cause (Drizzle wraps Postgres errors)
  if (error instanceof Error && 'cause' in error) {
    const cause = (error as { cause: unknown }).cause;
    return (
      isPostgresError(cause) &&
      cause.code === POSTGRES_ERROR_CODES.FOREIGN_KEY_VIOLATION
    );
  }

  return false;
}

/**
 * Check if error is a not-null violation
 * Postgres error code: 23502
 *
 * Checks both the error itself and its cause (for DrizzleQueryError wrapping)
 */
export function isNotNullViolation(error: unknown): boolean {
  if (
    isPostgresError(error) &&
    error.code === POSTGRES_ERROR_CODES.NOT_NULL_VIOLATION
  ) {
    return true;
  }

  // Check if the error has a cause (Drizzle wraps Postgres errors)
  if (error instanceof Error && 'cause' in error) {
    const cause = (error as { cause: unknown }).cause;
    return (
      isPostgresError(cause) &&
      cause.code === POSTGRES_ERROR_CODES.NOT_NULL_VIOLATION
    );
  }

  return false;
}

/**
 * Get constraint name from Postgres error
 */
export function getConstraintName(error: unknown): string | null {
  if (isPostgresError(error)) {
    return error.constraint || null;
  }
  return null;
}

/**
 * Get error detail from Postgres error
 */
export function getErrorDetail(error: unknown): string | null {
  if (isPostgresError(error)) {
    return error.detail || null;
  }
  return null;
}

const FAILED_QUERY = 'Failed query:';
const NO_DRIVER_REASON = 'Query failed; the driver gave no reason';
const QUERY_WITHHELD = 'Message withheld: it holds a failed query';
const UNPRINTABLE = 'An error that could not be printed';
/** drizzle wraps once; the bound only stops a chain that loops back on itself. */
const MAX_CAUSE_HOPS = 8;

/**
 * drizzle's wrapper for a failed query: its message is only
 * `Failed query: <sql>\nparams: <params>`, and its `cause`, always set, is what
 * the driver rejected with. A plain Error is not one, so `!isFailedQuery(e)`
 * leaves an Error an Error.
 */
export interface FailedQueryError extends Error {
  cause: unknown;
}

/**
 * Whether this is drizzle's wrapper for a failed query. It runs on failure
 * paths, so an error it cannot read is not one, rather than a new throw.
 */
export function isFailedQuery(error: unknown): error is FailedQueryError {
  try {
    return (
      error instanceof Error &&
      typeof error.message === 'string' &&
      error.message.startsWith(FAILED_QUERY)
    );
  } catch {
    return false;
  }
}

/**
 * An error's message for a log line, without a failed query's SQL and
 * parameters. drizzle wraps every failed query as `Failed query: <sql>\nparams:
 * <params>`, with whatever the driver rejected with as its `cause`, and a
 * parameter can be a key holding a 32-character user id, for which production
 * redaction hashes the whole line. This walks that chain to the driver's
 * reason. Any other error keeps its own message, the specific one, even when
 * it has a cause.
 *
 * The driver's reason is not always an Error: neon's WebSocket shim rejects
 * with the socket's error Event. A query's text is never returned: a failed
 * query with no reason under it says so, and a query inside other text (a
 * stringified error, a stack, a wrapper's message) is withheld, since nothing
 * there says whether the driver gave a reason.
 *
 * It runs in catch blocks, so it never throws: an error it cannot read is
 * logged as that, rather than replacing the error being handled.
 *
 * drizzle's real prefix is pinned by media-api's orphan sweep test, which runs
 * a failed query (Codex-kk9nv.13).
 */
export function messageForLog(error: unknown): string {
  try {
    let reported = error;
    for (let hop = 0; hop < MAX_CAUSE_HOPS; hop++) {
      if (!isFailedQuery(reported) || !isReason(reported.cause)) break;
      reported = reported.cause;
    }
    const message = describeForLog(reported);
    if (!message.includes(FAILED_QUERY)) return message;
    return message.startsWith(FAILED_QUERY) ? NO_DRIVER_REASON : QUERY_WITHHELD;
  } catch {
    return UNPRINTABLE;
  }
}

/**
 * An error's stack for a log line, or nothing when it holds a failed query: a
 * stack opens with its error's message, so a failed query's, or a wrapper's
 * that embeds one, carries the SQL and params. Like {@link messageForLog}, it
 * never throws.
 */
export function stackForLog(error: unknown): string | undefined {
  try {
    if (!(error instanceof Error) || typeof error.stack !== 'string') {
      return undefined;
    }
    return error.stack.includes(FAILED_QUERY) ? undefined : error.stack;
  } catch {
    return undefined;
  }
}

/** A cause that can say what went wrong: anything but nothing or ''. */
function isReason(cause: unknown): boolean {
  return cause !== undefined && cause !== null && cause !== '';
}

/** An Error's message, else its name; a non-Error's own message, else itself. */
function describeForLog(reported: unknown): string {
  if (reported instanceof Error) {
    const { message, name } = reported;
    return typeof message === 'string' && message !== ''
      ? message
      : String(name);
  }
  const { message } = (reported ?? {}) as { message?: unknown };
  if (typeof message === 'string' && message !== '') {
    return message;
  }
  return String(reported);
}
