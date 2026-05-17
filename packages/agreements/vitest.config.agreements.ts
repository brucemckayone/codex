import { packageVitestConfig } from '../../config/vitest/package.config';

// Environment variables are loaded by root vitest.setup.ts
// Neon Testing plugin will provision ephemeral branches for each test file
//
// Sequential mode: tests in agreement-service.test.ts share the same DB and
// create orgs/proposals with overlapping (org, creator, revenue_type) triples;
// the partial unique index `uq_creator_org_agreement_active_per_type` would
// trip with concurrent test execution. The unit-only math suite is
// pure-function and would run in parallel safely, but the global flag is
// per-file so the cheaper safer path is to mark the whole package sequential.

export default packageVitestConfig({
  packageName: 'agreements',
  setupFiles: ['../../vitest.setup.ts'],
  testTimeout: 60000,
  hookTimeout: 60000,
  enableNeonTesting: true,
  sequentialTests: true,
});
