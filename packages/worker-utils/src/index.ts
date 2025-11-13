/**
 * @codex/worker-utils
 *
 * Shared utilities and factories for Cloudflare Workers.
 * Reduces boilerplate and ensures consistency across all API workers.
 */

// Worker factory
export { createWorker, type WorkerConfig } from './worker-factory';

// Middleware factories
export {
  createLoggerMiddleware,
  createCorsMiddleware,
  createSecurityHeadersMiddleware,
  createAuthMiddleware,
  createHealthCheckHandler,
  createNotFoundHandler,
  createErrorHandler,
  createObservabilityMiddleware,
  createObservabilityErrorHandler,
  createSecurityHeadersWrapper,
  createRateLimitWrapper,
  sequence,
  type MiddlewareConfig,
} from './middleware';

// Route handler helpers
export {
  createAuthenticatedHandler,
  createAuthenticatedGetHandler,
  withErrorHandling,
  formatValidationError,
  requireUser,
} from './route-helpers';

// Test utilities (for integration tests only)
export {
  createTestUser,
  cleanupTestUser,
  createAuthenticatedRequest,
  type TestUser,
} from './test-utils';
