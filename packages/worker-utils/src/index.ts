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
// Cache-fanout helpers (R14: cache helpers belong in @codex/cache OR
// @codex/worker-utils — DB-touching ones live here so @codex/cache stays
// thin/standalone). The membership fan-out is shared by organization-api and
// admin-api (Codex-2hxff.44).
export {
  dispatchOrgSlugInvalidation,
  type InvalidateOrgSlugCacheArgs,
  invalidateMemberCaches,
  invalidateMembershipCache,
  invalidateOrgSlugCache,
  type MemberCacheCtx,
} from './cache-fanout';
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
// Live media status (Codex-l2c48.9): reaching media-api's MediaStatusObject.
export {
  DurableObjectMediaStatusFeed,
  deliverMediaStatusEvent,
  MEDIA_STATUS_CONNECT_HEADERS,
  MEDIA_STATUS_INTERNAL_ROUTE,
  MEDIA_STATUS_OBJECT_PATHS,
  MEDIA_STATUS_SHARD_COUNT,
  mediaStatusShardOf,
  statusObjectFor,
  WorkerMediaStatusPublisher,
} from './media-status';
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
  createRequestTrackingMiddleware,
  createSecurityHeadersMiddleware,
  createSecurityHeadersWrapper,
  ERROR_CODES,
  isAllowedOrigin,
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
  type CachedReadContext,
  // Required sink for the org caches' write-through. A direct caller of
  // checkOrganizationMembership / extractOrganizationFromSubdomain needs this
  // type to thread `ctx.cacheWrite` through its own helper signatures.
  type CacheWrite,
  cachedRead,
  // checkOrganizationMembership is re-exported for convenience.
  // Workers that don't use it will tree-shake it out during bundling.
  checkOrganizationMembership,
  createServiceRegistry,
  enforceIPWhitelist,
  enforcePolicyInline,
  type FileFieldConfig,
  type FileSchema,
  // Helper utilities (for advanced use cases)
  generateRequestId,
  getClientIP,
  type InferFiles,
  type InferInput,
  type InputSchema,
  invalidateOrgSlugCacheEntry,
  type MultipartProcedureConfig,
  type MultipartProcedureContext,
  membershipCacheKey,
  multipartProcedure,
  type OrganizationMembership,
  orgSlugCacheKey,
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
// Webhook + cron composition root (Codex-2hxff.54): the same service registry
// procedure() builds, for code that runs outside it.
export {
  createWebhookServices,
  type WebhookServices,
} from './webhook-services';
// Worker factory
export {
  type CORSConfig,
  createWorker,
  type HealthCheckOptions,
  type WorkerConfig,
} from './worker-factory';
