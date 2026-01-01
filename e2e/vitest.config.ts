import { defineConfig } from 'vitest/config';

/**
 * E2E API Testing Configuration (Vitest)
 * Tests backend worker flows across auth, content, identity, and ecom APIs
 */
export default defineConfig({
  test: {
    // Test files location
    include: ['tests/**/*.test.ts'],

    // Run tests sequentially to avoid race conditions on shared database
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // Timeouts
    testTimeout: 60000 * 5, // 5 minutes per test
    hookTimeout: 60000 * 5, // 5 minutes for setup/teardown hooks

    // Global setup/teardown
    globalSetup: './setup.ts',

    // Environment
    env: {
      NODE_ENV: 'test',
    },

    // Reporter
    reporters: process.env.CI ? ['default', 'json'] : ['default'],
    outputFile: process.env.CI ? 'test-results.json' : undefined,

    // No retries locally, 2 in CI
    retry: process.env.CI ? 2 : 0,

    // Bail on first failure in CI
    bail: process.env.CI ? 1 : 0,
  },
});
