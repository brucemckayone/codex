import { describe, it, expect } from 'vitest';

const isNeonBranch = process.env.DB_METHOD === 'NEON_BRANCH';

describe('Database Client', () => {
  it.skipIf(isNeonBranch)(
    'should connect and execute a query (drizzle client)',
    async () => {
      // Dynamically import db to avoid initialization errors in other environments
      const { db } = await import('./index');
      const { sql } = await import('drizzle-orm');

      const result = await db.execute(sql`SELECT 1 as value`);

      expect(result).toBeDefined();
      expect(result.rows.length).toBeGreaterThan(0);
      expect((result.rows[0] as { value: number }).value).toBe(1);
    }
  );
});