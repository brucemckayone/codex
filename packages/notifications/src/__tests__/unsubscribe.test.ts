import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../unsubscribe';

const TEST_SECRET = 'test-unsubscribe-secret-key-for-testing';

describe('Unsubscribe Token Utility', () => {
  describe('generateUnsubscribeToken', () => {
    it('produces a string with two dot-separated base64url parts', async () => {
      const token = await generateUnsubscribeToken(
        { userId: 'user-1', category: 'marketing' },
        TEST_SECRET
      );

      const parts = token.split('.');
      expect(parts).toHaveLength(2);

      // Both parts should be valid base64url (no +, /, or = characters)
      for (const part of parts) {
        expect(part).not.toMatch(/[+/=]/);
        expect(part.length).toBeGreaterThan(0);
      }
    });

    it('generates different tokens for different userIds', async () => {
      const token1 = await generateUnsubscribeToken(
        { userId: 'user-1', category: 'marketing' },
        TEST_SECRET
      );
      const token2 = await generateUnsubscribeToken(
        { userId: 'user-2', category: 'marketing' },
        TEST_SECRET
      );

      expect(token1).not.toBe(token2);
    });

    it('generates different tokens for different categories', async () => {
      const token1 = await generateUnsubscribeToken(
        { userId: 'user-1', category: 'marketing' },
        TEST_SECRET
      );
      const token2 = await generateUnsubscribeToken(
        { userId: 'user-1', category: 'digest' },
        TEST_SECRET
      );

      expect(token1).not.toBe(token2);
    });
  });

  describe('verifyUnsubscribeToken', () => {
    it('returns valid payload for freshly generated token', async () => {
      const token = await generateUnsubscribeToken(
        { userId: 'user-abc', category: 'marketing' },
        TEST_SECRET
      );

      const result = await verifyUnsubscribeToken(token, TEST_SECRET);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-abc');
      expect(result!.category).toBe('marketing');
      expect(typeof result!.expiresAt).toBe('number');
      expect(result!.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('roundtrip: marketing category preserved through generate-verify', async () => {
      const token = await generateUnsubscribeToken(
        { userId: 'user-mkt', category: 'marketing' },
        TEST_SECRET
      );

      const result = await verifyUnsubscribeToken(token, TEST_SECRET);

      expect(result).not.toBeNull();
      expect(result!.category).toBe('marketing');
      expect(result!.userId).toBe('user-mkt');
    });

    it('roundtrip: digest category preserved through generate-verify', async () => {
      const token = await generateUnsubscribeToken(
        { userId: 'user-dgst', category: 'digest' },
        TEST_SECRET
      );

      const result = await verifyUnsubscribeToken(token, TEST_SECRET);

      expect(result).not.toBeNull();
      expect(result!.category).toBe('digest');
      expect(result!.userId).toBe('user-dgst');
    });

    it('returns null for tampered payload (modified base64)', async () => {
      const token = await generateUnsubscribeToken(
        { userId: 'user-1', category: 'marketing' },
        TEST_SECRET
      );

      const [payloadB64, sigB64] = token.split('.');
      // Flip a character in the payload portion
      const tampered =
        payloadB64.charAt(0) === 'A'
          ? `B${payloadB64.slice(1)}`
          : `A${payloadB64.slice(1)}`;

      const result = await verifyUnsubscribeToken(
        `${tampered}.${sigB64}`,
        TEST_SECRET
      );
      expect(result).toBeNull();
    });

    it('returns null for tampered signature', async () => {
      const token = await generateUnsubscribeToken(
        { userId: 'user-1', category: 'marketing' },
        TEST_SECRET
      );

      const [payloadB64, sigB64] = token.split('.');
      // Flip a character in the signature portion
      const tampered =
        sigB64.charAt(0) === 'A'
          ? `B${sigB64.slice(1)}`
          : `A${sigB64.slice(1)}`;

      const result = await verifyUnsubscribeToken(
        `${payloadB64}.${tampered}`,
        TEST_SECRET
      );
      expect(result).toBeNull();
    });

    it('returns null for expired token', async () => {
      vi.useFakeTimers();

      try {
        const token = await generateUnsubscribeToken(
          { userId: 'user-exp', category: 'marketing' },
          TEST_SECRET,
          1 // 1 day expiry
        );

        // Advance time by 2 days (past the 1-day expiry)
        vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);

        const result = await verifyUnsubscribeToken(token, TEST_SECRET);
        expect(result).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns null for invalid format (no dot)', async () => {
      const result = await verifyUnsubscribeToken('nodottoken', TEST_SECRET);
      expect(result).toBeNull();
    });

    it('returns null for empty string', async () => {
      const result = await verifyUnsubscribeToken('', TEST_SECRET);
      expect(result).toBeNull();
    });
  });
});
