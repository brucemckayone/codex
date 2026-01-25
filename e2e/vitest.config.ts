import { defineConfig } from 'vitest/config';

/**
 * E2E API Testing Configuration (Vitest)
 * Tests backend worker flows across auth, content, identity, and ecom APIs
 *
 * Parallel Execution Notes:
 * - Tests run in parallel using forked processes (maxForks: 4 in CI)
 * - Each test file gets isolated services but shares the connection pool
 * - Test data isolation via randomUUID prefixes (see helpers/test-isolation.ts)
 * - All test files must have afterAll cleanup that calls closeDbPool()
 */
export default defineConfig({
  test: {
    // Test files location
    include: ['tests/**/*.test.ts'],

    // Enable parallel test execution with forked processes
    pool: 'forks',
    poolOptions: {
      forks: {
        // Enable parallel execution (was singleFork: true)
        singleFork: false,
        // Limit concurrent forks to avoid connection pool exhaustion
        // CI gets more forks for faster execution
        maxForks: process.env.CI ? 4 : 2,
      },
    },

    // Isolate each test file (ensures clean state per file)
    isolate: true,

    // Timeouts
    testTimeout: 60000 * 5, // 5 minutes per test
    hookTimeout: 60000 * 5, // 5 minutes for setup/teardown hooks

    // Global setup/teardown
    globalSetup: './setup.ts',

    // Setup files (run before each test file)
    setupFiles: ['./vitest.setup.ts'],

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
