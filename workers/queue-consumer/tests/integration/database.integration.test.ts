import { describe, it, expect, beforeAll } from 'vitest';
import { db, testConnection } from '@codex/database';

describe('Queue Consumer Worker - Database Integration', () => {
  // Skip if no database connection string is provided
  const skipIntegration =
    !process.env.PG_CONNECTION_STRING && !process.env.DATABASE_URL;

  beforeAll(() => {
    if (skipIntegration) {
      console.warn(
        '⚠️  Skipping queue-consumer database integration tests - no connection string'
      );
    }
  });

  it.skipIf(skipIntegration)(
    'should connect to database from worker context',
    async () => {
      const isConnected = await testConnection();
      expect(isConnected).toBe(true);
    },
    10000
  );

  it.skipIf(skipIntegration)(
    'should be able to query database',
    async () => {
      expect(db).toBeDefined();

      // Test a simple query
      const result = await db.execute('SELECT 1 + 1 as sum');
      expect(result).toBeDefined();
      expect(result.rows).toBeDefined();
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].sum).toBe(2);
    },
    10000
  );

  it.skipIf(skipIntegration)(
    'should handle concurrent database queries',
    async () => {
      // Simulate multiple queue messages processing in parallel
      const queries = Array.from({ length: 5 }, (_, i) =>
        db.execute(`SELECT ${i} as value`)
      );

      const results = await Promise.all(queries);

      expect(results).toHaveLength(5);
      results.forEach((result, index) => {
        expect(result.rows[0].value).toBe(index);
      });
    },
    10000
  );

  it.skipIf(skipIntegration)(
    'should verify Neon HTTP driver works in worker environment',
    async () => {
      // Verify that the Neon serverless driver is configured correctly
      // This is important because workers use the HTTP-based driver
      const result = await db.execute('SELECT version() as pg_version');
      expect(result.rows[0].pg_version).toContain('PostgreSQL');
    },
    10000
  );
});
