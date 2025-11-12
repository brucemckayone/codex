import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env.dev
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../../.env.dev') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Run tests sequentially to avoid database conflicts
    // Tests share the same database and need proper isolation
    fileParallelism: false,
    env: {
      // Database configuration for tests
      // DB_METHOD controls connection strategy (LOCAL_PROXY, NEON_BRANCH, PRODUCTION)
      DB_METHOD: process.env.DB_METHOD || 'LOCAL_PROXY',
      DATABASE_URL_LOCAL_PROXY: process.env.DATABASE_URL_LOCAL_PROXY || '',
      DATABASE_URL: process.env.DATABASE_URL || '',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
