import { describe, it, expect, beforeAll } from 'vitest';
import { db, testConnection } from './client';
import { sql } from 'drizzle-orm';

describe('@codex/database', () => {
  describe('Database Client', () => {
    it('should export db instance', () => {
      expect(db).toBeDefined();
    });

    it('should export testConnection function', () => {
      expect(testConnection).toBeDefined();
      expect(typeof testConnection).toBe('function');
    });
  });

  describe('Database Connection - Integration', () => {
    // Skip if no database connection string is provided
    const skipIntegration =
      !process.env.PG_CONNECTION_STRING && !process.env.DATABASE_URL;

    beforeAll(() => {
      if (skipIntegration) {
        console.warn(
          '⚠️  Skipping integration tests - no database connection string provided'
        );
      }
    });

    it.skipIf(skipIntegration)(
      'should connect to database successfully',
      async () => {
        const isConnected = await testConnection();
        expect(isConnected).toBe(true);
      },
      10000
    );

    it.skipIf(skipIntegration)(
      'should execute a simple query',
      async () => {
        const result = await (db as any).execute(sql`SELECT 1 as value`);

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].value).toBe(1);
      },
      10000
    );
  });
});
