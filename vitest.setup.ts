/**
 * Global Vitest Setup
 *
 * Loads environment variables once for all tests across the monorepo.
 * This runs before any test files are executed.
 *
 * Environment Variable Loading Priority:
 * 1. Existing process.env (highest priority - allows CI/CD override)
 * 2. .env.dev file (local development)
 * 3. Defaults (fallback)
 *
 * Used by:
 * - Root Vitest 4.x tests (packages, apps)
 * - Worker Vitest 3.2.x tests (via process.env inheritance)
 */

import { resolve } from 'node:path';
import { config } from 'dotenv';

// Load environment variables for tests
// - CI: Variables are set in GitHub Actions workflow
// - Local: Load from .env.test (test-specific config with test buckets)
if (!process.env.CI) {
  config({ path: resolve(__dirname, '.env.test') });
}

// Ensure DB_METHOD is set for tests (default to LOCAL_PROXY for local dev)
if (!process.env.DB_METHOD) {
  process.env.DB_METHOD = 'LOCAL_PROXY';
}

// Ensure NODE_ENV is set for tests
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

// Log environment for debugging (only in verbose mode)
if (process.env.VITEST_VERBOSE) {
  console.log('[vitest.setup] Environment loaded:');
  console.log(`  DB_METHOD: ${process.env.DB_METHOD}`);
  console.log(
    `  DATABASE_URL: ${process.env.DATABASE_URL ? '***' : 'not set'}`
  );
  console.log(`  NODE_ENV: ${process.env.NODE_ENV}`);
}
