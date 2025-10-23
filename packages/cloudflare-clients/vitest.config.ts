import { defineProject } from 'vitest/config';
import path from 'path';

// Note: @cloudflare/vitest-pool-workers currently only supports Vitest 2.x-3.x
// For now, we'll use standard Node environment for testing
// When Cloudflare updates the package for Vitest 4+, uncomment the workers pool config below

export default defineProject({
  test: {
    name: '@codex/cloudflare-clients',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@codex/cloudflare-clients': path.resolve(__dirname, './src'),
    },
  },
});

// Future Workers Pool Configuration (for Vitest 4+ compatibility):
// import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
//
// export default defineWorkersProject({
//   test: {
//     name: '@codex/cloudflare-clients',
//     globals: true,
//     include: ['src/**/*.{test,spec}.{js,ts}'],
//     testTimeout: 10000,
//     hookTimeout: 10000,
//     poolOptions: {
//       workers: {
//         miniflare: {
//           compatibilityDate: '2024-01-01',
//           compatibilityFlags: ['nodejs_compat'],
//           bindings: { ENVIRONMENT: 'test' },
//           kvNamespaces: { TEST_KV: 'test-kv-namespace' },
//           d1Databases: { TEST_DB: 'test-database' },
//           r2Buckets: { TEST_BUCKET: 'test-bucket' },
//         },
//       },
//     },
//   },
// });
