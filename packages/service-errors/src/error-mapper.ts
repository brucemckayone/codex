/**
 * Error to HTTP Response Mapper
 *
 * Converts service errors to standardized HTTP responses.
 * Generic implementation that works with any ServiceError subclass.
 */

import { ZodError } from 'zod';
import { isServiceError, type ErrorStatusCode } from './base-errors';

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
   * Whether to log internal errors to console
   * @default true
   */
  logError?: boolean;
}

/**
 * Maps any error to a standardized HTTP error response
 *
 * Handles:
 * - ServiceError instances (custom errors with status codes)
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
  const { includeStack = false, logError = true } = options || {};

  // Handle ServiceError (already has statusCode and code)
  if (isServiceError(error)) {
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
      statusCode: 422,
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
 * (either ServiceError or ZodError)
 */
export function isKnownError(error: unknown): boolean {
  return isServiceError(error) || error instanceof ZodError;
}
