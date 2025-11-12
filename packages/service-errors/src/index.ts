/**
 * @codex/service-errors
 *
 * Shared error classes and utilities for service layers.
 * Provides consistent error handling across all Codex services.
 */

// Base error classes
export {
  ServiceError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ConflictError,
  BusinessLogicError,
  InternalServiceError,
  isServiceError,
  wrapError,
} from './base-errors';

// Error mapper
export {
  mapErrorToResponse,
  isKnownError,
  type ErrorResponse,
  type MappedError,
  type ErrorMapperOptions,
} from './error-mapper';
