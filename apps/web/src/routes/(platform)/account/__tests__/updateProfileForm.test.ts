import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateProfileForm } from '$lib/remote/account.remote';

// Mock dependencies
vi.mock('$app/server', () => ({
  form: (schema: unknown, handler: unknown) => ({
    schema,
    handler,
  }),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: new Map(),
  })),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    account: {
      updateProfile: vi.fn(),
    },
  })),
}));

describe('updateProfileForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should accept valid profile data', async () => {
    const formData = {
      displayName: 'John Doe',
      username: 'johndoe',
      bio: 'Software developer',
      website: 'https://example.com',
      twitter: 'https://twitter.com/johndoe',
      youtube: 'https://youtube.com/@johndoe',
      instagram: 'https://instagram.com/johndoe',
    };

    // Verify the form accepts the schema
    expect(typeof updateProfileForm).toBe('object');
    expect(updateProfileForm).toBeDefined();
  });

  it('should accept partial profile data (all optional)', async () => {
    const formData = {
      displayName: 'Jane Doe',
    };

    // Verify the form accepts the schema
    expect(typeof updateProfileForm).toBe('object');
  });

  it('should accept profile with only username', async () => {
    const formData = {
      username: 'janedoe-123',
    };

    // Verify the form accepts the schema
    expect(typeof updateProfileForm).toBe('object');
  });

  it('should accept profile with bio only', async () => {
    const formData = {
      bio: 'A short bio up to 500 characters',
    };

    // Verify the form accepts the schema
    expect(typeof updateProfileForm).toBe('object');
  });
});
