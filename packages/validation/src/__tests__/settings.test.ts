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
  staysInOneDeclaration,
  TOKEN_OVERRIDE_MAX_ENTRIES,
  TOKEN_OVERRIDE_VALUE_MAX,
} from '../schemas/brand-tokens';
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
        expect(hexColorSchema.parse(color)).toBe(color.toLocaleUpperCase());
      });
    });

    it('should accept mixed case hex colors', () => {
      expect(hexColorSchema.parse('#aAbBcC')).toBe('#AABBCC');
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
      expect(logoMimeTypeSchema.parse('image/svg+xml')).toBe('image/svg+xml');
    });
  });

  describe('invalid MIME types', () => {
    it('should reject non-image MIME types', () => {
      expect(() => logoMimeTypeSchema.parse('application/pdf')).toThrow(
        'Invalid option'
      );
      expect(() => logoMimeTypeSchema.parse('text/html')).toThrow(
        'Invalid option'
      );
    });

    it('should reject unsupported image formats', () => {
      expect(() => logoMimeTypeSchema.parse('image/gif')).toThrow(
        'Invalid option'
      );
      expect(() => logoMimeTypeSchema.parse('image/bmp')).toThrow(
        'Invalid option'
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

describe('updateBrandingSchema token overrides (Codex-403d3)', () => {
  type Field = 'tokenOverrides' | 'darkTokenOverrides';

  /** Each issue's path, or [] when the value is accepted. */
  function problems(field: Field, value: unknown) {
    const result = updateBrandingSchema.safeParse({ [field]: value });
    return result.success ? [] : result.error.issues.map((issue) => issue.path);
  }

  /** What the brand editor writes: its own keys and value shapes. */
  const EDITOR_MAP = {
    'heading-color': '#1A2B3C',
    'shader-preset': 'haze',
    'shader-intensity': '0.60',
    'font-body': 'Playfair Display',
    'hero-hide-title': 'true',
    'hero-title-blend': 'normal',
    'text-scale': null,
  };

  it.each<Field>([
    'tokenOverrides',
    'darkTokenOverrides',
  ])('accepts what the brand editor saves (%s)', (field) => {
    expect(problems(field, JSON.stringify(EDITOR_MAP))).toEqual([]);
  });

  it.each([
    ['an rgba() colour', 'rgba(0, 0, 0, 0.1)'],
    ['an oklch() colour', 'oklch(0.3 0.02 250 / 0.4)'],
    ['a color-mix()', 'color-mix(in oklch, #fff 20%, transparent)'],
    ['calc() over var()', 'calc(var(--space-2) * 1.5)'],
    ['a quoted family list', '"Playfair Display", serif'],
    ['a family with a bracketed word', 'Foo Sans (Display)'],
    ['a stored number', 1.2],
  ])('accepts %s, as older stored colours and numbers hold', (_l, value) => {
    expect(
      problems('tokenOverrides', JSON.stringify({ 'shadow-color': value }))
    ).toEqual([]);
  });

  it('accepts a clear: null, an empty string, or nothing', () => {
    expect(problems('tokenOverrides', null)).toEqual([]);
    expect(problems('tokenOverrides', '')).toEqual([]);
    expect(updateBrandingSchema.parse({})).toEqual({});
  });

  it('passes stored text that is not JSON back unchanged (Codex-cijzb)', () => {
    // The brand page re-sends a stored map it could not read, so a failed
    // read can't blank it. Nothing renders it: every reader parses it first.
    expect(updateBrandingSchema.parse({ tokenOverrides: '{not json' })).toEqual(
      { tokenOverrides: '{not json' }
    );
  });

  it.each([
    ['a value that starts a new declaration', 'heading-color', 'red; scale: 3'],
    ['a key that carries a declaration', 'x; position: fixed', 'red'],
    ['a camelCase key', 'headingColor', 'red'],
    ['the reserved logo key', 'shader-logo-url', 'https://pub-a.r2.dev/l.svg'],
    ['a url()', 'heading-color', 'url(https://evil.example/x.png)'],
    ['a URL( in capitals', 'heading-color', 'URL(https://evil.example/x.png)'],
    ['an image-set()', 'surface', 'image-set("https://pub-a.r2.dev/p.png" 1x)'],
    [
      'a -webkit-image-set()',
      'surface',
      '-webkit-image-set("https://x/p.png" 1x)',
    ],
    ['a cross-fade()', 'surface', 'cross-fade("https://x/a.png", red 50%)'],
    ['a src()', 'surface', 'src("https://x/p.png")'],
    ['an image()', 'surface', 'image("https://x/p.png")'],
    ['an element()', 'surface', 'element(#hero)'],
    ['an expression()', 'heading-color', 'expression(alert(1))'],
    ['an @import', 'heading-color', '@import "x.css"'],
    ['an opening brace', 'heading-color', 'red{'],
    ['a closing brace', 'heading-color', 'red}'],
    ['an opening angle bracket', 'heading-color', 'red<'],
    ['a closing angle bracket', 'heading-color', 'red>'],
    ['a comment', 'heading-color', 'red /* x */'],
    ['an unclosed single quote', 'glass-tint', "'unclosed"],
    ['an unclosed double quote', 'glass-tint', '"unclosed'],
    ['an unclosed bracket', 'heading-color', 'calc(1px + 2px'],
    ['a stray closing bracket', 'heading-color', 'red)'],
    ['a mismatched bracket', 'heading-color', 'calc(1px]'],
    ['an unclosed square bracket', 'heading-color', 'red ['],
    ['a font family with quotes', 'font-body', '"Inter"'],
    ['a dark-font name with quotes', 'font-heading', 'a"b\'c"d'],
    ['a backslash escape', 'heading-color', 'red\\3b position: fixed'],
    ['a control character', 'heading-color', 'red\n'],
    ['a value over 200 characters', 'heading-color', 'a'.repeat(201)],
    ['a boolean', 'text-scale', true],
    ['an object', 'heading-color', { nested: 'red' }],
  ])('refuses %s, naming its key', (_label, key, value) => {
    const map = { 'shader-preset': 'haze', [key]: value };
    expect(problems('tokenOverrides', JSON.stringify(map))).toEqual([
      ['tokenOverrides', key],
    ]);
  });

  it('refuses a number JSON cannot hold finitely', () => {
    expect(problems('tokenOverrides', '{"text-scale": 1e400}')).toEqual([
      ['tokenOverrides', 'text-scale'],
    ]);
  });

  it('applies the same rule to the dark map, the logo key included', () => {
    const map = {
      'heading-color': 'red; position: fixed',
      'shader-logo-url': 'https://pub-a.r2.dev/l.svg',
    };
    expect(problems('darkTokenOverrides', JSON.stringify(map))).toEqual([
      ['darkTokenOverrides', 'heading-color'],
      ['darkTokenOverrides', 'shader-logo-url'],
    ]);
  });

  it('keeps a value of exactly 200 characters', () => {
    const map = { 'heading-color': 'a'.repeat(200) };
    expect(problems('tokenOverrides', JSON.stringify(map))).toEqual([]);
  });

  it.each([
    '[]',
    '"red"',
    '5',
    'null',
  ])('refuses JSON that is not an object: %s', (json) => {
    expect(problems('tokenOverrides', json)).toEqual([['tokenOverrides']]);
  });

  it('reads a worst-case value in one pass, so a crafted map costs no seconds', () => {
    // A long name, a space, then empty brackets: each bracket's name is
    // empty, so the value passes. A backward regex per bracket took about
    // 1.5 ms on it, and 1.4 s for a full map, on every render (review r3).
    const worst = `${'a'.repeat(132)} ${'()'.repeat(33)}`;
    expect(worst.length).toBeLessThanOrEqual(TOKEN_OVERRIDE_VALUE_MAX);
    expect(staysInOneDeclaration(worst)).toBe(true);
    const map = JSON.stringify(
      Object.fromEntries(
        Array.from({ length: TOKEN_OVERRIDE_MAX_ENTRIES }, (_, i) => [
          `key-${i}`,
          worst,
        ])
      )
    );
    const started = performance.now();
    expect(problems('tokenOverrides', map)).toEqual([]);
    // One pass takes milliseconds; the bound leaves room for a slow runner.
    expect(performance.now() - started).toBeLessThan(400);
  });

  it('refuses a map past the entry limit, and keeps one at it', () => {
    const map = (size: number) =>
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: size }, (_, i) => [`key-${i}`, 'red'])
        )
      );
    expect(problems('tokenOverrides', map(TOKEN_OVERRIDE_MAX_ENTRIES))).toEqual(
      []
    );
    expect(
      problems('tokenOverrides', map(TOKEN_OVERRIDE_MAX_ENTRIES + 1))
    ).toEqual([['tokenOverrides']]);
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
        secondaryColorHex: null,
        accentColorHex: null,
        backgroundColorHex: null,
        fontBody: null,
        fontHeading: null,
        radiusValue: 0.5,
        densityValue: 1,
        introVideoMediaItemId: null,
        tokenOverrides: null,
        darkModeOverrides: null,
        darkTokenOverrides: null,
        heroLayout: 'default',
        pricingFaq: null,
      };
      expect(brandingSettingsSchema.parse(valid)).toEqual(valid);
    });

    it('should accept null logoUrl', () => {
      const valid = {
        logoUrl: null,
        primaryColorHex: '#3B82F6',
        secondaryColorHex: null,
        accentColorHex: null,
        backgroundColorHex: null,
        fontBody: null,
        fontHeading: null,
        radiusValue: 0.5,
        densityValue: 1,
        introVideoMediaItemId: null,
        tokenOverrides: null,
        darkModeOverrides: null,
        darkTokenOverrides: null,
        heroLayout: 'default',
        pricingFaq: null,
      };
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
      const valid = {
        enableSignups: true,
        enablePurchases: true,
        enableSubscriptions: false,
      };
      expect(featureSettingsSchema.parse(valid)).toEqual(valid);
    });
  });

  describe('allSettingsSchema', () => {
    it('should validate combined settings response', () => {
      const valid = {
        branding: {
          logoUrl: null,
          primaryColorHex: '#3B82F6',
          secondaryColorHex: null,
          accentColorHex: null,
          backgroundColorHex: null,
          fontBody: null,
          fontHeading: null,
          radiusValue: 0.5,
          densityValue: 1,
          introVideoMediaItemId: null,
          tokenOverrides: null,
          darkModeOverrides: null,
          darkTokenOverrides: null,
          heroLayout: 'default',
          pricingFaq: null,
        },
        contact: {
          platformName: 'Test',
          supportEmail: 'test@test.com',
          contactUrl: null,
          timezone: 'UTC',
        },
        features: {
          enableSignups: true,
          enablePurchases: true,
          enableSubscriptions: false,
        },
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
      secondaryColorHex: null,
      accentColorHex: null,
      backgroundColorHex: null,
      fontBody: null,
      fontHeading: null,
      radiusValue: 0.5,
      densityValue: 1,
      introVideoMediaItemId: null,
      tokenOverrides: null,
      darkModeOverrides: null,
      darkTokenOverrides: null,
      heroLayout: 'default',
      pricingFaq: null,
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
      twitterUrl: null,
      youtubeUrl: null,
      instagramUrl: null,
      tiktokUrl: null,
    });
    expect(contactSettingsSchema.parse(DEFAULT_CONTACT)).toEqual(
      DEFAULT_CONTACT
    );
  });

  it('should have valid DEFAULT_FEATURES', () => {
    expect(DEFAULT_FEATURES).toEqual({
      enableSignups: true,
      enablePurchases: true,
      enableSubscriptions: false,
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
      'image/svg+xml',
    ]);
  });

  it('should have correct max file size (5MB)', () => {
    expect(MAX_LOGO_FILE_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });
});
