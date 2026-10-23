/**
 * Webhook Error Classification
 *
 * Classifies errors as transient (Stripe should retry) vs permanent (acknowledge receipt).
 *
 * Conservative default: unknown errors are treated as permanent to prevent retry storms.
 * Only explicitly recognized transient patterns return true.
 *
 * A service never lets a raw error out: BaseService.handleError wraps it as an
 * InternalServiceError and keeps the original on `cause`. So an error is judged
 * by its cause chain, not its outer class — otherwise a database outage inside
 * completePurchase looks like business logic and is acknowledged 200, and the
 * buyer is charged with no purchase (Codex-2hxff.6).
 *
 * Transient errors return 500 → Stripe retries with exponential backoff (~24h total).
 * Permanent errors return 200 → Stripe considers the webhook delivered.
 */

import { ServiceError, ServiceUnavailableError } from '@codex/service-errors';

/**
 * Stripe error type strings (from stripe-node SDK). Authentication and
 * permission errors are a key or account misconfiguration, not bad data: a
 * retry succeeds once it is fixed, so Stripe should keep redelivering.
 */
const TRANSIENT_STRIPE_TYPES = new Set([
  'StripeAPIError',
  'StripeAuthenticationError',
  'StripeConnectionError',
  'StripePermissionError',
  'StripeRateLimitError',
]);

/**
 * Postgres SQLSTATEs a retry can clear: a serialization failure, a deadlock,
 * too many connections, the server shutting down or not accepting connections
 * yet, a cancelled (timed-out) statement — plus all of class 08, connection
 * exceptions. Their messages ("could not serialize access…") match none of
 * the patterns below.
 */
const TRANSIENT_SQLSTATES = new Set([
  '40001',
  '40P01',
  '53300',
  '57P01',
  '57P02',
  '57P03',
  '57014',
]);

/**
 * A five-character SQLSTATE: what Postgres puts on `code`. No SQLSTATE class
 * starts with E, so a five-letter socket code (EPIPE, EBUSY) never matches.
 */
const SQLSTATE = /^[0-9A-DF-Z][0-9A-Z]{4}$/;

/** Socket-level error codes, as Node and the Neon driver set them */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
]);

/** How far down a cause chain to look (and the guard against a cycle). */
const MAX_CAUSE_DEPTH = 5;

/**
 * drizzle's wrapper for a failed query: a plain Error whose message is
 * `Failed query: <sql>\nparams: <params>`, with the driver's error on
 * `cause`. drizzle-orm 0.44's DrizzleQueryError sets no `name`, so a real one
 * is named 'Error' and only its shape tells (Codex-56l13). This is the rule
 * `isFailedQuery` in @codex/database applies; it is not imported, so a test
 * that mocks @codex/database cannot break the classifier every webhook uses.
 */
function isFailedQuery(error: Error): boolean {
  return (
    typeof error.message === 'string' &&
    error.message.startsWith('Failed query:')
  );
}

/** Network/DB error message patterns indicating transient failures */
const TRANSIENT_MESSAGE_PATTERNS = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'connection',
  'timeout',
  'socket hang up',
  'fetch failed',
] as const;

/**
 * Determine if an error is transient (should trigger Stripe retry).
 *
 * Returns true for: DB connection failures, retryable Postgres states,
 * Stripe server errors (5xx), Stripe rate limits, and network errors — at the
 * top level or anywhere in the error's `cause` chain.
 *
 * Returns false for: business logic errors (a ServiceError with no cause),
 * Stripe client errors (4xx), and anything unrecognized.
 */
export function isTransientError(error: unknown): boolean {
  return isTransientAt(error, 0);
}

function isTransientAt(error: unknown, depth: number): boolean {
  if (depth > MAX_CAUSE_DEPTH) {
    return false;
  }

  // A ServiceError a service threw on purpose (NotFound, Validation, …) has no
  // cause and is permanent. One that WRAPS another error is as transient as
  // what it wraps.
  // A service saying "not yet": the work will succeed on a retry.
  if (error instanceof ServiceUnavailableError) return true;

  if (error instanceof ServiceError) {
    return error.cause !== undefined && isTransientAt(error.cause, depth + 1);
  }

  // Several failures reported together (the clawback's rows it could not
  // cancel, Codex-2hxff.51) are worth a retry when any one of them is: the
  // retry is idempotent, and a row left behind can be paid out on a refunded
  // charge.
  if (error instanceof AggregateError) {
    return error.errors.some((inner) => isTransientAt(inner, depth + 1));
  }

  if (error instanceof Error) {
    // Check for Stripe SDK error types
    const stripeType = (error as { type?: string }).type;
    if (stripeType && TRANSIENT_STRIPE_TYPES.has(stripeType)) {
      // StripeAPIError is only transient for 5xx status codes
      if (stripeType === 'StripeAPIError') {
        const statusCode = (error as { statusCode?: number }).statusCode;
        return statusCode !== undefined && statusCode >= 500;
      }
      return true;
    }

    // Postgres SQLSTATE or socket error code. A SQLSTATE is the database's
    // own verdict: anything not listed is permanent, whatever the message
    // says (a constraint's or column's name can read "timeout").
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      if (
        TRANSIENT_SQLSTATES.has(code) ||
        (code.length === 5 && code.startsWith('08')) ||
        TRANSIENT_NETWORK_CODES.has(code)
      ) {
        return true;
      }
      if (SQLSTATE.test(code)) return false;
    }

    // Drizzle's DrizzleQueryError has no code of its own; its message is the
    // SQL and every bound value — user data, not a verdict. Judge it by the
    // driver error it wraps.
    const inner =
      error.cause ?? (error as { sourceError?: unknown }).sourceError;
    if (isFailedQuery(error)) {
      return inner !== undefined && isTransientAt(inner, depth + 1);
    }

    // Check message for network/DB transient patterns
    const msg = error.message.toLowerCase();
    for (const pattern of TRANSIENT_MESSAGE_PATTERNS) {
      if (msg.includes(pattern.toLowerCase())) {
        return true;
      }
    }

    // A driver can keep the socket error underneath its own: `fetch failed`
    // carries `cause.code = 'ECONNRESET'`, and Neon's NeonDbError keeps
    // `sourceError`.
    if (inner !== undefined) {
      return isTransientAt(inner, depth + 1);
    }
  }

  // Conservative default: unknown errors are permanent
  return false;
}

/**
 * The innermost error under `error`, for a log line: its name, its message,
 * and the deepest string `code` on the way down (a SQLSTATE or socket code).
 * Follows the same chain isTransientError reads. A DrizzleQueryError's own
 * message — the SQL and its bound values — is never returned: it is never
 * the innermost error, because it always wraps the driver's.
 */
export function describeRootCause(
  error: unknown
): { name: string; message: string; code: string | undefined } | undefined {
  let current: unknown = error;
  let code: string | undefined;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) break;
    // The deepest code wins: a ServiceError's own ('INTERNAL_ERROR') is the
    // wrapper's, the driver's SQLSTATE is the answer.
    const ownCode = (current as { code?: unknown }).code;
    if (typeof ownCode === 'string') code = ownCode;
    const inner =
      current.cause ?? (current as { sourceError?: unknown }).sourceError;
    if (!(inner instanceof Error)) {
      if (current === error) return undefined;
      if (isFailedQuery(current)) {
        return { name: 'DrizzleQueryError', message: '(query omitted)', code };
      }
      return { name: current.name, message: current.message, code };
    }
    current = inner;
  }
  return undefined;
}
