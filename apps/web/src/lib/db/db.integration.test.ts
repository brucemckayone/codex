// @vitest-environment node

import { testDbConnection } from '@codex/database';
import { describe, expect, it } from 'vitest';

// Web app database integration test
// Uses Node environment (not happy-dom) for database connectivity
// Uses workflow-level Neon branches in CI, LOCAL_PROXY locally

describe('Web App - Database Integration', () => {
  if (['LOCAL_PROXY', 'NEON_BRANCH'].includes(process.env.DB_METHOD || '')) {
    it('should allow select on db', async () => {
      expect(await testDbConnection()).toBe(true);
    });
  } else {
    it('is skipped because no database is configured', () => {
      console.log(
        'Skipping database integration test: DB_METHOD is not LOCAL_PROXY or NEON_BRANCH'
      );
      expect(true).toBe(true);
    });
  }
});
