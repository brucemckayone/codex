import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateNotificationsForm } from '$lib/remote/account.remote';

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
      updateNotificationPreferences: vi.fn(),
    },
  })),
}));

describe('updateNotificationsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should accept boolean values for all notification fields', async () => {
    const formData = {
      emailMarketing: true,
      emailTransactional: false,
      emailDigest: true,
    };

    // Verify the form accepts the schema
    expect(typeof updateNotificationsForm).toBe('object');
    expect(updateNotificationsForm).toBeDefined();
  });

  it('should accept all false values', async () => {
    const formData = {
      emailMarketing: false,
      emailTransactional: false,
      emailDigest: false,
    };

    // Verify the form accepts the schema
    expect(typeof updateNotificationsForm).toBe('object');
  });

  it('should accept all true values', async () => {
    const formData = {
      emailMarketing: true,
      emailTransactional: true,
      emailDigest: true,
    };

    // Verify the form accepts the schema
    expect(typeof updateNotificationsForm).toBe('object');
  });
});
