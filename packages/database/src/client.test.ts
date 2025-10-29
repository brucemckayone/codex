import { describe, it, expect } from 'vitest';

// This test requires a database connection.
// It will only run if DB_METHOD is set to a value that provides a database.
const shouldRunDbTest = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

describe('Database Client', () => {
  if (shouldRunDbTest) {
    it('should connect and execute a query (drizzle client)', async () => {
      // Dynamically import db to avoid initialization errors in other environments
      const { db } = await import('./index');
      const { sql } = await import('drizzle-orm');

      const result = await db.execute(sql`SELECT 1 as value`);
      expect(result).toBeDefined();
      expect(result.rows.length).toBeGreaterThan(0);
      expect((result.rows[0] as { value: number }).value).toBe(1);
    });
  } else {
    // This test runs when the database test is skipped, preventing an empty suite error.
    it('is skipped because no database is configured', () => {
      console.log(
        'Skipping database client test: DB_METHOD is not LOCAL_PROXY or NEON_BRANCH'
      );
      // Dummy assertion to satisfy the linter
      expect(true).toBe(true);
    });
  }
});
