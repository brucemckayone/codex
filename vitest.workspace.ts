import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      // Web app
      'apps/web',

      // Packages
      'packages/access/vitest.config.access.ts',
      'packages/database/vitest.config.database.ts',
      'packages/validation/vitest.config.validation.ts',
      'packages/cloudflare-clients/vitest.config.cloudflare-clients.ts',
      'packages/test-utils/vitest.config.test-utils.ts',
      'packages/observability/vitest.config.observability.ts',
      'packages/security/vitest.config.security.ts',
      'packages/content/vitest.config.content.ts',
      'packages/identity/vitest.config.identity.ts',
      'packages/worker-utils/vitest.config.worker-utils.ts',
      'packages/transcoding/vitest.config.transcoding.ts',
      'packages/notifications/vitest.config.notifications.ts',

      // Workers
      'workers/auth',
      'workers/media-api',
      'workers/ecom-api',
      'workers/content-api',
      'workers/identity-api',
      'workers/admin-api',
    ],
  },
});
