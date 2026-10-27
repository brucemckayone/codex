/**
 * Base Service Error Classes
 *
 * Shared error classes for all service layers in the Codex platform.
 * These provide consistent error handling with HTTP status codes and context.
 */

// V8-specific Error extension (Node.js, Cloudflare Workers)
interface ErrorConstructorWithStackTrace {
  // biome-ignore lint/complexity/noBannedTypes: Error.captureStackTrace API requires Function type
  captureStackTrace?(targetObject: object, constructorOpt?: Function): void;
}

/**
 * Valid HTTP error status codes for API responses
 */
export type ErrorStatusCode =
  | 400
  | 401
  | 402
  | 403
  | 404
  | 409
  | 412
  | 422
  | 429
  | 500
  | 503;

/**
 * Base error class for all service errors
 * Provides consistent structure and context tracking
 *
 * @example
 * ```typescript
 * class MyServiceError extends ServiceError {
 *   constructor(message: string, context?: Record<string, unknown>) {
 *     super(message, 'MY_ERROR_CODE', 400, context);
 *   }
 * }
 * ```
 */
export abstract class ServiceError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;
  public readonly statusCode: ErrorStatusCode;

  /**
   * `options.cause` keeps the error this one replaced. It is never part of an
   * API response (`mapErrorToResponse` sends only code, message and
   * `context`), so it may hold anything, but it lets a caller judge the
   * failure by what actually went wrong: a webhook must answer 500 for a
   * database outage that a service wrapped (Codex-2hxff.6).
   */
  constructor(
    message: string,
    code: string,
    statusCode: ErrorStatusCode,
    context?: Record<string, unknown>,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;

    // captureStackTrace is V8-specific (Node.js, Cloudflare Workers)
    // Gracefully handle its absence in other runtimes
    const ErrorWithStackTrace = Error as ErrorConstructorWithStackTrace;
    if (typeof ErrorWithStackTrace.captureStackTrace === 'function') {
      ErrorWithStackTrace.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Authentication error (401)
 * Thrown when user is not authenticated or session is invalid
 */
export class UnauthorizedError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'UNAUTHORIZED', 401, context);
  }
}

/**
 * Resource not found error (404)
 * Thrown when querying for a resource that doesn't exist
 */
export class NotFoundError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NOT_FOUND', 404, context);
  }
}

/**
 * Validation error (400)
 * Thrown when input validation fails
 */
export class ValidationError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, context);
  }
}

/**
 * Authorization error (403)
 * Thrown when user doesn't have permission to perform action
 */
export class ForbiddenError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'FORBIDDEN', 403, context);
  }
}

/**
 * Conflict error (409)
 * Thrown when operation conflicts with existing state (e.g., duplicate slug)
 */
export class ConflictError extends ServiceError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    options?: ErrorOptions
  ) {
    super(message, 'CONFLICT', 409, context, options);
  }
}

/**
 * Precondition failed error (412)
 * Thrown when a write names the revision it was made from and the stored row
 * has moved on since (optimistic concurrency): the caller's copy is out of
 * date. Distinct from {@link ConflictError}, which a write can also meet (a
 * slug in use), because the caller must tell them apart by status alone: one
 * is fixed by changing the input, the other by reloading.
 */
export class PreconditionFailedError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'PRECONDITION_FAILED', 412, context);
  }
}

/**
 * Rate limit exceeded error (429)
 * Thrown when the rate-limit preset declared by a route's policy is exhausted.
 *
 * Lives here rather than at the enforcement site so `procedure()` can map it
 * through the normal envelope: `mapErrorToResponse()` forwards `statusCode`
 * untouched, and `context.retryAfter` reaches the client as
 * `details.retryAfter` alongside the `Retry-After` header.
 */
export class RateLimitExceededError extends ServiceError {
  constructor(retryAfterSeconds: number, context?: Record<string, unknown>) {
    super(
      `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`,
      'RATE_LIMIT_EXCEEDED',
      429,
      { retryAfter: retryAfterSeconds, ...context }
    );
  }
}

/**
 * Business logic error (422)
 * Thrown when operation violates business rules
 */
export class BusinessLogicError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BUSINESS_LOGIC_ERROR', 422, context);
  }
}

/**
 * Internal service error (500)
 * Thrown when unexpected errors occur
 * Should be logged and wrapped to prevent detail exposure
 */
export class InternalServiceError extends ServiceError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    options?: ErrorOptions
  ) {
    super(message, 'INTERNAL_ERROR', 500, context, options);
  }
}

/**
 * A step after an operation's commit failed (500). The commit stands, so
 * `completed` is what the operation returns when everything succeeds: a
 * caller can still run what follows from the commit alone, then handle the
 * failure. The failure is the `cause`, which says whether a retry can fix it
 * (Codex-2hxff.67).
 */
export class AfterCommitError<T = unknown> extends InternalServiceError {
  readonly completed: T;

  constructor(message: string, completed: T, cause: unknown) {
    super(message, undefined, { cause });
    this.completed = completed;
  }
}

/**
 * Service unavailable (503)
 * Thrown on purpose when the work could not be done YET and a retry will
 * succeed: another worker holds the row, say. Unlike a ServiceError thrown on
 * purpose, it is transient, so a Stripe webhook gets a 500 and redelivers
 * (Codex-2hxff.8).
 */
export class ServiceUnavailableError extends ServiceError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    options?: ErrorOptions
  ) {
    super(message, 'SERVICE_UNAVAILABLE', 503, context, options);
  }
}

/**
 * Unsupported currency error (400)
 * Thrown when a charge/payout is in a currency the platform does not yet support.
 * Currently the platform is GBP-only — cross-currency support is a tracked future
 * feature. Surfacing this explicitly prevents silent currency mismatch against
 * downstream providers (e.g. Stripe transfers).
 */
export class UnsupportedCurrencyError extends ServiceError {
  public readonly received: string;
  public readonly supported: readonly string[];

  constructor(
    received: string,
    supported: readonly string[],
    context?: Record<string, unknown>
  ) {
    super(
      `Unsupported currency '${received}'. Currently supports: ${supported.join(', ')}`,
      'UNSUPPORTED_CURRENCY',
      400,
      context
    );
    this.received = received;
    this.supported = supported;
  }
}

/**
 * Stripe is not configured on this worker (500)
 *
 * Thrown when a Stripe-backed service is asked to make a real Stripe call but
 * the worker has no `STRIPE_SECRET_KEY` binding. This is an OPERATOR
 * misconfiguration — a deploy that never provisioned the secret — not a client
 * error, so the status stays an honest 500. What changes is the `code`.
 *
 * Codex-1g5lh.1: `organization-api-production` was deployed without
 * `STRIPE_SECRET_KEY` (the deploy workflow uploaded it to ecom-api only), so
 * `POST /api/organizations/:id/tiers` reached
 * `stripe.products.create` and the service registry threw a PLAIN `Error`.
 * `mapErrorToResponse` masks any non-`ServiceError` as
 * `500 INTERNAL_ERROR / "An unexpected error occurred"`, which is
 * indistinguishable from a DB fault, a Stripe outage or a genuine bug — the
 * owner saw a bare 500 with nothing to act on. A typed error with a stable code
 * makes the next occurrence triageable straight off the wire.
 *
 * Deliberately says nothing about WHICH binding is missing: `mapErrorToResponse`
 * forwards a `ServiceError`'s `message` AND its `context` to the client
 * verbatim, so both must stay free of configuration and secret material. The
 * `STRIPE_NOT_CONFIGURED` code is the operator's pointer; the remediation lives
 * in each worker's `wrangler.jsonc` secret block.
 *
 * Distinct from `ConnectPlatformNotConfiguredError` (@codex/subscription), which
 * means the platform's Stripe account exists but has not been enabled for
 * Connect. Different cause, different fix — hence a separate code rather than
 * reusing that one.
 */
export class StripeNotConfiguredError extends ServiceError {
  constructor(context?: Record<string, unknown>) {
    super(
      'Payment processing is not available right now. Please try again later or contact support.',
      'STRIPE_NOT_CONFIGURED',
      500,
      context
    );
  }
}

/**
 * Type guard to check if error is a ServiceError
 */
export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

/**
 * Wrap unknown errors to prevent internal detail exposure
 *
 * @param error - The error to wrap
 * @param context - Additional context to include
 * @returns ServiceError instance
 *
 * @example
 * ```typescript
 * try {
 *   await database.query(...)
 * } catch (error) {
 *   throw wrapError(error, { operation: 'database query' });
 * }
 * ```
 */
export function wrapError(
  error: unknown,
  context?: Record<string, unknown>
): ServiceError {
  if (isServiceError(error)) {
    return error;
  }

  // Database unique constraint violation
  if (error instanceof Error && error.message.includes('unique constraint')) {
    return new ConflictError('Resource already exists', context, {
      cause: error,
    });
  }

  // Generic fallback - never expose internal details. The original stays on
  // `cause` (never serialised) so a caller can still tell an outage from a bug.
  return new InternalServiceError('An unexpected error occurred', context, {
    cause: error,
  });
}
