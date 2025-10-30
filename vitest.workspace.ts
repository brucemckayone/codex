import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      // Web app
      'apps/web',

      // Packages
      'packages/database',
      'packages/validation',
      'packages/cloudflare-clients',
      'packages/test-utils',
      'packages/observability',

      // Workers (uncomment when ready)
      'workers/auth',
      'workers/stripe-webhook-handler',
    ],
  },
});
