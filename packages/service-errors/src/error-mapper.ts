/**
 * Error to HTTP Response Mapper
 *
 * Converts service errors to standardized HTTP responses.
 * Generic implementation that works with any ServiceError subclass.
 */

import { ERROR_CODES, STATUS_CODES } from '@codex/constants';
import { ObservabilityClient } from '@codex/observability';

// Strict redaction whatever the environment: a caller with no request obs
// gets this client, and it logs withheld 5xx context (Codex-adcgb).
const fallbackObs = new ObservabilityClient('error-mapper', 'development', {
  mode: 'hash',
  redactEmails: true,
});

import { ZodError } from 'zod';
import { type ErrorStatusCode, isServiceError } from './base-errors';

/**
 * Standard HTTP error response structure
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Result of error mapping with status code and response body
 */
export interface MappedError {
  statusCode: ErrorStatusCode;
  response: ErrorResponse;
}

/**
 * Options for error mapping
 */
export interface ErrorMapperOptions {
  /**
   * Whether to include stack trace in development
   * @default false
   */
  includeStack?: boolean;

  /**
   * Whether to log unknown (500) errors, and the context a 5xx ServiceError
   * withholds from the response.
   * If `obs` is provided, logs via `ObservabilityClient`; otherwise logs to console.
   * @default true
   */
  logError?: boolean;

  /**
   * Optional observability client for structured logging.
   * When provided and `logError` is true, unknown errors and withheld 5xx
   * context are logged via this client.
   */
  obs?: ObservabilityClient;
}

/**
 * Maps any error to a standardized HTTP error response
 *
 * Handles:
 * - ServiceError instances (custom errors with status codes). A 4xx sends its
 *   context as `details`; a 5xx sends none unless it set `publicContext`
 * - ZodError instances (validation errors)
 * - Unknown errors (wrapped as 500 internal errors)
 *
 * @param error - The error to map
 * @param options - Optional configuration
 * @returns Mapped error with statusCode and response body
 *
 * @example
 * ```typescript
 * try {
 *   await service.create(input);
 * } catch (err) {
 *   const { statusCode, response } = mapErrorToResponse(err);
 *   return c.json(response, statusCode);
 * }
 * ```
 */
export function mapErrorToResponse(
  error: unknown,
  options?: ErrorMapperOptions
): MappedError {
  const { includeStack = false, logError = true, obs } = options || {};

  // Handle ServiceError (already has statusCode and code)
  if (isServiceError(error)) {
    // A 4xx's context is the client's (validation issues, conflict ids). A
    // 5xx's names internals (Codex-adcgb), so it is withheld unless the error
    // opted in, and logged, since nothing else logs a ServiceError here.
    if (error.statusCode < 500 || error.publicContext) {
      return {
        statusCode: error.statusCode,
        response: {
          error: {
            code: error.code,
            message: error.message,
            details: error.context,
          },
        },
      };
    }
    if (logError && error.context) {
      const client = obs ?? fallbackObs;
      const line = {
        source: 'mapErrorToResponse',
        errorName: error.name,
        code: error.code,
        statusCode: error.statusCode,
        // Most 500s share INTERNAL_ERROR: the message tells them apart, and
        // the client already has it.
        message: error.message,
        context: error.context,
        ...(error.cause instanceof Error && {
          cause: `${error.cause.name}: ${error.cause.message}`,
        }),
      };
      // A 503 is a "try again" its throw site expects; a 500 is a fault.
      if (error.statusCode === 503) {
        client.warn('Server error context withheld from response', line);
      } else {
        client.error('Server error context withheld from response', line);
      }
    }
    return {
      statusCode: error.statusCode,
      response: { error: { code: error.code, message: error.message } },
    };
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return {
      statusCode: STATUS_CODES.UNPROCESSABLE_ENTITY as ErrorStatusCode,
      response: {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid request data',
          details: error.issues.map((err) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        },
      },
    };
  }

  // Handle unknown errors (500)
  if (logError) {
    if (obs) {
      if (error instanceof Error) {
        obs.trackError(error, { source: 'mapErrorToResponse' });
      } else {
        const thrownValue =
          typeof error === 'string'
            ? error
            : (() => {
                try {
                  const json = JSON.stringify(error);
                  return json ?? String(error);
                } catch {
                  return String(error);
                }
              })();

        obs.error('Unhandled non-Error thrown', {
          source: 'mapErrorToResponse',
          thrownType: typeof error,
          thrownValue,
        });
      }
    } else {
      fallbackObs.error('Unhandled error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const response: ErrorResponse = {
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
    },
  };

  // Include stack in development if requested
  if (includeStack && error instanceof Error) {
    response.error.details = {
      stack: error.stack,
      message: error.message,
    };
  }

  return {
    statusCode: STATUS_CODES.INTERNAL_ERROR as ErrorStatusCode,
    response,
  };
}

/**
 * Type guard to check if an error is a known application error
 * (either ServiceError or ZodError)
 */
export function isKnownError(error: unknown): boolean {
  return isServiceError(error) || error instanceof ZodError;
}
