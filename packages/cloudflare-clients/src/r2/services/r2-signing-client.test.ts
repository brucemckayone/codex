/**
 * R2 Signing Client Integration Tests
 *
 * These tests verify that R2 presigned URL generation works correctly
 * against the real R2 test bucket using credentials from .env.test.
 *
 * Test coverage:
 * - Client creation from environment variables
 * - Presigned URL generation format validation
 * - URL signature verification (contains required query params)
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  createR2SigningClientFromEnv,
  R2SigningClient,
} from './r2-signing-client';

describe('R2SigningClient', () => {
  let client: R2SigningClient;

  beforeAll(() => {
    // Uses R2 credentials from .env.test (loaded by vitest.setup.ts)
    client = createR2SigningClientFromEnv();
  });

  describe('createR2SigningClientFromEnv', () => {
    it('should create client from environment variables', () => {
      expect(client).toBeInstanceOf(R2SigningClient);
      expect(client.getBucketName()).toBe(process.env.R2_BUCKET_MEDIA);
    });

    it('should throw if environment variables are missing', () => {
      const originalAccountId = process.env.R2_ACCOUNT_ID;
      delete process.env.R2_ACCOUNT_ID;

      expect(() => createR2SigningClientFromEnv()).toThrow(
        'Missing R2 environment variables'
      );

      process.env.R2_ACCOUNT_ID = originalAccountId;
    });
  });

  describe('generateSignedUrl', () => {
    it('should generate a valid presigned URL', async () => {
      const r2Key = 'test/sample-video.mp4';
      const expirySeconds = 3600;

      const signedUrl = await client.generateSignedUrl(r2Key, expirySeconds);

      // Verify URL structure
      expect(signedUrl).toContain('r2.cloudflarestorage.com');
      expect(signedUrl).toContain(process.env.R2_BUCKET_MEDIA);
      expect(signedUrl).toContain(
        encodeURIComponent(r2Key).replace(/%2F/g, '/')
      );

      // Verify AWS signature v4 query parameters
      const url = new URL(signedUrl);
      expect(url.searchParams.has('X-Amz-Algorithm')).toBe(true);
      expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(url.searchParams.has('X-Amz-Credential')).toBe(true);
      expect(url.searchParams.has('X-Amz-Date')).toBe(true);
      expect(url.searchParams.has('X-Amz-Expires')).toBe(true);
      expect(url.searchParams.get('X-Amz-Expires')).toBe(String(expirySeconds));
      expect(url.searchParams.has('X-Amz-Signature')).toBe(true);
      expect(url.searchParams.has('X-Amz-SignedHeaders')).toBe(true);
    });

    it('should generate different signatures for different keys', async () => {
      const url1 = await client.generateSignedUrl('video1.mp4', 3600);
      const url2 = await client.generateSignedUrl('video2.mp4', 3600);

      const sig1 = new URL(url1).searchParams.get('X-Amz-Signature');
      const sig2 = new URL(url2).searchParams.get('X-Amz-Signature');

      expect(sig1).not.toBe(sig2);
    });

    it('should respect expiry time in URL', async () => {
      const shortExpiry = await client.generateSignedUrl('test.mp4', 300);
      const longExpiry = await client.generateSignedUrl('test.mp4', 86400);

      expect(new URL(shortExpiry).searchParams.get('X-Amz-Expires')).toBe(
        '300'
      );
      expect(new URL(longExpiry).searchParams.get('X-Amz-Expires')).toBe(
        '86400'
      );
    });

    it('should handle nested paths in r2Key', async () => {
      const nestedKey = 'creator-123/hls/media-456/master.m3u8';
      const signedUrl = await client.generateSignedUrl(nestedKey, 3600);

      expect(signedUrl).toContain('creator-123');
      expect(signedUrl).toContain('master.m3u8');
    });
  });

  describe('objectExists', () => {
    it('should return false for non-existent objects', async () => {
      const exists = await client.objectExists(
        'definitely-does-not-exist-12345.mp4'
      );
      expect(exists).toBe(false);
    });

    // Note: To test objectExists returning true, we'd need to upload a test file first.
    // That can be added when we have upload functionality in the test suite.
  });
});
