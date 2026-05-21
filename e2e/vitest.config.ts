import { defineConfig } from 'vitest/config';

/**
 * E2E API Testing Configuration (Vitest)
 * Tests backend worker flows across auth, content, identity, and ecom APIs
 *
 * Parallel Execution Notes:
 * - Tests run in parallel using forked processes (maxForks: 2)
 * - Each test file gets isolated services but shares the connection pool
 * - Test data isolation via randomUUID prefixes (see helpers/test-isolation.ts)
 * - All test files must have afterAll cleanup that calls closeDbPool()
 * - CI uses 2 forks (was 4) — too many parallel forks contend on the auth
 *   worker's DB pool against a single Neon ephemeral branch and produce
 *   transient BetterAuth FAILED_TO_CREATE_USER 500s during parallel user
 *   registration. 2 forks still parallelise meaningfully without the race.
 */
export default defineConfig({
  test: {
    // Test files location
    include: ['tests/**/*.test.ts'],

    // Enable parallel test execution with forked processes
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        // Cap at 2 forks in both CI and local. See module comment above
        // for the auth-worker contention rationale.
        maxForks: 2,
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
