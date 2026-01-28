import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'identity',
    environment: 'happy-dom',
    globals: true,
  },
});
