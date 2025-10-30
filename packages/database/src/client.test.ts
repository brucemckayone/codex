import { describe, it, expect } from 'vitest';

// This test requires a database connection.
// It will only run if DB_METHOD is set to a value that provides a database.

describe('Database Client', () => {
  if (['LOCAL_PROXY', 'NEON_BRANCH'].includes(process.env.DB_METHOD || '')) {
    it('should connect and execute a query (drizzle client)', async () => {
      // Dynamically import db to avoid initialization errors in other environments
      const { db } = await import('./index');
      const { sql } = await import('drizzle-orm');

      const result = await db.execute(sql`SELECT 1 as value`);
      expect(result).toBeDefined();
      expect(result.rows.length).toBeGreaterThan(0);
      expect((result.rows[0] as { value: number }).value).toBe(1);
    });

    it('should verify database connection using testDbConnection', async () => {
      const { testDbConnection } = await import('./client');
      const isConnected = await testDbConnection();
      expect(isConnected).toBe(true);
    });

    it('should have the test_table schema migrated', async () => {
      const { db } = await import('./index');
      const { sql } = await import('drizzle-orm');

      // Verify the test_table exists
      const result = await db.execute(sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'test_table'
      `);

      expect(result.rows.length).toBe(1);
    });

    it('should have auth tables migrated', async () => {
      const { db } = await import('./index');
      const { sql } = await import('drizzle-orm');

      // Verify auth tables exist
      const result = await db.execute(sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name IN ('users', 'accounts', 'sessions', 'verification_tokens')
        ORDER BY table_name
      `);

      expect(result.rows.length).toBe(4);
      const tableNames = result.rows.map(
        (row) => (row as { table_name: string }).table_name
      );
      expect(tableNames).toContain('users');
      expect(tableNames).toContain('accounts');
      expect(tableNames).toContain('sessions');
      expect(tableNames).toContain('verification_tokens');
    });

    it('should insert and query from test_table', async () => {
      const { db } = await import('./index');
      const { testTable } = await import('./schema/test');

      // Insert a row (id is generated automatically)
      const inserted = await db.insert(testTable).values({}).returning();
      expect(inserted.length).toBe(1);
      expect(inserted[0].id).toBeGreaterThan(0);

      // Query it back
      const { eq } = await import('drizzle-orm');
      const queried = await db
        .select()
        .from(testTable)
        .where(eq(testTable.id, inserted[0].id));

      expect(queried.length).toBe(1);
      expect(queried[0].id).toBe(inserted[0].id);

      // Cleanup
      await db.delete(testTable).where(eq(testTable.id, inserted[0].id));
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
