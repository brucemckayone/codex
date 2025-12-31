/**
 * @codex/service-errors
 *
 * Shared error classes and utilities for service layers.
 * Provides consistent error handling across all Codex services.
 */

// Base error classes
export {
  BusinessLogicError,
  ConflictError,
  type ErrorStatusCode,
  ForbiddenError,
  InternalServiceError,
  isServiceError,
  NotFoundError,
  ServiceError,
  UnauthorizedError,
  ValidationError,
  wrapError,
} from './base-errors';
// Base service class
export {
  BaseService,
  type ServiceConfig,
} from './base-service';
// Error mapper
export {
  type ErrorMapperOptions,
  type ErrorResponse,
  isKnownError,
  type MappedError,
  mapErrorToResponse,
} from './error-mapper';
