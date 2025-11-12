/**
 * Error to HTTP Response Mapper
 *
 * Converts identity service errors to standardized HTTP responses.
 * This utility is designed to be used by any worker/API that uses identity services.
 */

import { ZodError } from 'zod';
import { isIdentityServiceError, IdentityServiceError } from '../errors';

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
  statusCode: number;
  response: ErrorResponse;
}

/**
 * Maps any error to a standardized HTTP error response
 *
 * @param error - The error to map (can be IdentityServiceError, ZodError, or unknown)
 * @param options - Optional configuration
 * @param options.includeStack - Whether to include stack trace in development (default: false)
 * @param options.logError - Whether to log internal errors (default: true)
 * @returns Mapped error with statusCode and response body
 *
 * @example
 * ```typescript
 * try {
 *   await organizationService.create(input);
 * } catch (err) {
 *   const { statusCode, response } = mapErrorToResponse(err);
 *   return c.json(response, statusCode);
 * }
 * ```
 */
export function mapErrorToResponse(
  error: unknown,
  options?: {
    includeStack?: boolean;
    logError?: boolean;
  }
): MappedError {
  const { includeStack = false, logError = true } = options || {};

  // Handle IdentityServiceError (already has statusCode and code)
  if (isIdentityServiceError(error)) {
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

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      response: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors.map((err) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        },
      },
    };
  }

  // Handle unknown errors (500)
  if (logError) {
    console.error('Unhandled error:', error);
  }

  const response: ErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
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
    statusCode: 500,
    response,
  };
}

/**
 * Type guard to check if an error is a known application error
 * (either IdentityServiceError or ZodError)
 */
export function isKnownError(error: unknown): boolean {
  return isIdentityServiceError(error) || error instanceof ZodError;
}
