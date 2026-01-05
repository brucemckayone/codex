/**
 * Auth Worker Middleware
 *
 * Centralized exports for all auth worker middleware.
 *
 * Note: Session caching is now handled by Better Auth's secondaryStorage
 * feature using @codex/security's createKVSecondaryStorage adapter.
 */

export { createAuthRateLimiter } from './rate-limiter';
