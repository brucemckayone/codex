import { describe, it, expect } from 'vitest';
import { db } from '@codex/database';
import { sql } from 'drizzle-orm';

describe('Database Client', () => {
  it('should connect and execute a query', async () => {
    const result = await (db as any).execute(sql`SELECT 1 as value`);
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect((result[0] as { value: number }).value).toBe(1);
  });
});