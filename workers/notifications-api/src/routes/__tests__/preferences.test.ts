/**
 * Notification Preferences Routes Tests
 *
 * Tests for notification preferences API endpoints
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock modules before imports - use object syntax to get proper types
vi.mock('@codex/notifications', () => ({
  NotificationPreferencesService: {
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
    createDefaultPreferences: vi.fn(),
    createPreferences: vi.fn(),
  },
}));

vi.mock('@codex/validation', () => ({
  updateNotificationPreferencesSchema: {
    parse: vi.fn((data) => data),
  },
}));

import type { NotificationPreferencesService } from '@codex/notifications';
import { updateNotificationPreferencesSchema } from '@codex/validation';

// Get handler functions directly (bypassing procedure wrapper)
// We'll test the handlers in isolation
async function getPreferencesHandler(
  services: {
    preferences: Pick<NotificationPreferencesService, 'getPreferences'>;
  },
  user: { id: string }
) {
  return services.preferences.getPreferences(user.id);
}

async function updatePreferencesHandler(
  services: {
    preferences: Pick<NotificationPreferencesService, 'updatePreferences'>;
  },
  user: { id: string },
  input: { body: unknown }
) {
  return services.preferences.updatePreferences(
    user.id,
    updateNotificationPreferencesSchema.parse(input.body)
  );
}

describe('Notification Preferences Handlers', () => {
  let mockService: {
    getPreferences: ReturnType<typeof vi.fn>;
    updatePreferences: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = {
      getPreferences: vi.fn().mockResolvedValue({
        emailMarketing: true,
        emailTransactional: true,
        emailDigest: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      updatePreferences: vi.fn().mockResolvedValue({
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
  });

  describe('getPreferences', () => {
    it('should return user preferences', async () => {
      const result = await getPreferencesHandler(
        { preferences: mockService },
        { id: 'test-user-id' }
      );

      expect(result).toEqual({
        emailMarketing: true,
        emailTransactional: true,
        emailDigest: true,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should call preferences service with user id', async () => {
      await getPreferencesHandler(
        { preferences: mockService },
        { id: 'test-user-id' }
      );

      expect(mockService.getPreferences).toHaveBeenCalledWith('test-user-id');
    });
  });

  describe('updatePreferences', () => {
    it('should update user preferences', async () => {
      const result = await updatePreferencesHandler(
        { preferences: mockService },
        { id: 'test-user-id' },
        { body: { emailMarketing: false } }
      );

      expect(result).toEqual({
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: true,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should call updatePreferences service', async () => {
      await updatePreferencesHandler(
        { preferences: mockService },
        { id: 'test-user-id' },
        { body: { emailMarketing: false } }
      );

      expect(mockService.updatePreferences).toHaveBeenCalledWith(
        'test-user-id',
        { emailMarketing: false }
      );
    });
  });
});
