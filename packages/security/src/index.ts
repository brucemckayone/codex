/**
 * @codex/security
 *
 * Shared security utilities for Cloudflare Workers
 * - Security headers middleware
 * - Rate limiting (native binding + SQLite Durable Object)
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
export {
  combineSubjects,
  credentialSubject,
  isCloudflareEgressIp,
  presentedSessionSubject,
  RATE_LIMIT_PRESETS,
  type RateLimitOptions,
  type RateLimitPresetName,
  type RateLimitSubject,
  type RateLimitSubjectKind,
  type RateLimitSubjectResolver,
  rateLimit,
  sessionSubject,
  trustedClientIp,
  trustedIpSubject,
} from './rate-limit';
export {
  limitViaDurableObject,
  type RateLimitDecision,
  RateLimitDO,
  type RateLimitNamespace,
  type RateLimitStub,
  type RateLimitStubResponse,
  type RateLimitWindow,
  rateLimitShardName,
} from './rate-limit-do';
export {
  type CachedSessionData,
  optionalAuth,
  requireAuth,
  type SessionAuthConfig,
  type SessionAuthRow,
  type UserAuthRow,
} from './session-auth';
export { extractSessionCookie } from './session-cookie';
export {
  generateWorkerSignature,
  type WorkerAuthOptions,
  workerAuth,
  workerFetch,
} from './worker-auth';
