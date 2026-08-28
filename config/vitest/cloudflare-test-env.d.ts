/**
 * Shared type declarations for Cloudflare Workers test environment
 *
 * This file extends the `cloudflare:test` module to provide type safety
 * for environment bindings that are common across all workers.
 *
 * Worker-specific bindings should be declared in the worker's own
 * `cloudflare:test` module declaration.
 *
 * Usage:
 * Add this to your worker's tsconfig.json:
 * ```json
 * {
 *   "compilerOptions": {
 *     "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
 *   },
 *   "include": ["src", "../../config/vitest/cloudflare-test-env.d.ts"]
 * }
 * ```
 */

declare module 'cloudflare:test' {
  /**
   * Base environment bindings shared across all workers
   */
  interface ProvidedEnv {
    // Environment configuration
    ENVIRONMENT?: 'development' | 'staging' | 'production' | 'test';
    DATABASE_URL?: string;
    DB_METHOD?: 'LOCAL_PROXY' | 'NEON_BRANCH' | 'PRODUCTION';

    // Common KV namespaces (workers can override/extend)
    AUTH_SESSION_KV?: KVNamespace;
    CACHE_KV?: KVNamespace;

    // Rate limiting (Codex-kgrdp.17). RATE_LIMIT_KV is gone: counters moved to
    // Cloudflare's native Workers Rate Limiting bindings, plus RateLimitDO for
    // the `auth` preset, whose 15-minute window the binding cannot express.
    // A worker only declares the ones its wrangler config binds.
    RATE_LIMIT_STRICT?: RateLimit;
    RATE_LIMIT_STREAMING?: RateLimit;
    RATE_LIMIT_API?: RateLimit;
    RATE_LIMIT_WEB?: RateLimit;
    RATE_LIMIT_DO?: DurableObjectNamespace;
  }
}

export {};
