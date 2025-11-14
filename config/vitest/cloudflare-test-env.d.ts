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
    RATE_LIMIT_KV?: KVNamespace;
  }
}

export {};
