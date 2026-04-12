/**
 * Internal Send Route - Unit Tests
 *
 * Tests for POST /internal/send — worker-to-worker email sending with HMAC auth.
 * Uses cloudflare:test module for Worker runtime testing.
 *
 * Security: Worker-to-worker HMAC authentication (X-Worker-Signature + X-Worker-Timestamp)
 */

import { env, SELF } from 'cloudflare:test';
import { MIME_TYPES } from '@codex/constants';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/**
 * Generate worker auth headers for testing.
 * Mirrors the generateWorkerSignature function from @codex/security.
 */
async function generateWorkerAuthHeaders(
  body: string = ''
): Promise<Record<string, string>> {
  const secret =
    (env as Record<string, string>).WORKER_SHARED_SECRET ||
    'test-worker-secret';
  const timestamp = Math.floor(Date.now() / 1000);

  const encoder = new TextEncoder();
  const data = encoder.encode(`${timestamp}:${body}`);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const base64Signature = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  );

  return {
    'X-Worker-Signature': base64Signature,
    'X-Worker-Timestamp': timestamp.toString(),
    'Content-Type': MIME_TYPES.APPLICATION.JSON,
  };
}

/** Valid request body for POST /internal/send */
function validSendBody(overrides: Record<string, unknown> = {}) {
  return {
    to: 'user@example.com',
    templateName: 'purchase-receipt',
    data: {
      userName: 'Test User',
      contentTitle: 'Video',
      priceFormatted: '9.99',
      purchaseDate: '2026-01-01',
      contentUrl: 'https://example.com/content',
    },
    category: 'transactional',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Internal Send Route', () => {
  // =========================================================================
  // Worker Authentication (HMAC)
  // =========================================================================

  describe('Worker Authentication', () => {
    it('rejects request without HMAC headers (401)', async () => {
      const body = JSON.stringify(validSendBody());
      const response = await SELF.fetch('http://localhost/internal/send', {
        method: 'POST',
        headers: { 'Content-Type': MIME_TYPES.APPLICATION.JSON },
        body,
      });

      expect(response.status).toBe(401);
    });

    it('rejects request with invalid HMAC signature (401)', async () => {
      const body = JSON.stringify(validSendBody());
      const response = await SELF.fetch('http://localhost/internal/send', {
        method: 'POST',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'X-Worker-Signature': 'invalid-signature-value',
          'X-Worker-Timestamp': Math.floor(Date.now() / 1000).toString(),
        },
        body,
      });

      expect(response.status).toBe(401);
    });
  });

  // =========================================================================
  // Input Validation
  // =========================================================================

  describe('Input Validation', () => {
    it('rejects request with invalid body (400)', async () => {
      const body = JSON.stringify({ invalid: 'data' });
      const headers = await generateWorkerAuthHeaders(body);
      const response = await SELF.fetch('http://localhost/internal/send', {
        method: 'POST',
        headers,
        body,
      });

      expect(response.status).toBe(400);
    });

    it('validates email format', async () => {
      const body = JSON.stringify(validSendBody({ to: 'not-an-email' }));
      const headers = await generateWorkerAuthHeaders(body);
      const response = await SELF.fetch('http://localhost/internal/send', {
        method: 'POST',
        headers,
        body,
      });

      expect(response.status).toBe(400);
    });

    it('validates templateName format (kebab-case required)', async () => {
      const body = JSON.stringify(
        validSendBody({ templateName: 'Invalid Template Name!' })
      );
      const headers = await generateWorkerAuthHeaders(body);
      const response = await SELF.fetch('http://localhost/internal/send', {
        method: 'POST',
        headers,
        body,
      });

      expect(response.status).toBe(400);
    });

    it('rejects missing required category field', async () => {
      const payload = validSendBody();
      // Remove category to trigger validation failure
      const { category: _category, ...withoutCategory } = payload;
      const body = JSON.stringify(withoutCategory);
      const headers = await generateWorkerAuthHeaders(body);
      const response = await SELF.fetch('http://localhost/internal/send', {
        method: 'POST',
        headers,
        body,
      });

      expect(response.status).toBe(400);
    });

    it('rejects invalid category value', async () => {
      const body = JSON.stringify(
        validSendBody({ category: 'not-a-valid-category' })
      );
      const headers = await generateWorkerAuthHeaders(body);
      const response = await SELF.fetch('http://localhost/internal/send', {
        method: 'POST',
        headers,
        body,
      });

      expect(response.status).toBe(400);
    });
  });

  // =========================================================================
  // Authenticated Request (handler execution)
  // =========================================================================

  describe('Authenticated Request', () => {
    it('accepts valid request with HMAC auth and reaches handler', async () => {
      const body = JSON.stringify(validSendBody());
      const headers = await generateWorkerAuthHeaders(body);
      const response = await SELF.fetch('http://localhost/internal/send', {
        method: 'POST',
        headers,
        body,
      });

      // Auth passes and input validates — handler executes.
      // Without a real database, the service layer will error (500),
      // or it may succeed if mock/console provider is configured.
      // The key assertion: it is NOT 401 (auth passed) and NOT 400 (validation passed).
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(400);
      expect([200, 500]).toContain(response.status);
    });
  });
});
