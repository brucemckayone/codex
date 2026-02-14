/**
 * Notification Preferences Routes Tests
 *
 * Tests for notification preferences API endpoints
 */

import type { HonoEnv, ProcedureContext } from '@codex/shared-types';
import { updateNotificationPreferencesSchema } from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock services
const mockPreferencesService = {
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

// Mock procedure to inject our services
vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<{
    procedure: typeof importOriginal.procedure;
  }>();
  return {
    ...actual,
    procedure: (config: any) => {
      const handler = config.handler;
      return async (c: any) => {
        // Set up services context
        c.set('services', {
          preferences: mockPreferencesService,
        });
        c.set('user', { id: 'test-user-id' });
        c.set('requestId', 'test-request-id');
        c.set('clientIP', '127.0.0.1');
        c.set('userAgent', 'test-agent');
        c.set('obs', {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        });
        // Call handler
        const ctx = {
          user: { id: 'test-user-id' },
          input: config.input ? { body: { emailMarketing: false } } : {},
          requestId: 'test-request-id',
          clientIP: '127.0.0.1',
          userAgent: 'test-agent',
          services: {
            preferences: mockPreferencesService,
          },
          obs: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          },
          env: {} as any,
          executionCtx: {
            waitUntil: vi.fn(),
          } as any,
        } as ProcedureContext<'required', any>;
        const result = await handler(ctx);
        return c.json({ data: result });
      };
    },
  };
});

import preferencesRoutes from '../preferences';

describe('Notification Preferences Routes', () => {
  let app: Hono<HonoEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono<HonoEnv>();
    app.route('/api/notifications', preferencesRoutes);
  });

  describe('GET /api/notifications/preferences', () => {
    it('should return user preferences', async () => {
      const res = await app.request('/api/notifications/preferences');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toMatchObject({
        emailMarketing: true,
        emailTransactional: true,
        emailDigest: true,
      });
    });

    it('should call preferences service', async () => {
      await app.request('/api/notifications/preferences');

      expect(mockPreferencesService.getPreferences).toHaveBeenCalledWith(
        'test-user-id'
      );
    });
  });

  describe('PUT /api/notifications/preferences', () => {
    it('should update user preferences', async () => {
      const res = await app.request('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailMarketing: false,
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toMatchObject({
        emailMarketing: false,
      });
    });

    it('should call updatePreferences service', async () => {
      await app.request('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailMarketing: false,
        }),
      });

      expect(mockPreferencesService.updatePreferences).toHaveBeenCalledWith(
        'test-user-id',
        { emailMarketing: false }
      );
    });
  });
});
