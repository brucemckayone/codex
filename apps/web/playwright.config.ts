import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration
 *
 * Test directories are intentionally scoped to avoid loading vitest config:
 * - e2e/ - End-to-end tests against the app
 * - tests/a11y/ - Accessibility tests against Storybook
 * - tests/visual/ - Visual regression tests
 */
export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'html' : 'list',
  use: {
    trace: 'on-first-retry',
  },

  projects: [
    // E2E tests against the main app
    {
      name: 'e2e',
      testDir: './e2e',
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
      },
    },
    // Accessibility tests against Storybook
    {
      name: 'a11y',
      testDir: './tests/a11y',
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:6006',
      },
    },
    // Visual regression tests
    {
      name: 'visual',
      testDir: './tests/visual',
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
      },
    },
  ],

  // Start dev server automatically for local e2e tests
  // In CI, PLAYWRIGHT_BASE_URL is set and this is skipped
  webServer: process.env.CI
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
