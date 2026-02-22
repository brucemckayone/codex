/**
 * Profile Page Server Load Tests
 *
 * Tests for account profile page load function.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Account Profile Page Load', () => {
  let mockLocals: { user: { id: string; email: string } | null };

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Setup default mock values
    mockLocals = {
      user: { id: 'user-123', email: 'test@example.com' },
    };
  });

  it('returns local user data perfectly', async () => {
    const { load } = await import('../+page.server');

    const event = {
      locals: mockLocals,
    } as unknown as Parameters<typeof import('../+page.server').load>[0];

    const result = await load(event);

    expect(result).toEqual({
      user: mockLocals.user,
    });
  });

  it('returns null user data if locals.user is null', async () => {
    mockLocals.user = null;
    const { load } = await import('../+page.server');

    const event = {
      locals: mockLocals,
    } as unknown as Parameters<typeof import('../+page.server').load>[0];

    const result = await load(event);

    expect(result).toEqual({
      user: null,
    });
  });
});
