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
      'packages/security',
      'packages/content',
      'packages/identity',

      // Workers
      'workers/auth',
      'workers/stripe-webhook-handler',
      'workers/content-api',
      'workers/identity-api',
    ],
  },
});
