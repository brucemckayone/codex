import { describe, expect, it } from 'vitest';
import { REDACTION_PRESETS, redactSensitiveData } from '../redact';

describe('redactSensitiveData', () => {
  describe('sensitive keys', () => {
    it('should redact password fields', () => {
      const data = {
        username: 'john',
        password: 'secret123',
      };

      const redacted = redactSensitiveData(data);
      expect(redacted).toEqual({
        username: 'john',
        password: '[REDACTED]',
      });
    });

    it('should redact multiple sensitive fields', () => {
      const data = {
        apiKey: 'sk_test_123',
        token: 'bearer_abc',
        secret: 'shhh',
        normalField: 'visible',
      };

      const redacted = redactSensitiveData(data);
      expect(redacted).toEqual({
        apiKey: '[REDACTED]',
        token: '[REDACTED]',
        secret: '[REDACTED]',
        normalField: 'visible',
      });
    });

    it('should handle case-insensitive key matching', () => {
      const data = {
        PASSWORD: 'secret',
        ApiKey: 'key123',
        SESSION_ID: 'sess',
      };

      const redacted = redactSensitiveData(data);
      expect(redacted).toEqual({
        PASSWORD: '[REDACTED]',
        ApiKey: '[REDACTED]',
        SESSION_ID: '[REDACTED]',
      });
    });
  });

  describe('sensitive patterns', () => {
    it('should redact Stripe keys by pattern', () => {
      const data = {
        stripeKey: 'sk_live_abcdef123456',
        other: 'normal value',
      };

      const redacted = redactSensitiveData(data);
      expect(redacted).toEqual({
        stripeKey: '[REDACTED]',
        other: 'normal value',
      });
    });

    it('should redact database connection strings', () => {
      const data = {
        dbUrl: 'postgres://user:pass@localhost/db',
      };

      const redacted = redactSensitiveData(data);
      expect(redacted).toEqual({
        dbUrl: '[REDACTED]',
      });
    });
  });

  describe('nested objects', () => {
    it('should redact nested sensitive fields', () => {
      const data = {
        user: {
          name: 'John',
          credentials: {
            password: 'secret',
            apiKey: 'key123',
          },
        },
      };

      const redacted = redactSensitiveData(data);
      expect(redacted).toEqual({
        user: {
          name: 'John',
          credentials: {
            password: '[REDACTED]',
            apiKey: '[REDACTED]',
          },
        },
      });
    });
  });

  describe('arrays', () => {
    it('should redact sensitive fields in arrays', () => {
      const data = [
        { id: 1, password: 'pass1' },
        { id: 2, password: 'pass2' },
      ];

      const redacted = redactSensitiveData(data);
      expect(redacted).toEqual([
        { id: 1, password: '[REDACTED]' },
        { id: 2, password: '[REDACTED]' },
      ]);
    });
  });

  describe('modes', () => {
    it('should support mask mode with keepChars', () => {
      const data = {
        apiKey: 'sk_test_1234567890',
      };

      const redacted = redactSensitiveData(data, {
        mode: 'mask',
        keepChars: 4,
      });

      expect(redacted).toEqual({
        apiKey: 'sk_t...7890',
      });
    });

    it('should support remove mode', () => {
      const data = {
        password: 'secret',
        username: 'john',
      };

      const redacted = redactSensitiveData(data, { mode: 'remove' });
      expect(redacted).toEqual({
        username: 'john',
      });
      expect(redacted).not.toHaveProperty('password');
    });
  });

  describe('email redaction', () => {
    it('should redact emails when enabled', () => {
      const data = {
        email: 'user@example.com',
        message: 'Contact user@example.com for help',
      };

      const redacted = redactSensitiveData(data, { redactEmails: true });
      expect(redacted).toEqual({
        email: '[REDACTED]',
        message: 'Contact [REDACTED] for help',
      });
    });

    it('should not redact emails when disabled', () => {
      const data = {
        email: 'user@example.com',
      };

      const redacted = redactSensitiveData(data, { redactEmails: false });
      expect(redacted).toEqual({
        email: 'user@example.com',
      });
    });
  });

  describe('custom keys', () => {
    it('should redact custom sensitive keys', () => {
      const data = {
        internalId: '123',
        customSecret: 'secret',
      };

      const redacted = redactSensitiveData(data, {
        customKeys: ['customSecret', 'internalId'],
      });

      expect(redacted).toEqual({
        internalId: '[REDACTED]',
        customSecret: '[REDACTED]',
      });
    });
  });

  describe('presets', () => {
    it('should have development preset', () => {
      expect(REDACTION_PRESETS.development).toEqual({
        mode: 'mask',
        redactEmails: false,
        redactIPs: false,
        keepChars: 4,
      });
    });

    it('should have production preset', () => {
      expect(REDACTION_PRESETS.production).toEqual({
        mode: 'hash',
        redactEmails: true,
        redactIPs: false,
      });
    });

    it('should have gdpr preset', () => {
      expect(REDACTION_PRESETS.gdpr).toEqual({
        mode: 'remove',
        redactEmails: true,
        redactIPs: true,
      });
    });
  });

  describe('edge cases', () => {
    it('should handle null and undefined', () => {
      expect(redactSensitiveData(null)).toBe(null);
      expect(redactSensitiveData(undefined)).toBe(undefined);
    });

    it('should handle empty objects', () => {
      expect(redactSensitiveData({})).toEqual({});
    });

    it('should handle empty arrays', () => {
      expect(redactSensitiveData([])).toEqual([]);
    });

    it('should handle primitive values', () => {
      expect(redactSensitiveData('string')).toBe('string');
      expect(redactSensitiveData(123)).toBe(123);
      expect(redactSensitiveData(true)).toBe(true);
    });
  });
});
