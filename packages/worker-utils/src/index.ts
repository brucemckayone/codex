/**
 * @codex/worker-utils
 *
 * Shared utilities and factories for Cloudflare Workers.
 * Reduces boilerplate and ensures consistency across all API workers.
 */

// Worker factory
export {
  createWorker,
  type WorkerConfig,
  type CORSConfig,
} from './worker-factory';

// Middleware factories
export {
  createLoggerMiddleware,
  createCorsMiddleware,
  createSecurityHeadersMiddleware,
  createAuthMiddleware,
  createRequestTrackingMiddleware,
  createHealthCheckHandler,
  createNotFoundHandler,
  createErrorHandler,
  createErrorResponse,
  createObservabilityMiddleware,
  createObservabilityErrorHandler,
  createSecurityHeadersWrapper,
  createRateLimitWrapper,
  sequence,
  ERROR_CODES,
  type MiddlewareConfig,
} from './middleware';

// Route handler helpers
export {
  createAuthenticatedHandler,
  createAuthenticatedGetHandler, // Deprecated: alias to createAuthenticatedHandler
  withErrorHandling,
  formatValidationError,
} from './route-helpers';

// Security policy
export {
  withPolicy,
  type RouteSecurityPolicy,
  POLICY_PRESETS,
  DEFAULT_SECURITY_POLICY,
} from './security-policy';

// Test utilities (for integration tests only)
export {
  createTestUser,
  cleanupTestUser,
  createAuthenticatedRequest,
  type TestUser,
} from './test-utils';

// Shared types
export type {
  HealthCheckResponse,
  ErrorResponse,
  SuccessResponse,
} from './types';
