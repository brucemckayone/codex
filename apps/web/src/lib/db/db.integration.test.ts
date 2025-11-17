import { testDbConnection } from '@codex/database';
import { describe, expect, it } from 'vitest';

// Web app database integration test
// Note: Does not use withNeonTestBranch() to avoid Vite version conflicts
// Database integration testing is handled at the package level (@codex/database, @codex/identity, @codex/content)
// This test simply verifies the web app can connect to the database

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
