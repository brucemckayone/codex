import { describe, it, expect } from 'vitest';
import { db } from './index';
import { sql } from 'drizzle-orm';

describe('Database Client', () => {
  it('should connect and execute a query (drizzle client)', async () => {
    const result = await db.execute(sql`SELECT 1 as value`);

    console.log(result);
    expect(result).toBeDefined();
    expect(result.rows.length).toBeGreaterThan(0);
    expect((result.rows[0] as { value: number }).value).toBe(1);
  });
});
