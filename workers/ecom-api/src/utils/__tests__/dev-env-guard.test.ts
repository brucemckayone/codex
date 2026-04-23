import { describe, expect, it } from 'vitest';
import { isDevEnvironment } from '../dev-env-guard';

describe('isDevEnvironment (default-deny ENVIRONMENT guard)', () => {
  describe('allowed values', () => {
    it('returns true for "development"', () => {
      expect(isDevEnvironment('development')).toBe(true);
    });

    it('returns true for "staging"', () => {
      expect(isDevEnvironment('staging')).toBe(true);
    });
  });

  describe('denied values (the whole point of default-deny)', () => {
    it('returns false for "production"', () => {
      expect(isDevEnvironment('production')).toBe(false);
    });

    it('returns false for undefined (missing binding)', () => {
      expect(isDevEnvironment(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isDevEnvironment('')).toBe(false);
    });

    it('returns false for mis-cased "Development"', () => {
      expect(isDevEnvironment('Development')).toBe(false);
    });

    it('returns false for mis-cased "DEVELOPMENT"', () => {
      expect(isDevEnvironment('DEVELOPMENT')).toBe(false);
    });

    it('returns false for abbreviated "dev"', () => {
      // We intentionally require the full word — abbreviations indicate a
      // configuration mistake rather than a dev environment.
      expect(isDevEnvironment('dev')).toBe(false);
    });

    it('returns false for whitespace-padded "development "', () => {
      expect(isDevEnvironment('development ')).toBe(false);
    });

    it('returns false for an unrelated value', () => {
      expect(isDevEnvironment('qa')).toBe(false);
    });
  });
});
