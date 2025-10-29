import { describe, it, expect } from 'vitest';
import { testDbConnection } from '@codex/database';

describe('Web App - Database Integration', () => {
  it('should allow select on db', async () => {
    expect(await testDbConnection()).toBe(true);
  });
});
