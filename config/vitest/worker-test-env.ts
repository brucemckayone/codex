import { beforeAll, afterAll, beforeEach } from 'vitest';
import { Miniflare } from 'miniflare';
import { setupTestDatabase, cleanupDatabase } from '@codex/test-utils/database';
import { DbEnvConfig } from '@codex/database';
import { config as loadDotenv } from 'dotenv';
import path from 'path';

// Load environment variables from root .env.dev
loadDotenv({ path: path.resolve(__dirname, '../../.env.dev') });

// Define a global type for the Cloudflare Worker environment
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface Global {
      __TEST_MINIFLARE__: Miniflare;
      __TEST_DB__: ReturnType<typeof setupTestDatabase>;
      // Add other global mocks if needed
    }
  }
}

// Setup Miniflare for basic environment mocking
let mf: Miniflare;

beforeAll(async () => {
  const projectName = process.env.VITEST_PROJECT_NAME;
  if (!projectName) {
    throw new Error(
      'VITEST_PROJECT_NAME is not defined. Miniflare setup requires project name.'
    );
  }

  // Infer worker directory from project name
  // Assuming project names match worker directory names (e.g., 'auth' -> 'workers/auth')
  const workerDir = path.resolve(__dirname, `../../workers/${projectName}`);
  const scriptPath = path.join(workerDir, 'dist', 'index.js'); // Assuming entry is src/index.ts

  // Initialize Miniflare with basic bindings and the worker script
  mf = new Miniflare({
    // Use the same compatibility date as your workers
    compatibilityDate: '2024-01-01', // Adjust if your workers use a different date
    compatibilityFlags: ['nodejs_compat'], // Enable Node.js compatibility if needed
    nodeModules: true, // Enable Node.js module resolution
    modules: [{ type: 'ESModule', path: scriptPath, nodeResolve: true }], // Use modules option for ES modules
    // Add any global variables or bindings that all workers might need
    bindings: {
      ENVIRONMENT: 'test',
      // Example KV namespace (in-memory for tests)
      TEST_KV: {}, // Miniflare will create an in-memory KV namespace
      // Example R2 bucket (in-memory for tests)
      TEST_BUCKET: {}, // Miniflare will create an in-memory R2 bucket
      // Pass through DATABASE_URL from .env.dev
      DATABASE_URL: DbEnvConfig.getDbUrl(),
      DATABASE_URL_LOCAL_PROXY: process.env.DATABASE_URL_LOCAL_PROXY,
      DB_METHOD: process.env.DB_METHOD,
      // Add other common bindings here
    },
    // Ensure no persistence for tests
    kvPersist: false,
    d1Persist: false,
    r2Persist: false,
    cachePersist: false,
  });

  await mf.ready;

  // Make Miniflare instance and database client globally available for tests
  global.__TEST_MINIFLARE__ = mf;
  global.__TEST_DB__ = setupTestDatabase();
});

afterAll(async () => {
  await mf.dispose();
  // Clean up database completely after all tests
  await cleanupDatabase(global.__TEST_DB__);
});

beforeEach(async () => {
  // Clean up database between each test
  await cleanupDatabase(global.__TEST_DB__);
});

// Mock the global 'env' object that workers expect
// This is a simplified mock. For more complex scenarios, you might need to
// dynamically get bindings from Miniflare or create more sophisticated mocks.
Object.defineProperty(global, 'env', {
  get() {
    // Return a mock env object that includes Miniflare's bindings
    // and any other environment variables needed by the worker code.
    // This is a basic example; you might need to fetch actual bindings from mf.getBindings()
    // if your worker code directly accesses them via `env.MY_KV.get()` etc.
    return {
      ...process.env, // Include all process.env variables
      ...mf.getBindings(), // Include Miniflare's bindings
      // Explicitly add any other bindings that are expected by the worker code
      // For example, if a worker expects `env.DB`, you'd add it here.
      DB: global.__TEST_DB__, // Provide the test database client
      // Add other bindings as needed, e.g., KV, R2, etc.
      // TEST_KV: mf.getKVNamespace('TEST_KV'), // This would require async getBindings
    };
  },
});
