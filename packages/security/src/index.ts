/**
 * @codex/security
 *
 * Shared security utilities for Cloudflare Workers
 * - Security headers middleware
 * - Rate limiting (KV-based)
 * - Worker-to-worker authentication
 * - User session authentication
 */

export {
  CSP_PRESETS,
  type CSPDirectives,
  type SecurityHeadersOptions,
  securityHeaders,
} from './headers';
export {
  createKVSecondaryStorage,
  type SecondaryStorage,
} from './kv-secondary-storage';
export { requirePlatformOwner } from './platform-owner-auth';
export {
  RATE_LIMIT_PRESETS,
  type RateLimitOptions,
  rateLimit,
} from './rate-limit';
export {
  type CachedSessionData,
  optionalAuth,
  requireAuth,
  type SessionAuthConfig,
  type SessionData,
  type UserData,
} from './session-auth';
export {
  generateWorkerSignature,
  type WorkerAuthOptions,
  workerAuth,
  workerFetch,
} from './worker-auth';
