/**
 * Settings Validation Schema Tests
 *
 * Tests for platform settings validation schemas:
 * - Branding settings (hex colors)
 * - Contact settings (email, URL, timezone)
 * - Feature settings (booleans)
 * - Logo validation constants
 */

import { describe, expect, it } from 'vitest';
import { hexColorSchema, timezoneSchema } from '../primitives';
import {
  ALLOWED_LOGO_MIME_TYPES,
  allSettingsSchema,
  brandingSettingsSchema,
  contactSettingsSchema,
  DEFAULT_BRANDING,
  DEFAULT_CONTACT,
  DEFAULT_FEATURES,
  featureSettingsSchema,
  logoMimeTypeSchema,
  MAX_LOGO_FILE_SIZE_BYTES,
  updateBrandingSchema,
  updateContactSchema,
  updateFeaturesSchema,
} from '../schemas/settings';

describe('hexColorSchema', () => {
  describe('valid hex colors', () => {
    it('should accept valid 6-character hex colors', () => {
      const validColors = [
        '#3B82F6',
        '#000000',
        '#FFFFFF',
        '#ffffff',
        '#123abc',
        '#ABC123',
      ];

      validColors.forEach((color) => {
        expect(hexColorSchema.parse(color)).toBe(color);
      });
    });

    it('should accept mixed case hex colors', () => {
      expect(hexColorSchema.parse('#aAbBcC')).toBe('#aAbBcC');
    });
  });

  describe('invalid hex colors', () => {
    it('should reject 3-character shorthand hex colors', () => {
      expect(() => hexColorSchema.parse('#fff')).toThrow(
        'Color must be hex format (#RRGGBB)'
      );
      expect(() => hexColorSchema.parse('#FFF')).toThrow(
        'Color must be hex format (#RRGGBB)'
      );
    });

    it('should reject hex colors without #', () => {
      expect(() => hexColorSchema.parse('3B82F6')).toThrow(
        'Color must be hex format (#RRGGBB)'
      );
    });

    it('should reject invalid hex characters', () => {
      expect(() => hexColorSchema.parse('#GGGGGG')).toThrow(
        'Color must be hex format (#RRGGBB)'
      );
      expect(() => hexColorSchema.parse('#ZZZZZZ')).toThrow(
        'Color must be hex format (#RRGGBB)'
      );
    });

    it('should reject hex colors with wrong length', () => {
      expect(() => hexColorSchema.parse('#12345')).toThrow(
        'Color must be hex format (#RRGGBB)'
      );
      expect(() => hexColorSchema.parse('#1234567')).toThrow(
        'Color must be hex format (#RRGGBB)'
      );
    });

    it('should reject empty string', () => {
      expect(() => hexColorSchema.parse('')).toThrow(
        'Color must be hex format (#RRGGBB)'
      );
    });

    it('should reject XSS attempts', () => {
      const xssAttempts = [
        '<script>alert(1)</script>',
        'javascript:alert(1)',
        '#000000<script>',
      ];

      xssAttempts.forEach((attempt) => {
        expect(() => hexColorSchema.parse(attempt)).toThrow();
      });
    });
  });
});

describe('timezoneSchema', () => {
  describe('valid timezones', () => {
    it('should accept common timezone identifiers', () => {
      const validTimezones = [
        'UTC',
        'America/New_York',
        'Europe/London',
        'Asia/Tokyo',
        'Australia/Sydney',
        'Pacific/Auckland',
      ];

      validTimezones.forEach((tz) => {
        expect(timezoneSchema.parse(tz)).toBe(tz);
      });
    });
  });

  describe('invalid timezones', () => {
    it('should reject empty string', () => {
      expect(() => timezoneSchema.parse('')).toThrow('Timezone is required');
    });

    it('should reject strings exceeding 100 characters', () => {
      const longString = 'A'.repeat(101);
      expect(() => timezoneSchema.parse(longString)).toThrow(
        'Timezone must be 100 characters or less'
      );
    });
  });
});

describe('logoMimeTypeSchema', () => {
  describe('valid MIME types', () => {
    it('should accept allowed image types', () => {
      expect(logoMimeTypeSchema.parse('image/png')).toBe('image/png');
      expect(logoMimeTypeSchema.parse('image/jpeg')).toBe('image/jpeg');
      expect(logoMimeTypeSchema.parse('image/webp')).toBe('image/webp');
    });
  });

  describe('invalid MIME types', () => {
    it('should reject non-image MIME types', () => {
      expect(() => logoMimeTypeSchema.parse('application/pdf')).toThrow(
        'Logo must be PNG, JPEG, or WebP format'
      );
      expect(() => logoMimeTypeSchema.parse('text/html')).toThrow(
        'Logo must be PNG, JPEG, or WebP format'
      );
    });

    it('should reject unsupported image formats', () => {
      expect(() => logoMimeTypeSchema.parse('image/gif')).toThrow(
        'Logo must be PNG, JPEG, or WebP format'
      );
      expect(() => logoMimeTypeSchema.parse('image/svg+xml')).toThrow(
        'Logo must be PNG, JPEG, or WebP format'
      );
      expect(() => logoMimeTypeSchema.parse('image/bmp')).toThrow(
        'Logo must be PNG, JPEG, or WebP format'
      );
    });
  });
});

describe('updateBrandingSchema', () => {
  it('should accept valid branding update with primaryColorHex', () => {
    const input = { primaryColorHex: '#3B82F6' };
    expect(updateBrandingSchema.parse(input)).toEqual(input);
  });

  it('should accept empty object (no updates)', () => {
    expect(updateBrandingSchema.parse({})).toEqual({});
  });

  it('should reject invalid hex color', () => {
    expect(() =>
      updateBrandingSchema.parse({ primaryColorHex: 'invalid' })
    ).toThrow('Color must be hex format (#RRGGBB)');
  });
});

describe('updateContactSchema', () => {
  describe('valid inputs', () => {
    it('should accept valid contact update with all fields', () => {
      const input = {
        platformName: 'My Platform',
        supportEmail: 'support@example.com',
        contactUrl: 'https://example.com/contact',
        timezone: 'America/New_York',
      };
      expect(updateContactSchema.parse(input)).toEqual(input);
    });

    it('should accept partial updates', () => {
      expect(updateContactSchema.parse({ platformName: 'Test' })).toEqual({
        platformName: 'Test',
      });
      expect(
        updateContactSchema.parse({ supportEmail: 'test@test.com' })
      ).toEqual({ supportEmail: 'test@test.com' });
    });

    it('should accept null contactUrl', () => {
      const input = { contactUrl: null };
      expect(updateContactSchema.parse(input)).toEqual(input);
    });

    it('should accept empty object', () => {
      expect(updateContactSchema.parse({})).toEqual({});
    });
  });

  describe('email validation', () => {
    it('should accept valid email formats', () => {
      const validEmails = [
        'user@example.com',
        'user.name@example.com',
        'user+tag@example.com',
        'user@subdomain.example.com',
      ];

      validEmails.forEach((email) => {
        expect(updateContactSchema.parse({ supportEmail: email })).toEqual({
          supportEmail: email,
        });
      });
    });

    it('should reject invalid email formats', () => {
      const invalidEmails = [
        'notanemail',
        'missing@domain',
        '@nodomain.com',
        'spaces in@email.com',
      ];

      invalidEmails.forEach((email) => {
        expect(() =>
          updateContactSchema.parse({ supportEmail: email })
        ).toThrow('Invalid email format');
      });
    });
  });

  describe('URL validation', () => {
    it('should accept valid HTTP/HTTPS URLs', () => {
      const validUrls = [
        'https://example.com',
        'http://example.com',
        'https://subdomain.example.com/path',
      ];

      validUrls.forEach((url) => {
        expect(updateContactSchema.parse({ contactUrl: url })).toEqual({
          contactUrl: url,
        });
      });
    });

    it('should reject non-HTTP/HTTPS URLs', () => {
      expect(() =>
        updateContactSchema.parse({ contactUrl: 'ftp://example.com' })
      ).toThrow();
      expect(() =>
        updateContactSchema.parse({ contactUrl: 'javascript:alert(1)' })
      ).toThrow();
    });

    it('should reject invalid URLs', () => {
      expect(() =>
        updateContactSchema.parse({ contactUrl: 'not a url' })
      ).toThrow();
    });
  });

  describe('platformName validation', () => {
    it('should trim whitespace', () => {
      const result = updateContactSchema.parse({
        platformName: '  My Platform  ',
      });
      expect(result.platformName).toBe('My Platform');
    });

    it('should reject empty platform name', () => {
      expect(() => updateContactSchema.parse({ platformName: '' })).toThrow(
        'Platform name is required'
      );
    });

    it('should reject platform name exceeding 100 characters', () => {
      const longName = 'A'.repeat(101);
      expect(() =>
        updateContactSchema.parse({ platformName: longName })
      ).toThrow('Platform name must be 100 characters or less');
    });
  });
});

describe('updateFeaturesSchema', () => {
  it('should accept valid feature toggles', () => {
    expect(
      updateFeaturesSchema.parse({
        enableSignups: true,
        enablePurchases: false,
      })
    ).toEqual({ enableSignups: true, enablePurchases: false });
  });

  it('should accept partial updates', () => {
    expect(updateFeaturesSchema.parse({ enableSignups: true })).toEqual({
      enableSignups: true,
    });
    expect(updateFeaturesSchema.parse({ enablePurchases: false })).toEqual({
      enablePurchases: false,
    });
  });

  it('should accept empty object', () => {
    expect(updateFeaturesSchema.parse({})).toEqual({});
  });

  it('should reject non-boolean values', () => {
    expect(() =>
      updateFeaturesSchema.parse({ enableSignups: 'true' })
    ).toThrow();
    expect(() => updateFeaturesSchema.parse({ enablePurchases: 1 })).toThrow();
  });
});

describe('response schemas', () => {
  describe('brandingSettingsSchema', () => {
    it('should validate branding response shape', () => {
      const valid = {
        logoUrl: 'https://example.com/logo.png',
        primaryColorHex: '#3B82F6',
      };
      expect(brandingSettingsSchema.parse(valid)).toEqual(valid);
    });

    it('should accept null logoUrl', () => {
      const valid = { logoUrl: null, primaryColorHex: '#3B82F6' };
      expect(brandingSettingsSchema.parse(valid)).toEqual(valid);
    });
  });

  describe('contactSettingsSchema', () => {
    it('should validate contact response shape', () => {
      const valid = {
        platformName: 'Test',
        supportEmail: 'test@test.com',
        contactUrl: 'https://test.com',
        timezone: 'UTC',
      };
      expect(contactSettingsSchema.parse(valid)).toEqual(valid);
    });

    it('should accept null contactUrl', () => {
      const valid = {
        platformName: 'Test',
        supportEmail: 'test@test.com',
        contactUrl: null,
        timezone: 'UTC',
      };
      expect(contactSettingsSchema.parse(valid)).toEqual(valid);
    });
  });

  describe('featureSettingsSchema', () => {
    it('should validate feature response shape', () => {
      const valid = { enableSignups: true, enablePurchases: true };
      expect(featureSettingsSchema.parse(valid)).toEqual(valid);
    });
  });

  describe('allSettingsSchema', () => {
    it('should validate combined settings response', () => {
      const valid = {
        branding: { logoUrl: null, primaryColorHex: '#3B82F6' },
        contact: {
          platformName: 'Test',
          supportEmail: 'test@test.com',
          contactUrl: null,
          timezone: 'UTC',
        },
        features: { enableSignups: true, enablePurchases: true },
      };
      expect(allSettingsSchema.parse(valid)).toEqual(valid);
    });
  });
});

describe('default constants', () => {
  it('should have valid DEFAULT_BRANDING', () => {
    expect(DEFAULT_BRANDING).toEqual({
      logoUrl: null,
      primaryColorHex: '#3B82F6',
    });
    expect(brandingSettingsSchema.parse(DEFAULT_BRANDING)).toEqual(
      DEFAULT_BRANDING
    );
  });

  it('should have valid DEFAULT_CONTACT', () => {
    expect(DEFAULT_CONTACT).toEqual({
      platformName: 'Codex Platform',
      supportEmail: 'support@example.com',
      contactUrl: null,
      timezone: 'UTC',
    });
    expect(contactSettingsSchema.parse(DEFAULT_CONTACT)).toEqual(
      DEFAULT_CONTACT
    );
  });

  it('should have valid DEFAULT_FEATURES', () => {
    expect(DEFAULT_FEATURES).toEqual({
      enableSignups: true,
      enablePurchases: true,
    });
    expect(featureSettingsSchema.parse(DEFAULT_FEATURES)).toEqual(
      DEFAULT_FEATURES
    );
  });
});

describe('logo validation constants', () => {
  it('should have correct allowed MIME types', () => {
    expect(ALLOWED_LOGO_MIME_TYPES).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
    ]);
  });

  it('should have correct max file size (5MB)', () => {
    expect(MAX_LOGO_FILE_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });
});
