/**
 * @codex/worker-utils
 *
 * Shared utilities and factories for Cloudflare Workers.
 * Reduces boilerplate and ensures consistency across all API workers.
 */

// Authentication middleware
export {
  createSessionMiddleware,
  type SessionMiddlewareOptions,
} from './auth-middleware';
// Body parsing middleware
export { createBodyParsingMiddleware } from './body-parsing-middleware';
// Email sending helper (worker-to-worker)
export {
  type SendEmailToWorkerParams,
  sendEmailToWorker,
} from './email/send-email';
// Environment validation
export {
  createEnvValidationMiddleware,
  type EnvValidationConfig,
} from './env-validation';
// Health check utilities
export {
  type HealthCheckResult,
  standardDatabaseCheck,
} from './health-checks';
// Middleware factories
export {
  createAuthMiddleware,
  createCorsMiddleware,
  createErrorHandler,
  createErrorResponse,
  createHealthCheckHandler,
  createKvCheck,
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
// Middleware chain utilities
export {
  type ApplyMiddlewareChainOptions,
  applyMiddlewareChain,
  createMiddlewareChainBuilder,
  createStandardMiddlewareChain,
  type MiddlewareChainOptions,
} from './middleware-chain';
// Procedure pattern (tRPC-style)
export {
  type AuthLevel,
  type BinaryFileConfig,
  type BinaryUploadContext,
  type BinaryUploadProcedureConfig,
  binaryUploadProcedure,
  // checkOrganizationMembership is re-exported for convenience.
  // Workers that don't use it will tree-shake it out during bundling.
  checkOrganizationMembership,
  createServiceRegistry,
  enforceIPWhitelist,
  enforcePolicyInline,
  type FileFieldConfig,
  type FileSchema,
  type FileTooLargeError,
  // Helper utilities (for advanced use cases)
  generateRequestId,
  getClientIP,
  type InferFiles,
  type InferInput,
  type InputSchema,
  type InvalidFileTypeError,
  type MissingFileError,
  type MultipartProcedureConfig,
  type MultipartProcedureContext,
  membershipCacheKey,
  multipartProcedure,
  type OrganizationMembership,
  PaginatedResult,
  type ProcedureConfig,
  type ProcedureContext,
  type ProcedureHandler,
  type ProcedurePolicy,
  procedure,
  type ServiceRegistry,
  type ServiceRegistryResult,
  type SessionForAuth,
  type UserForAuth,
  type ValidatedBinaryFile,
  type ValidatedFile,
  validateInput,
} from './procedure';
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
} from './types';
// Worker factory
export {
  type CORSConfig,
  createWorker,
  type HealthCheckOptions,
  type WorkerConfig,
} from './worker-factory';
