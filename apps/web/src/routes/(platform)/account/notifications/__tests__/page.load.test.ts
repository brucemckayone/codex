/**
 * Notifications Page Server Load Tests
 *
 * Tests for account notifications page load function.
 */

import { redirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { load } from '../+page.server';

// Mock SvelteKit modules before importing
vi.mock('@sveltejs/kit', () => ({
  redirect: vi.fn(),
}));

// Create mock functions that we can configure before each test
const mockGetNotificationPreferences = vi.fn();

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
      getNotificationPreferences: mockGetNotificationPreferences,
    },
  })),
}));

describe('Notifications Page Load', () => {
  let mockLocals: { user: { id: string; email: string } | null };
  let mockPlatform: App.Platform;
  let mockCookies: Parameters<typeof load>[0]['cookies'];

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
    } as unknown as Parameters<typeof load>[0]['cookies'];
  });

  it('redirects to login when locals.user is null', async () => {
    mockLocals.user = null;

    const { load } = await import('../+page.server');

    await load({
      locals: mockLocals,
      platform: mockPlatform,
      cookies: mockCookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(redirect).toHaveBeenCalledWith(
      303,
      '/login?redirect=/account/notifications'
    );
  });

  it('loads notification preferences from API when authenticated', async () => {
    const preferencesData = {
      emailMarketing: true,
      emailTransactional: true,
      emailDigest: false,
    };
    mockGetNotificationPreferences.mockResolvedValue({ data: preferencesData });

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      platform: mockPlatform,
      cookies: mockCookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toEqual({
      preferences: preferencesData,
    });
    expect(mockGetNotificationPreferences).toHaveBeenCalled();
  });

  it('loads notification preferences with defaults when API returns partial data', async () => {
    const partialData = {
      emailMarketing: true,
      // emailTransactional missing
      // emailDigest missing
    };
    mockGetNotificationPreferences.mockResolvedValue({ data: partialData });

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      platform: mockPlatform,
      cookies: mockCookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toEqual({
      preferences: {
        emailMarketing: true,
        emailTransactional: true, // default
        emailDigest: false, // default
      },
    });
  });

  it('handles API failure gracefully by returning defaults', async () => {
    mockGetNotificationPreferences.mockRejectedValue(new Error('API Error'));

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      platform: mockPlatform,
      cookies: mockCookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toEqual({
      preferences: {
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: false,
      },
    });
  });

  it('handles API timeout gracefully', async () => {
    mockGetNotificationPreferences.mockRejectedValue(new Error('Timeout'));

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      platform: mockPlatform,
      cookies: mockCookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toEqual({
      preferences: {
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: false,
      },
    });
  });

  it('handles null values from API response', async () => {
    const nullData = {
      emailMarketing: null,
      emailTransactional: null,
      emailDigest: null,
    };
    mockGetNotificationPreferences.mockResolvedValue({ data: nullData });

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      platform: mockPlatform,
      cookies: mockCookies,
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toEqual({
      preferences: {
        emailMarketing: false, // null coalesces to false
        emailTransactional: true, // null coalesces to true
        emailDigest: false, // null coalesces to false
      },
    });
  });
});
