import type { FullConfig } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { setupTestMediaFiles } from './helpers/r2-test-setup.js';
import { startAllWorkers } from './helpers/worker-manager.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Global setup runs once before all tests
 * 1. Loads .env.test environment variables
 * 2. Uploads test media files to R2
 * 3. Starts all 4 workers with .env.test environment variables
 */
async function globalSetup(config: FullConfig) {
  console.log('\n🚀 Starting E2E test setup...\n');

  // Load environment variables from .env.test
  const envPath = resolve(__dirname, '../.env.test');
  const result = loadEnv({ path: envPath });
  if (result.error) {
    throw new Error(`Failed to load .env.test: ${result.error.message}`);
  }
  console.log(`✅ Loaded environment from ${envPath}\n`);

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
