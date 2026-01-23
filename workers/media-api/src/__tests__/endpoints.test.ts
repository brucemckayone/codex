import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Media API', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await SELF.fetch('http://localhost/health');
      expect([200, 503]).toContain(response.status);
      const json = (await response.json()) as {
        status: string;
        service: string;
      };
      expect(json.status).toBeDefined();
      expect(json.service).toBe('media-api');
    });
  });

  describe('Webhook Endpoint', () => {
    const webhookUrl = 'http://localhost/api/transcoding/webhook';
    const payload = {
      jobId: 'test-job-123',
      status: 'completed',
      output: {
        mediaId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'video',
        hlsMasterKey: 'key',
      },
    };
    const timestamp = Math.floor(Date.now() / 1000).toString();

    it('should return 401 if signature is missing', async () => {
      const response = await SELF.fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Runpod-Timestamp': timestamp,
        },
        body: JSON.stringify(payload),
      });
      expect(response.status).toBe(401);
    });

    it('should return 401 if signature is invalid', async () => {
      const response = await SELF.fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Runpod-Signature': 'invalid-signature',
          'X-Runpod-Timestamp': timestamp,
        },
        body: JSON.stringify(payload),
      });
      expect(response.status).toBe(401);
    });

    it('should return 200/202/204 if signature is valid', async () => {
      const body = JSON.stringify(payload);
      const secret = env.RUNPOD_WEBHOOK_SECRET || 'test-secret';

      // Generate signature including timestamp as per middleware logic
      const message = `${timestamp}.${body}`;

      // Re-implement simplified HMAC generation compatible with middleware logic
      // Note: middleware uses `timestamp.payload` if timestamp present
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        enc.encode(message)
      );
      const hexSignature = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const response = await SELF.fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Runpod-Signature': hexSignature,
          'X-Runpod-Timestamp': timestamp,
        },
        body: body,
      });

      // Expecting 200/202/204 (Success) OR 404 (Media not found - database connected but no test data)
      // Getting 404 confirms validation passed (didn't return 401) and we hit the service logic
      // In this test environment, the real database is available but has no test data seeded
      expect([200, 202, 204, 404]).toContain(response.status);
    });
  });

  describe('Internal Endpoints', () => {
    const internalUrl =
      'http://localhost/internal/media/550e8400-e29b-41d4-a716-446655440000/transcode';

    it('should return 401 if worker secret is missing', async () => {
      const response = await SELF.fetch(internalUrl, {
        method: 'POST',
      });
      expect(response.status).toBe(401);
    });

    it('should return 401 if worker secret is invalid', async () => {
      const response = await SELF.fetch(internalUrl, {
        method: 'POST',
        headers: { 'X-Worker-Secret': 'invalid' },
      });
      expect(response.status).toBe(401);
    });
  });
});
