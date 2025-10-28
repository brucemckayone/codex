import { defineProject } from 'vitest/config';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load env.dev from project root (2 levels up from packages/database)
config({ path: resolve(__dirname, '../../.env.dev') });

export default defineProject({
  test: {
    name: '@codex/database',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Note: coverage is configured at root level
  },
});
