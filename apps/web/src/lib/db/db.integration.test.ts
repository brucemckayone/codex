import { describe, it, expect, beforeAll } from 'vitest';
import { db, testConnection } from '@codex/database';

describe('Web App - Database Integration', () => {
  // Skip if no database connection string is provided
  const skipIntegration =
    !process.env.PG_CONNECTION_STRING && !process.env.DATABASE_URL;

  beforeAll(() => {
    if (skipIntegration) {
      console.warn(
        '⚠️  Skipping web app database integration tests - no connection string'
      );
    }
  });

  it.skipIf(skipIntegration)(
    'should connect to database from web app context',
    async () => {
      const isConnected = await testConnection();
      expect(isConnected).toBe(true);
    },
    10000
  );

  it.skipIf(skipIntegration)(
    'should be able to import and use db instance',
    async () => {
      expect(db).toBeDefined();

      // Test a simple query
      const result = await db.execute('SELECT current_database() as db_name');
      expect(result).toBeDefined();
      expect(result.rows).toBeDefined();
      expect(result.rows.length).toBeGreaterThan(0);
    },
    10000
  );

  it.skipIf(skipIntegration)(
    'should handle database errors gracefully',
    async () => {
      // Try to execute invalid SQL
      await expect(async () => {
        await db.execute('SELECT * FROM nonexistent_table_12345');
      }).rejects.toThrow();
    },
    10000
  );
});
