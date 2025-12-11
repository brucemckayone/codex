import { stopAllWorkers } from './helpers/worker-manager.js';

/**
 * Global teardown runs once after all tests
 * Stops all workers that were started by global-setup
 */
async function globalTeardown() {
  console.log('\n🧹 Cleaning up E2E test environment...\n');

  try {
    await stopAllWorkers();
    console.log('\n✅ E2E tests completed and workers stopped\n');
  } catch (error) {
    console.error('\n❌ Failed to stop workers:', error);
    // Don't throw - allow test process to complete
  }
}

export default globalTeardown;
