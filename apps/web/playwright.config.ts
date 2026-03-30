import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load environment variables for E2E tests
// .env.test is at the monorepo root, not in apps/web
// Use import.meta.url since this is an ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

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
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? 'html' : 'list',
  // Authenticated tests create real users via DB (register→verify→session) which takes
  // 5-25s under parallel load (Neon DB latency). 90s accommodates auth + page load.
  timeout: 90000,
  use: {
    trace: 'on-first-retry',
    // Most assertions need to wait for async operations to settle
    actionTimeout: 15000,
  },

  projects: [
    // E2E tests against the main app
    {
      name: 'e2e',
      testDir: './e2e',
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://lvh.me:5173',
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
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://lvh.me:5173',
      },
    },
  ],

  // Start dev servers automatically for local e2e tests
  // In CI, PLAYWRIGHT_BASE_URL is set and this is skipped
  // We start SvelteKit dev server, Auth Worker, Identity-API Worker, Ecom-API Worker, and Content-API Worker
  webServer: process.env.CI
    ? undefined
    : [
        {
          command: 'pnpm dev --port 5173 --host lvh.me --strictPort',
          url: 'http://lvh.me:5173',
          timeout: 180000, // 3 minutes - SvelteKit can take time to start
          reuseExistingServer: true,
        },
        {
          command:
            'cd ../../workers/auth && npx wrangler dev --env test --port 42069',
          url: 'http://localhost:42069/health', // Use health endpoint for ready detection
          timeout: 90000, // 90 seconds - Workers start faster
          reuseExistingServer: true,
        },
        {
          command:
            'cd ../../workers/identity-api && npx wrangler dev --env test --port 42071',
          url: 'http://localhost:42071/health', // Use health endpoint for ready detection
          timeout: 90000, // 90 seconds - Workers start faster
          reuseExistingServer: true,
        },
        {
          command:
            'cd ../../workers/ecom-api && npx wrangler dev --env test --port 42072',
          url: 'http://localhost:42072/health', // Use health endpoint for ready detection
          timeout: 90000, // 90 seconds - Workers start faster
          reuseExistingServer: true,
        },
        {
          command:
            'cd ../../workers/content-api && npx wrangler dev --env test --port 4001',
          url: 'http://localhost:4001/health', // Use health endpoint for ready detection
          timeout: 90000, // 90 seconds - Workers start faster
          reuseExistingServer: true,
        },
        {
          command:
            'cd ../../workers/organization-api && npx wrangler dev --env test --port 42075',
          url: 'http://localhost:42075/health',
          timeout: 90000,
          reuseExistingServer: true,
        },
        {
          command:
            'cd ../../workers/media-api && npx wrangler dev --env test --port 42076',
          url: 'http://localhost:42076/health',
          timeout: 90000,
          reuseExistingServer: true,
        },
      ],
});
