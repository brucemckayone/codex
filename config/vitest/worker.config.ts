import { defineConfig, UserConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from root .env.dev
loadDotenv({ path: resolve(__dirname, '../../.env.dev') });

/**
 * Standard Vitest configuration for Cloudflare Workers
 *
 * This configuration provides consistent test settings across all workers:
 * - Global test APIs enabled (describe, it, expect)
 * - Node environment for testing
 * - Standard test file patterns
 * - Coverage reporting configured
 * - Environment variables loaded from .env.dev
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
export const workerVitestConfig: UserConfig = defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
  return defineConfig({
    ...workerVitestConfig,
    test: {
      ...workerVitestConfig.test,
      ...overrides.test,
    },
  });
}
