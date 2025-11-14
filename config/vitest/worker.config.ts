import type { UserConfig } from 'vite';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Note: We can't use dotenv here because this config runs in the Workers runtime
// which doesn't support Node.js built-in modules like 'node:os' that dotenv uses.
// Environment variables are loaded via Vitest's built-in env support instead.

/**
 * Standard Vitest configuration for Cloudflare Workers
 *
 * This configuration provides consistent test settings across all workers:
 * - Global test APIs enabled (describe, it, expect)
 * - Workers runtime environment (workerd) for testing
 * - Automatic wrangler.toml binding configuration
 * - Standard test file patterns
 * - Coverage reporting configured
 *
 * Tests run in the actual Cloudflare Workers runtime, not Node.js.
 * Use the `cloudflare:test` module to access env, SELF, etc.
 *
 * Usage:
 * ```typescript
 * // workers/content-api/vitest.config.ts
 * import { workerVitestConfig } from '../../config/vitest/worker.config';
 * export default workerVitestConfig;
 * ```
 *
 * For custom configurations:
 * ```typescript
 * // workers/my-worker/vitest.config.ts
 * import { createWorkerTestConfig } from '../../config/vitest/worker.config';
 *
 * export default createWorkerTestConfig({
 *   test: {
 *     setupFiles: ['./src/test-setup.ts'],
 *   },
 * });
 * ```
 */
export const workerVitestConfig: UserConfig = defineWorkersConfig({
  test: {
    globals: true,
    // Use Workers pool to run tests in workerd runtime (not Node.js)
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '*.config.ts',
        '**/*.d.ts',
        '**/types/**',
      ],
    },
  },
});

/**
 * Create custom worker test config with overrides
 *
 * Allows extending the base worker test configuration with custom settings
 * while maintaining consistency for common options.
 *
 * @param overrides - Partial Vitest configuration to merge with base config
 * @returns Complete Vitest configuration
 */
export function createWorkerTestConfig(overrides: UserConfig = {}): UserConfig {
  return defineWorkersConfig({
    ...workerVitestConfig,
    test: {
      ...workerVitestConfig.test,
      ...overrides.test,
    },
  });
}
