/**
 * RunPod Webhook Signature Verification Middleware Tests
 *
 * Tests for HMAC-SHA256 signature verification to ensure webhook security.
 * These tests verify actual signature computation and validation.
 */

import { MIME_TYPES } from '@codex/constants';
import type { HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

// Response types for type-safe assertions
interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

import { verifyRunpodSignature } from '../verify-runpod-signature';

// Helper to generate HMAC-SHA256 signature
async function generateSignature(
  payload: string,
  secret: string,
  timestamp?: number
): Promise<string> {
  const encoder = new TextEncoder();
  const message = timestamp ? `${timestamp}.${payload}` : payload;
  const data = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, data);

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('verifyRunpodSignature middleware', () => {
  const TEST_SECRET = 'test-webhook-secret-32-chars-min';
  const TEST_PAYLOAD = JSON.stringify({
    jobId: 'job-123',
    status: 'completed',
  });

  let app: Hono<HonoEnv>;

  beforeEach(() => {
    app = new Hono<HonoEnv>();

    // Apply middleware and add test handler
    app.post(
      '/webhook',
      verifyRunpodSignature({ validateTimestamp: true, maxAge: 300 }),
      async (c) => {
        const rawBody = c.get('rawBody');
        return c.json({ received: true, body: rawBody });
      }
    );
  });

  it('should pass with valid signature and timestamp', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await generateSignature(
      TEST_PAYLOAD,
      TEST_SECRET,
      timestamp
    );

    const response = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'X-Runpod-Signature': signature,
          'X-Runpod-Timestamp': timestamp.toString(),
        },
        body: TEST_PAYLOAD,
      },
      {
        RUNPOD_WEBHOOK_SECRET: TEST_SECRET,
      } as unknown as HonoEnv['Bindings']
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as { received: boolean; body: string };
    expect(json.received).toBe(true);
    expect(json.body).toBe(TEST_PAYLOAD);
  });

  it('should reject with missing signature header', async () => {
    const timestamp = Math.floor(Date.now() / 1000);

    const response = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'X-Runpod-Timestamp': timestamp.toString(),
        },
        body: TEST_PAYLOAD,
      },
      {
        RUNPOD_WEBHOOK_SECRET: TEST_SECRET,
      } as unknown as HonoEnv['Bindings']
    );

    expect(response.status).toBe(401);
    const json = (await response.json()) as ErrorResponse;
    expect(json.error.code).toBe('MISSING_SIGNATURE');
  });

  it('should reject with missing timestamp header', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await generateSignature(
      TEST_PAYLOAD,
      TEST_SECRET,
      timestamp
    );

    const response = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'X-Runpod-Signature': signature,
          // Missing timestamp header
        },
        body: TEST_PAYLOAD,
      },
      {
        RUNPOD_WEBHOOK_SECRET: TEST_SECRET,
      } as unknown as HonoEnv['Bindings']
    );

    expect(response.status).toBe(401);
    const json = (await response.json()) as ErrorResponse;
    expect(json.error.code).toBe('MISSING_TIMESTAMP');
  });

  it('should reject with invalid signature', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const invalidSignature = 'a'.repeat(64); // Valid format but wrong signature

    const response = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'X-Runpod-Signature': invalidSignature,
          'X-Runpod-Timestamp': timestamp.toString(),
        },
        body: TEST_PAYLOAD,
      },
      {
        RUNPOD_WEBHOOK_SECRET: TEST_SECRET,
      } as unknown as HonoEnv['Bindings']
    );

    expect(response.status).toBe(401);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INVALID_SIGNATURE');
  });

  it('should reject with malformed signature format', async () => {
    const timestamp = Math.floor(Date.now() / 1000);

    const response = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'X-Runpod-Signature': 'not-a-valid-hex-string',
          'X-Runpod-Timestamp': timestamp.toString(),
        },
        body: TEST_PAYLOAD,
      },
      {
        RUNPOD_WEBHOOK_SECRET: TEST_SECRET,
      } as unknown as HonoEnv['Bindings']
    );

    expect(response.status).toBe(401);
    const json = (await response.json()) as ErrorResponse;
    expect(json.error.code).toBe('INVALID_SIGNATURE');
  });

  it('should reject with expired timestamp', async () => {
    // Timestamp from 10 minutes ago (exceeds 5 minute max age)
    const expiredTimestamp = Math.floor(Date.now() / 1000) - 600;
    const signature = await generateSignature(
      TEST_PAYLOAD,
      TEST_SECRET,
      expiredTimestamp
    );

    const response = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'X-Runpod-Signature': signature,
          'X-Runpod-Timestamp': expiredTimestamp.toString(),
        },
        body: TEST_PAYLOAD,
      },
      {
        RUNPOD_WEBHOOK_SECRET: TEST_SECRET,
      } as unknown as HonoEnv['Bindings']
    );

    expect(response.status).toBe(401);
    const json = (await response.json()) as ErrorResponse;
    expect(json.error.code).toBe('TIMESTAMP_EXPIRED');
  });

  it('should reject with future timestamp', async () => {
    // Timestamp 5 minutes in the future (exceeds 60 second tolerance)
    const futureTimestamp = Math.floor(Date.now() / 1000) + 300;
    const signature = await generateSignature(
      TEST_PAYLOAD,
      TEST_SECRET,
      futureTimestamp
    );

    const response = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'X-Runpod-Signature': signature,
          'X-Runpod-Timestamp': futureTimestamp.toString(),
        },
        body: TEST_PAYLOAD,
      },
      {
        RUNPOD_WEBHOOK_SECRET: TEST_SECRET,
      } as unknown as HonoEnv['Bindings']
    );

    expect(response.status).toBe(401);
    const json = (await response.json()) as ErrorResponse;
    expect(json.error.code).toBe('TIMESTAMP_FUTURE');
  });

  it('should reject with tampered payload', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    // Sign with original payload
    const signature = await generateSignature(
      TEST_PAYLOAD,
      TEST_SECRET,
      timestamp
    );
    // Send with different payload
    const tamperedPayload = JSON.stringify({
      jobId: 'job-456',
      status: 'failed',
    });

    const response = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'X-Runpod-Signature': signature,
          'X-Runpod-Timestamp': timestamp.toString(),
        },
        body: tamperedPayload,
      },
      {
        RUNPOD_WEBHOOK_SECRET: TEST_SECRET,
      } as unknown as HonoEnv['Bindings']
    );

    expect(response.status).toBe(401);
    const json = (await response.json()) as ErrorResponse;
    expect(json.error.code).toBe('INVALID_SIGNATURE');
  });

  it('should reject when secret is not configured', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await generateSignature(
      TEST_PAYLOAD,
      TEST_SECRET,
      timestamp
    );

    const response = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'X-Runpod-Signature': signature,
          'X-Runpod-Timestamp': timestamp.toString(),
        },
        body: TEST_PAYLOAD,
      },
      {
        // RUNPOD_WEBHOOK_SECRET not set
      } as unknown as HonoEnv['Bindings']
    );

    expect(response.status).toBe(500);
    const json = (await response.json()) as ErrorResponse;
    expect(json.error.code).toBe('CONFIGURATION_ERROR');
  });
});
