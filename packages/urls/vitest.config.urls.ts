import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'urls',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
});
