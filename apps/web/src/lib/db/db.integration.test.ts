import { testDbConnection } from '@codex/database';
import { describe, expect, it } from 'vitest';

describe('Web App - Database Integration', () => {
  it('should allow select on db', async () => {
    expect(await testDbConnection()).toBe(true);
  });
});
