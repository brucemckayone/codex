/**
 * Profile Page Server Load Tests
 *
 * Tests for account profile page load function.
 */

import { redirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock SvelteKit modules before importing
vi.mock('@sveltejs/kit', () => ({
  redirect: vi.fn(),
}));

// Create mock functions that we can configure before each test
const mockGetProfile = vi.fn();

// Mock the cache package to avoid actual KV calls during tests
vi.mock('@codex/cache', () => ({
  VersionedCache: vi.fn().mockImplementation(() => ({
    get: vi.fn((_id, _type, fetcher) => fetcher()),
  })),
  CacheType: {
    USER_PREFERENCES: 'USER_PREFERENCES',
    USER_PROFILE: 'USER_PROFILE',
  },
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    account: {
      getProfile: mockGetProfile,
    },
  })),
}));

describe('Account Profile Page Load', () => {
  let mockLocals: { user: { id: string; email: string } | null };
  let mockPlatform: App.Platform;
  let mockCookies: Parameters<
    typeof import('../+page.server').load
  >[0]['cookies'];

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Setup default mock values
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

  it('loads profile data from API when authenticated', async () => {
    const profileData = {
      name: 'Test User',
      username: 'testuser',
      bio: 'Test bio',
      email: 'test@example.com',
    };
    mockGetProfile.mockResolvedValue({ data: profileData });

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      platform: mockPlatform,
      cookies: mockCookies,
    } as unknown as Parameters<typeof import('../+page.server').load>[0]);

    expect(result).toEqual({
      profile: profileData,
    });
    expect(mockGetProfile).toHaveBeenCalled();
  });

  it('handles API failure gracefully by returning null profile', async () => {
    mockGetProfile.mockRejectedValue(new Error('API Error'));

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      platform: mockPlatform,
      cookies: mockCookies,
    } as unknown as Parameters<typeof import('../+page.server').load>[0]);

    expect(result).toEqual({
      profile: null,
    });
  });
});
