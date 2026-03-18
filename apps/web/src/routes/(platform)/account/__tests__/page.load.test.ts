/**
 * Profile Page Server Load Tests
 *
 * Tests for account profile page load function.
 * Note: Profile data is fetched client-side via async Remote Functions,
 * not in the server load. The load function only handles auth gating.
 */

import { redirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock SvelteKit modules before importing
vi.mock('@sveltejs/kit', () => ({
  redirect: vi.fn(),
}));

describe('Account Profile Page Load', () => {
  let mockLocals: { user: { id: string; email: string } | null };
  let mockPlatform: App.Platform;
  let mockCookies: Parameters<
    typeof import('../+page.server').load
  >[0]['cookies'];

  beforeEach(() => {
    vi.clearAllMocks();

    mockLocals = {
      user: { id: 'user-123', email: 'test@example.com' },
    };
    mockPlatform = { env: {} } as App.Platform;
    mockCookies = {
      get: vi.fn(() => 'session-cookie'),
      set: vi.fn(),
      delete: vi.fn(),
      serialize: vi.fn(),
      getAll: vi.fn(),
    } as unknown as Parameters<
      typeof import('../+page.server').load
    >[0]['cookies'];
  });

  it('redirects to login when locals.user is null', async () => {
    mockLocals.user = null;

    const { load } = await import('../+page.server');

    await load({
      locals: mockLocals,
      platform: mockPlatform,
      cookies: mockCookies,
    } as unknown as Parameters<typeof import('../+page.server').load>[0]);

    expect(redirect).toHaveBeenCalledWith(303, '/login?redirect=/account');
  });

  it('returns profile null when authenticated and API unreachable', async () => {
    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      platform: mockPlatform,
      cookies: mockCookies,
    } as unknown as Parameters<typeof import('../+page.server').load>[0]);

    expect(result).toEqual({ profile: null });
  });
});
