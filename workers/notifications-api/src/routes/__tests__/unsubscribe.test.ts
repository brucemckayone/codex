/**
 * Unsubscribe Routes Tests
 *
 * Tests for the public unsubscribe endpoints (no auth required).
 * Uses real HMAC token generation/verification with mocked database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that resolve mocked modules
// ---------------------------------------------------------------------------

const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
const mockValues = vi.fn().mockReturnValue({
  onConflictDoUpdate: mockOnConflictDoUpdate,
});
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

const mockDb = { insert: mockInsert };

vi.mock('@codex/database', () => ({
  createDbClient: vi.fn(() => mockDb),
  schema: {
    notificationPreferences: {
      userId: 'user_id',
    },
  },
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { generateUnsubscribeToken } from '@codex/notifications';
import { Hono } from 'hono';
import unsubscribeRoutes from '../unsubscribe';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = 'test-unsubscribe-secret-key-for-hmac';

function createApp() {
  const app = new Hono();
  app.route('/unsubscribe', unsubscribeRoutes);
  return app;
}

async function generateExpiredToken(
  payload: { userId: string; category: 'marketing' | 'digest' },
  secret: string
): Promise<string> {
  // Generate a token that expired 1 day ago (expiryDays = -1 would not work,
  // so we generate the raw structure manually)
  const fullPayload = {
    ...payload,
    expiresAt: Math.floor(Date.now() / 1000) - 86400, // 1 day ago
  };

  const payloadStr = JSON.stringify(fullPayload);
  const payloadB64 = btoa(payloadStr)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadStr)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${payloadB64}.${sigB64}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Unsubscribe Routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // =========================================================================
  // GET /unsubscribe/:token — Token Validation
  // =========================================================================

  describe('GET /unsubscribe/:token', () => {
    it('returns valid:true with category for valid token', async () => {
      const token = await generateUnsubscribeToken(
        { userId: 'user-123', category: 'marketing' },
        TEST_SECRET
      );

      const res = await app.request(
        `/unsubscribe/${token}`,
        { method: 'GET' },
        { WORKER_SHARED_SECRET: TEST_SECRET, DATABASE_URL: 'mock' }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        valid: true,
        category: 'marketing',
      });
    });

    it('returns valid:false for expired token', async () => {
      const token = await generateExpiredToken(
        { userId: 'user-expired', category: 'digest' },
        TEST_SECRET
      );

      const res = await app.request(
        `/unsubscribe/${token}`,
        { method: 'GET' },
        { WORKER_SHARED_SECRET: TEST_SECRET, DATABASE_URL: 'mock' }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        valid: false,
        reason: 'Token is invalid or expired',
      });
    });

    it('returns valid:false for tampered token', async () => {
      const token = await generateUnsubscribeToken(
        { userId: 'user-tampered', category: 'marketing' },
        TEST_SECRET
      );

      // Tamper with the payload portion (flip a character)
      const parts = token.split('.');
      const tamperedPayload = `X${parts[0]!.slice(1)}`;
      const tamperedToken = `${tamperedPayload}.${parts[1]}`;

      const res = await app.request(
        `/unsubscribe/${tamperedToken}`,
        { method: 'GET' },
        { WORKER_SHARED_SECRET: TEST_SECRET, DATABASE_URL: 'mock' }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        valid: false,
        reason: 'Token is invalid or expired',
      });
    });

    it('returns valid:false for nonsense string', async () => {
      const res = await app.request(
        '/unsubscribe/completely-invalid-garbage-token',
        { method: 'GET' },
        { WORKER_SHARED_SECRET: TEST_SECRET, DATABASE_URL: 'mock' }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        valid: false,
        reason: 'Token is invalid or expired',
      });
    });
  });

  // =========================================================================
  // POST /unsubscribe/:token — Process Unsubscribe
  // =========================================================================

  describe('POST /unsubscribe/:token', () => {
    it('returns success:true and updates preferences for valid marketing token', async () => {
      const token = await generateUnsubscribeToken(
        { userId: 'user-456', category: 'marketing' },
        TEST_SECRET
      );

      const res = await app.request(
        `/unsubscribe/${token}`,
        { method: 'POST' },
        { WORKER_SHARED_SECRET: TEST_SECRET, DATABASE_URL: 'mock' }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        success: true,
        category: 'marketing',
      });

      // Verify DB upsert was called with correct values
      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-456',
          emailMarketing: false,
        })
      );
      expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          set: { emailMarketing: false },
        })
      );
    });

    it('returns success:true for valid digest token', async () => {
      const token = await generateUnsubscribeToken(
        { userId: 'user-789', category: 'digest' },
        TEST_SECRET
      );

      const res = await app.request(
        `/unsubscribe/${token}`,
        { method: 'POST' },
        { WORKER_SHARED_SECRET: TEST_SECRET, DATABASE_URL: 'mock' }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        success: true,
        category: 'digest',
      });

      // Verify digest-specific update field
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-789',
          emailDigest: false,
        })
      );
      expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          set: { emailDigest: false },
        })
      );
    });

    it('is idempotent — second POST produces same result', async () => {
      const token = await generateUnsubscribeToken(
        { userId: 'user-idem', category: 'marketing' },
        TEST_SECRET
      );

      const env = { WORKER_SHARED_SECRET: TEST_SECRET, DATABASE_URL: 'mock' };

      // First call
      const res1 = await app.request(
        `/unsubscribe/${token}`,
        { method: 'POST' },
        env
      );
      expect(res1.status).toBe(200);
      const body1 = await res1.json();
      expect(body1).toMatchObject({ success: true, category: 'marketing' });

      // Second call — same token, same result
      const res2 = await app.request(
        `/unsubscribe/${token}`,
        { method: 'POST' },
        env
      );
      expect(res2.status).toBe(200);
      const body2 = await res2.json();
      expect(body2).toMatchObject({ success: true, category: 'marketing' });

      // DB upsert called twice (onConflictDoUpdate handles idempotency)
      expect(mockInsert).toHaveBeenCalledTimes(2);
    });

    it('returns success:false for invalid token', async () => {
      const res = await app.request(
        '/unsubscribe/invalid-token-here',
        { method: 'POST' },
        { WORKER_SHARED_SECRET: TEST_SECRET, DATABASE_URL: 'mock' }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toMatchObject({
        success: false,
        error: 'Token is invalid or expired',
      });

      // DB should NOT be called for invalid tokens
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });
});
