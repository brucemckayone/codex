import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'constants',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
});
