/**
 * @codex/worker-utils
 *
 * Shared utilities and factories for Cloudflare Workers.
 * Reduces boilerplate and ensures consistency across all API workers.
 */

// Middleware factories
export {
  createAuthMiddleware,
  createCorsMiddleware,
  createErrorHandler,
  createErrorResponse,
  createHealthCheckHandler,
  createKvCheck,
  createLoggerMiddleware,
  createNotFoundHandler,
  createObservabilityErrorHandler,
  createObservabilityMiddleware,
  createR2Check,
  createRateLimitWrapper,
  createRequestTrackingMiddleware,
  createSecurityHeadersMiddleware,
  createSecurityHeadersWrapper,
  ERROR_CODES,
  type MiddlewareConfig,
  sequence,
} from './middleware';
// Route handler helpers
export {
  createAuthenticatedHandler,
  formatValidationError,
  withErrorHandling,
} from './route-helpers';
// Security policy
export {
  DEFAULT_SECURITY_POLICY,
  POLICY_PRESETS,
  type RouteSecurityPolicy,
  withPolicy,
} from './security-policy';
// Test utilities (for integration tests only)
export {
  cleanupTestUser,
  createAuthenticatedRequest,
  createTestUser,
  type TestUser,
} from './test-utils';
// Shared types
export type {
  ErrorResponse,
  HealthCheckResponse,
  SuccessResponse,
} from './types';
// Worker factory
export {
  type CORSConfig,
  createWorker,
  type HealthCheckOptions,
  type WorkerConfig,
} from './worker-factory';
