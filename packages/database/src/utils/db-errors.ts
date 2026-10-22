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

/**
 * An error's message for a log line, without a failed query's SQL and
 * parameters. drizzle wraps every failed query as `Failed query: <sql>\nparams:
 * <params>`, with the driver's error as its `cause`, and a parameter can be a
 * key holding a 32-character user id, for which production redaction hashes
 * the whole line. This walks that chain to the driver's reason. Any other
 * error keeps its own message, the specific one, even when it has a cause.
 *
 * drizzle's real prefix is pinned by media-api's orphan sweep test, which runs
 * a failed query (Codex-kk9nv.13).
 */
export function messageForLog(error: unknown): string {
  let reported = error;
  while (
    reported instanceof Error &&
    reported.message.startsWith('Failed query:') &&
    reported.cause instanceof Error
  ) {
    reported = reported.cause;
  }
  return reported instanceof Error ? reported.message : String(reported);
}
