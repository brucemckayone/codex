import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { setupTestMediaFiles } from './helpers/r2-test-setup.js';
import { startAllWorkers } from './helpers/worker-manager.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Required environment variables for E2E tests
 */
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_MEDIA',
];

/**
 * Global setup runs once before all tests
 * 1. Loads environment variables (from GitHub Actions in CI, or .env.test locally)
 * 2. Uploads test media files to R2
 * 3. Starts all 4 workers with test environment variables
 */
async function globalSetup(_config: FullConfig) {
  console.log('\n Starting E2E test setup...\n');

  const isCI = process.env.CI === 'true';

  if (isCI) {
    // In CI, environment variables are injected by GitHub Actions via the `test` environment
    console.log(' CI mode: Using environment variables from GitHub Actions\n');

    // Validate required env vars are present
    const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required CI environment variables: ${missing.join(', ')}\n` +
          'Ensure the GitHub Actions workflow sets these from the test environment.'
      );
    }
  } else {
    // Local development: load from .env.test file
    const envPath = resolve(__dirname, '../.env.test');

    if (!existsSync(envPath)) {
      throw new Error(
        `.env.test not found at ${envPath}\n` +
          'For local development, create .env.test with required variables.\n' +
          'See .env.example for reference.'
      );
    }

    const result = loadEnv({ path: envPath });
    if (result.error) {
      throw new Error(`Failed to load .env.test: ${result.error.message}`);
    }
    console.log(` Loaded environment from ${envPath}\n`);
  }

  try {
    // Upload test media files to R2 (if not already present)
    await setupTestMediaFiles();

    // Start all workers with test environment
    await startAllWorkers();
    console.log('\n✅ All workers started and healthy. Starting tests...\n');
  } catch (error) {
    console.error('\n❌ Failed to start workers:', error);
    throw error;
  }
}

export default globalSetup;
