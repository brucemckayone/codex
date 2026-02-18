import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  bioSchema,
  socialLinksSchema,
  updateProfileSchema,
  usernameSchema,
} from '../identity/user-schema';

describe('Username Schema', () => {
  it('should accept valid usernames', () => {
    expect(usernameSchema.parse('valid-username')).toBe('valid-username');
    expect(usernameSchema.parse('user123')).toBe('user123');
    expect(usernameSchema.parse('test-user-2024')).toBe('test-user-2024');
  });

  it('should transform to lowercase', () => {
    expect(usernameSchema.parse('Test-User')).toBe('test-user');
    expect(usernameSchema.parse('TESTUSER')).toBe('testuser');
    expect(usernameSchema.parse('TeSt-UsEr-123')).toBe('test-user-123');
  });

  it('should trim whitespace', () => {
    expect(usernameSchema.parse('  test-user  ')).toBe('test-user');
  });

  it('should reject empty strings', () => {
    expect(() => usernameSchema.parse('')).toThrow();
  });

  it('should reject usernames exceeding 50 characters', () => {
    const longUsername = 'a'.repeat(51);
    expect(() => usernameSchema.parse(longUsername)).toThrow();
  });

  it('should reject invalid characters (underscores, spaces, special chars)', () => {
    expect(() => usernameSchema.parse('invalid_username')).toThrow();
    expect(() => usernameSchema.parse('invalid username')).toThrow();
    expect(() => usernameSchema.parse('invalid.username')).toThrow();
    expect(() => usernameSchema.parse('invalid@username')).toThrow();
  });

  it('should reject undefined (not optional)', () => {
    expect(usernameSchema.safeParse(undefined)).toMatchObject({
      success: false,
    });
  });
});

describe('Bio Schema', () => {
  it('should accept valid bio text', () => {
    expect(bioSchema.parse('This is my bio')).toBe('This is my bio');
    // Empty string stays as empty string
    expect(bioSchema.parse('')).toBe('');
  });

  it('should accept null', () => {
    expect(bioSchema.parse(null)).toBeNull();
  });

  it('should accept undefined', () => {
    expect(bioSchema.parse(undefined)).toBeUndefined();
  });

  it('should reject bio exceeding 500 characters', () => {
    const longBio = 'a'.repeat(501);
    expect(() => bioSchema.parse(longBio)).toThrow();
  });

  it('should accept bio exactly at 500 character limit', () => {
    const maxBio = 'a'.repeat(500);
    expect(bioSchema.parse(maxBio)).toBe(maxBio);
  });
});

describe('Social Links Schema', () => {
  it('should accept valid URLs', () => {
    const result = socialLinksSchema.parse({
      website: 'https://example.com',
      twitter: 'https://twitter.com/user',
      youtube: 'https://youtube.com/channel/test',
      instagram: 'https://instagram.com/user',
    });

    expect(result.website).toBe('https://example.com');
    expect(result.twitter).toBe('https://twitter.com/user');
    expect(result.youtube).toBe('https://youtube.com/channel/test');
    expect(result.instagram).toBe('https://instagram.com/user');
  });

  it('should accept partial social links', () => {
    const result = socialLinksSchema.parse({
      website: 'https://example.com',
    });

    expect(result.website).toBe('https://example.com');
    expect(result.twitter).toBeUndefined();
  });

  it('should accept empty object', () => {
    const result = socialLinksSchema.parse({});
    expect(result).toEqual({});
  });

  it('should accept undefined', () => {
    expect(socialLinksSchema.parse(undefined)).toBeUndefined();
  });

  it('should reject javascript: URLs (XSS prevention)', () => {
    expect(() =>
      socialLinksSchema.parse({ website: 'javascript:alert(1)' })
    ).toThrow();
    expect(() =>
      socialLinksSchema.parse({ twitter: 'javascript:void(0)' })
    ).toThrow();
  });

  it('should reject data: URLs', () => {
    expect(() =>
      socialLinksSchema.parse({ website: 'data:text/html,<script>' })
    ).toThrow();
  });

  it('should reject invalid URLs', () => {
    expect(() => socialLinksSchema.parse({ website: 'not-a-url' })).toThrow();
    expect(() =>
      socialLinksSchema.parse({ twitter: 'htp://invalid' })
    ).toThrow();
  });
});

describe('Update Profile Schema', () => {
  it('should accept partial updates with displayName only', () => {
    const result = updateProfileSchema.parse({
      displayName: 'New Name',
    });

    expect(result.displayName).toBe('New Name');
    expect(result.email).toBeUndefined();
    expect(result.username).toBeUndefined();
  });

  it('should accept partial updates with email only', () => {
    const result = updateProfileSchema.parse({
      email: 'user@example.com',
    });

    expect(result.email).toBe('user@example.com');
    expect(result.displayName).toBeUndefined();
  });

  it('should accept partial updates with username only', () => {
    const result = updateProfileSchema.parse({
      username: 'testuser',
    });

    expect(result.username).toBe('testuser');
    expect(result.displayName).toBeUndefined();
  });

  it('should accept partial updates with bio only', () => {
    const result = updateProfileSchema.parse({
      bio: 'This is my bio',
    });

    expect(result.bio).toBe('This is my bio');
    expect(result.displayName).toBeUndefined();
  });

  it('should accept partial updates with socialLinks only', () => {
    const result = updateProfileSchema.parse({
      socialLinks: {
        website: 'https://example.com',
      },
    });

    expect(result.socialLinks?.website).toBe('https://example.com');
    expect(result.displayName).toBeUndefined();
  });

  it('should accept all fields together', () => {
    const result = updateProfileSchema.parse({
      displayName: 'Full Name',
      email: 'user@example.com',
      username: 'username',
      bio: 'Creator bio',
      socialLinks: {
        website: 'https://example.com',
        twitter: 'https://twitter.com/user',
      },
    });

    expect(result.displayName).toBe('Full Name');
    expect(result.email).toBe('user@example.com');
    expect(result.username).toBe('username');
    expect(result.bio).toBe('Creator bio');
    expect(result.socialLinks?.website).toBe('https://example.com');
    expect(result.socialLinks?.twitter).toBe('https://twitter.com/user');
  });

  it('should accept empty object (no updates)', () => {
    const result = updateProfileSchema.parse({});
    expect(result).toEqual({
      displayName: undefined,
      email: undefined,
      username: undefined,
      bio: undefined,
      socialLinks: undefined,
    });
  });

  it('should reject invalid email', () => {
    expect(() =>
      updateProfileSchema.parse({ email: 'not-an-email' })
    ).toThrow();
  });

  it('should reject invalid username', () => {
    expect(() =>
      updateProfileSchema.parse({ username: 'invalid_username' })
    ).toThrow();
  });

  it('should reject bio exceeding max length', () => {
    expect(() => updateProfileSchema.parse({ bio: 'a'.repeat(501) })).toThrow();
  });

  it('should reject social links with dangerous URLs', () => {
    expect(() =>
      updateProfileSchema.parse({
        socialLinks: { website: 'javascript:alert(1)' },
      })
    ).toThrow();
  });

  it('should trim displayName whitespace', () => {
    const result = updateProfileSchema.parse({
      displayName: '  Display Name  ',
    });

    expect(result.displayName).toBe('Display Name');
  });

  it('should reject empty displayName', () => {
    expect(() => updateProfileSchema.parse({ displayName: '   ' })).toThrow();
  });

  it('should reject displayName exceeding 255 characters', () => {
    expect(() =>
      updateProfileSchema.parse({ displayName: 'a'.repeat(256) })
    ).toThrow();
  });

  it('should transform username to lowercase', () => {
    const result = updateProfileSchema.parse({
      username: 'TestUser-Name',
    });

    expect(result.username).toBe('testuser-name');
  });
});
