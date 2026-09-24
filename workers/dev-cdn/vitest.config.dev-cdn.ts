import { defineConfig } from 'vitest/config';

// Plain node environment: the tests drive the worker's fetch() with fake R2
// bindings, so they need neither workerd nor Miniflare.
export default defineConfig({
  test: {
    name: 'dev-cdn',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
