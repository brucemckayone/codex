/**
 * Notification Preferences Service Tests
 *
 * Tests for user notification preference management
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationPreferencesService } from '../notification-preferences-service';

// Mock DB - properly typed to match NotificationPreferencesServiceConfig
const mockDb = {
  query: {
    notificationPreferences: {
      findFirst: vi.fn(),
    },
  },
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
};

// Mock the database module before importing service
vi.mock('@codex/database', () => ({ schema: mockDb }));
vi.unmock('@codex/database');

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NotificationPreferencesService({
      db: mockDb,
      environment: 'test',
    });
  });

  describe('getPreferences', () => {
    it('should return preferences when found', async () => {
      const mockPrefs = {
        userId: 'user-1',
        emailMarketing: true,
        emailTransactional: true,
        emailDigest: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.query.notificationPreferences.findFirst.mockResolvedValue(
        mockPrefs
      );

      const result = await service.getPreferences('user-1');

      expect(result).toEqual({
        emailMarketing: true,
        emailTransactional: true,
        emailDigest: true,
        createdAt: mockPrefs.createdAt,
        updatedAt: mockPrefs.updatedAt,
      });
    });

    it('should create defaults when no preferences exist', async () => {
      mockDb.query.notificationPreferences.findFirst.mockResolvedValue(null);

      const newPrefs = {
        userId: 'user-1',
        emailMarketing: true,
        emailTransactional: true,
        emailDigest: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([newPrefs]),
          }),
        }),
      });

      const result = await service.getPreferences('user-1');

      expect(result.emailMarketing).toBe(true);
      expect(result.emailTransactional).toBe(true);
      expect(result.emailDigest).toBe(true);
    });
  });

  describe('updatePreferences', () => {
    it('should update existing preferences', async () => {
      const existing = {
        userId: 'user-1',
        emailMarketing: true,
        emailTransactional: true,
        emailDigest: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.query.notificationPreferences.findFirst.mockResolvedValue(
        existing
      );

      const updated = {
        ...existing,
        emailMarketing: false,
        updatedAt: new Date(),
      };

      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      });

      const result = await service.updatePreferences('user-1', {
        emailMarketing: false,
      });

      expect(result.emailMarketing).toBe(false);
    });

    it('should create preferences when none exist', async () => {
      mockDb.query.notificationPreferences.findFirst.mockResolvedValue(null);

      const newPrefs = {
        userId: 'user-1',
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([newPrefs]),
        }),
      });

      const result = await service.updatePreferences('user-1', {
        emailMarketing: false,
      });

      expect(result.emailMarketing).toBe(false);
      expect(result.emailTransactional).toBe(true);
      expect(result.emailDigest).toBe(true);
    });
  });

  describe('hasOptedOut', () => {
    it('should return true when marketing is disabled', async () => {
      const prefs = {
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: true,
      };

      mockDb.query.notificationPreferences.findFirst.mockResolvedValue(prefs);

      const result = await service.hasOptedOut('user-1', 'marketing');
      expect(result).toBe(true);
    });

    it('should return false when marketing is enabled', async () => {
      const prefs = {
        emailMarketing: true,
        emailTransactional: true,
        emailDigest: true,
      };

      mockDb.query.notificationPreferences.findFirst.mockResolvedValue(prefs);

      const result = await service.hasOptedOut('user-1', 'marketing');
      expect(result).toBe(false);
    });

    it('should return true when transactional is disabled', async () => {
      const prefs = {
        emailMarketing: true,
        emailTransactional: false,
        emailDigest: true,
      };

      mockDb.query.notificationPreferences.findFirst.mockResolvedValue(prefs);

      const result = await service.hasOptedOut('user-1', 'transactional');
      expect(result).toBe(true);
    });

    it('should return false when no preferences exist (defaults)', async () => {
      mockDb.query.notificationPreferences.findFirst.mockResolvedValue(null);

      const result = await service.hasOptedOut('user-1', 'marketing');
      expect(result).toBe(false); // defaults to true
    });
  });
});
