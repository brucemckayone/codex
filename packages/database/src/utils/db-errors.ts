/**
 * Database Error Utilities
 *
 * Type-safe error detection for Postgres/Neon database errors.
 */

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
  if (isPostgresError(error) && error.code === '23505') {
    return true;
  }

  // Check if the error has a cause (Drizzle wraps Postgres errors)
  if (error instanceof Error && 'cause' in error) {
    const cause = (error as { cause: unknown }).cause;
    return isPostgresError(cause) && cause.code === '23505';
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
  if (isPostgresError(error) && error.code === '23503') {
    return true;
  }

  // Check if the error has a cause (Drizzle wraps Postgres errors)
  if (error instanceof Error && 'cause' in error) {
    const cause = (error as { cause: unknown }).cause;
    return isPostgresError(cause) && cause.code === '23503';
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
  if (isPostgresError(error) && error.code === '23502') {
    return true;
  }

  // Check if the error has a cause (Drizzle wraps Postgres errors)
  if (error instanceof Error && 'cause' in error) {
    const cause = (error as { cause: unknown }).cause;
    return isPostgresError(cause) && cause.code === '23502';
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
