/**
 * @codex/security
 *
 * Shared security utilities for Cloudflare Workers
 * - Security headers middleware
 * - Rate limiting (KV-based)
 * - Worker-to-worker authentication
 */

export {
  securityHeaders,
  CSP_PRESETS,
  type SecurityHeadersOptions,
  type CSPDirectives,
} from './headers';

export {
  rateLimit,
  RATE_LIMIT_PRESETS,
  type RateLimitOptions,
} from './rate-limit';

export {
  workerAuth,
  generateWorkerSignature,
  workerFetch,
  type WorkerAuthOptions,
} from './worker-auth';
