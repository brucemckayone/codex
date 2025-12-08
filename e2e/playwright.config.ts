import { defineConfig } from '@playwright/test';

/**
 * E2E API Testing Configuration
 * Tests backend worker user flows across auth, content, identity, and ecom APIs
 */
export default defineConfig({
  testDir: './tests',

  // Run tests sequentially to avoid race conditions on shared database
  fullyParallel: false,
  workers: 1,

  // Timeouts
  timeout: 60000, // 60 seconds per test
  expect: {
    timeout: 10000, // 10 seconds for assertions
  },

  // Test execution
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  // Reporting
  reporter: process.env.CI
    ? [['html'], ['json', { outputFile: 'test-results.json' }]]
    : 'list',

  // Global setup/teardown
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  use: {
    // Trace for debugging
    trace: 'on-first-retry',

    // API testing defaults
    extraHTTPHeaders: {
      Accept: 'application/json',
    },

    // Increase action timeout for API calls
    actionTimeout: 30000,
  },

  projects: [
    {
      name: 'api-e2e',
      testMatch: /.*\.spec\.ts$/,
    },
  ],
});
