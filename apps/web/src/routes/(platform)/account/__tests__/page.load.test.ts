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

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    account: {
      getProfile: mockGetProfile,
    },
  })),
}));

describe('Account Profile Page Load', () => {
  let mockLocals: { user: { id: string; email: string } | null };
  let mockSetHeaders: ReturnType<typeof vi.fn>;
  let mockPlatform: App.Platform;
  let mockCookies: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Setup default mock values
    mockLocals = {
      user: { id: 'user-123', email: 'test@example.com' },
    };
    mockSetHeaders = vi.fn();
    mockPlatform = { env: {} } as App.Platform;
    mockCookies = {
      get: vi.fn(() => 'session-cookie'),
      set: vi.fn(),
      delete: vi.fn(),
    };
  });

  it('redirects to login when locals.user is null', async () => {
    mockLocals.user = null;

    const { load } = await import('../+page.server');

    await load({
      locals: mockLocals,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

    expect(redirect).toHaveBeenCalledWith(303, '/login?redirect=/account');
  });

  it('loads profile data from API when authenticated', async () => {
    const profileData = {
      id: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      avatarUrl: 'https://example.com/avatar.jpg',
    };
    mockGetProfile.mockResolvedValue({ data: profileData });

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

    expect(result).toEqual({
      user: profileData,
    });
    expect(mockGetProfile).toHaveBeenCalled();
  });

  it('falls back to locals.user when API fails', async () => {
    mockGetProfile.mockRejectedValue(new Error('API Error'));

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

    expect(result).toEqual({
      user: mockLocals.user,
    });
  });

  it('sets cache-control headers', async () => {
    mockGetProfile.mockResolvedValue({ data: mockLocals.user });

    const { load } = await import('../+page.server');

    await load({
      locals: mockLocals,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

    expect(mockSetHeaders).toHaveBeenCalledWith({
      'Cache-Control': 'private, no-cache',
    });
  });

  it('handles API timeout gracefully', async () => {
    mockGetProfile.mockRejectedValue(new Error('Timeout'));

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

    expect(result).toEqual({
      user: mockLocals.user,
    });
  });

  it('handles network errors gracefully', async () => {
    mockGetProfile.mockRejectedValue(new Error('Network error'));

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

    expect(result).toEqual({
      user: mockLocals.user,
    });
  });
});
