import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // Web app
  'apps/web',

  // Packages
  'packages/database',
  'packages/validation',
  'packages/cloudflare-clients',
  'packages/test-utils',

  // Workers (uncomment when ready)
  // 'workers/queue-consumer',
]);
