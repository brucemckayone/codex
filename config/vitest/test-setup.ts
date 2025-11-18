/**
 * Neon Testing Setup
 *
 * Creates the `withNeonTestBranch` fixture for database integration tests.
 *
 * COST OPTIMIZATION - HYBRID STRATEGY:
 * =====================================
 * - **Local Development**: Uses DATABASE_URL from .env.dev (LOCAL_PROXY method)
 *   - NO ephemeral branch creation (FREE, unlimited test runs)
 *   - Fast execution with no provisioning delay
 *   - Tests share database but cleanup still works
 *
 * - **CI/CD**: Creates ephemeral Neon branches automatically
 *   - Each test file gets its own isolated branch
 *   - Complete isolation from other test files
 *   - Automatic cleanup after tests complete
 *   - Full production schema and constraints
 *
 * The hybrid strategy saves 200+ branch creations per day during local development!
 *
 * Usage in test files:
 * ```typescript
 * import { test } from 'vitest';
 * import { withNeonTestBranch } from '../../config/vitest/test-setup';
 *
 * withNeonTestBranch();
 *
 * test('my database test', async () => {
 *   // Local: Uses DATABASE_URL from .env.dev
 *   // CI: Uses ephemeral branch created automatically
 * });
 * ```
 *
 * Requirements:
 * - Local: DATABASE_URL in .env.dev (LOCAL_PROXY method)
 * - CI: NEON_API_KEY and NEON_PROJECT_ID environment variables
 */

import { makeNeonTesting } from 'neon-testing';
import { WebSocket as NodeWebSocket } from 'ws';

// Polyfill WebSocket for Node.js environment when neon-testing is used in CI
// neon-testing requires WebSocket to connect to Neon databases
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = NodeWebSocket as unknown as typeof WebSocket;
}

/**
 * Create neonTesting fixture (CI only) or no-op (local development)
 *
 * Configuration:
 * - apiKey: Neon API key for creating ephemeral branches
 * - projectId: Neon project ID
 * - autoCloseWebSockets: true - Ensures WebSocket connections are cleaned up
 *
 * **CI Behavior**: Each test file that calls withNeonTestBranch() will:
 * 1. Create a fresh Neon branch before tests run
 * 2. Set DATABASE_URL to the ephemeral branch
 * 3. Run all tests in the file against that branch
 * 4. Delete the branch after tests complete
 *
 * **Local Behavior**: withNeonTestBranch() becomes a no-op
 * 1. No branch creation (FREE)
 * 2. Uses existing DATABASE_URL from .env.dev
 * 3. Tests run against LOCAL_PROXY connection
 */
export function withNeonTestBranch() {
  // Lazy initialization - only create the fixture when actually called
  // This ensures environment variables are loaded by vitest.setup.ts first
  if (process.env.CI === 'true') {
    const fixture = makeNeonTesting({
      apiKey: process.env.NEON_API_KEY!,
      projectId: process.env.NEON_PROJECT_ID!,
      autoCloseWebSockets: true,
    });
    fixture();
  }
  // No-op in local development - use existing DATABASE_URL
}
