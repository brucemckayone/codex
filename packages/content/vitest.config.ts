import { defineConfig } from 'vitest/config';

// Environment variables are loaded by root vitest.setup.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['../../vitest.setup.ts'], // Reference root setup file
    // Run tests sequentially to avoid database conflicts
    // Tests share the same database and need proper isolation
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
