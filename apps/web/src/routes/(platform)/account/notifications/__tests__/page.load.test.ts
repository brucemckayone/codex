/**
 * Notifications Page Server Load Tests
 *
 * Tests for account notifications page load function.
 */

import { redirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockCookies, MockServerLoadEvent } from '$tests/test-helpers';

// Mock SvelteKit modules before importing
vi.mock('@sveltejs/kit', () => ({
  redirect: vi.fn(),
}));

// Create mock functions that we can configure before each test
const mockGetNotificationPreferences = vi.fn();

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    account: {
      getNotificationPreferences: mockGetNotificationPreferences,
    },
  })),
}));

describe('Notifications Page Load', () => {
  let mockLocals: Partial<App.Locals>;
  let mockSetHeaders: ReturnType<typeof vi.fn>;
  let mockPlatform: App.Platform;
  let mockCookies: MockCookies;

  // Mock user object with all required UserData fields
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
    emailVerified: true,
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Setup default mock values
    mockLocals = {
      user: mockUser,
    };
    mockSetHeaders = vi.fn();
    mockPlatform = { env: {} } as App.Platform;
    mockCookies = {
      get: vi.fn(() => 'session-cookie'),
      set: vi.fn(),
      delete: vi.fn(),
      serialize: vi.fn(),
      getAll: vi.fn(() => []),
    };
  });

  /**
   * Helper to create a typed mock load event
   * Returns MockServerLoadEvent for test usage
   */
  function createMockLoadEvent(
    overrides: Partial<MockServerLoadEvent> = {}
  ): MockServerLoadEvent {
    return {
      params: {},
      cookies: mockCookies,
      platform: mockPlatform as MockServerLoadEvent['platform'],
      url: new URL('http://localhost:3000/account/notifications'),
      route: { id: '/account/notifications' },
      locals: mockLocals,
      setHeaders: mockSetHeaders,
      request: new Request('http://localhost:3000/account/notifications'),
      ...overrides,
    };
  }

  it('redirects to login when locals.user is null', async () => {
    mockLocals.user = null;

    const { load } = await import('../+page.server');

    await load(
      createMockLoadEvent({
        locals: mockLocals,
      })
    );

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
    mockGetNotificationPreferences.mockResolvedValue(preferencesData);

    const { load } = await import('../+page.server');

    const result = await load(createMockLoadEvent());

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
    mockGetNotificationPreferences.mockResolvedValue(partialData);

    const { load } = await import('../+page.server');

    const result = await load(createMockLoadEvent());

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

    const result = await load(createMockLoadEvent());

    expect(result).toEqual({
      preferences: {
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: false,
      },
    });
  });

  it('sets cache-control headers', async () => {
    mockGetNotificationPreferences.mockResolvedValue({
      emailMarketing: true,
      emailTransactional: true,
      emailDigest: false,
    });

    const { load } = await import('../+page.server');

    await load(createMockLoadEvent());

    expect(mockSetHeaders).toHaveBeenCalledWith({
      'Cache-Control': 'private, no-cache',
    });
  });

  it('handles API timeout gracefully', async () => {
    mockGetNotificationPreferences.mockRejectedValue(new Error('Timeout'));

    const { load } = await import('../+page.server');

    const result = await load(createMockLoadEvent());

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
    mockGetNotificationPreferences.mockResolvedValue(nullData);

    const { load } = await import('../+page.server');

    const result = await load(createMockLoadEvent());

    expect(result).toEqual({
      preferences: {
        emailMarketing: false, // null coalesces to false
        emailTransactional: true, // null coalesces to true
        emailDigest: false, // null coalesces to false
      },
    });
  });
});
