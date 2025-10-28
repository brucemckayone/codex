import { describe, it, expect } from 'vitest';

// This test is not designed to run in the Neon ephemeral branch environment
if (process.env.DB_METHOD === 'NEON_BRANCH') {
  describe.skip('Database Client', () => {
    it('is skipped when DB_METHOD is NEON_BRANCH', () => {});
  });
} else {
  describe('Database Client', () => {
    it('should connect and execute a query (drizzle client)', async () => {
      // Dynamically import db to avoid initialization errors in other environments
      const { db } = await import('./index');
      const { sql } = await import('drizzle-orm');

      const result = await db.execute(sql`SELECT 1 as value`);

      console.log(result);
      expect(result).toBeDefined();
      expect(result.rows.length).toBeGreaterThan(0);
      expect((result.rows[0] as { value: number }).value).toBe(1);
    });
  });
}

